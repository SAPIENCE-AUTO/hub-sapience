import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { getFormularioDetail, pingFormularioEditor, publishFormularioCambios, saveFormularioDefinicion } from 'zite-endpoints-sdk';
import { cambiosEnPalabras } from '@/lib/formularios/ia';
import { revisarConLugar } from '@/lib/formularios/revisar';
import type { Definicion } from '@/lib/formularios/tipos';

/**
 * Estado del editor de un filtro: el screener en pantalla, deshacer y
 * rehacer, el guardado solo y los avisos de otra persona.
 *
 * - Cada cambio se guarda solo a los ~0.7 s, pero solo si pasa la revisión
 *   (revisarConLugar): mientras haya algo mal armado se queda sin guardar y
 *   se dice qué es.
 * - Se guarda con la revisión con la que se cargó. Si otra persona (u otra
 *   ventana) guardó antes, no se pisa: queda en «conflicto» hasta cargar lo
 *   guardado. Lo propio no se pierde: queda en Deshacer.
 * - Cada 30 s se avisa que el editor sigue abierto y se sabe quién más lo
 *   tiene abierto (pingFormularioEditor).
 * - En vivo se edita una copia (el servidor la guarda aparte): los
 *   participantes siguen con lo publicado hasta «Publicar cambios».
 */

export type EstadoGuardado = 'guardado' | 'pendiente' | 'guardando' | 'por_corregir' | 'conflicto' | 'error';

interface Historia { def: Definicion; pasado: Definicion[]; futuro: Definicion[] }
type Accion = { tipo: 'poner'; def: Definicion } | { tipo: 'deshacer' } | { tipo: 'rehacer' };

const MAX_HISTORIA = 100;

function historia(h: Historia, a: Accion): Historia {
  if (a.tipo === 'poner') return { def: a.def, pasado: [...h.pasado, h.def].slice(-MAX_HISTORIA), futuro: [] };
  if (a.tipo === 'deshacer') {
    if (!h.pasado.length) return h;
    return { def: h.pasado[h.pasado.length - 1], pasado: h.pasado.slice(0, -1), futuro: [h.def, ...h.futuro] };
  }
  if (!h.futuro.length) return h;
  return { def: h.futuro[0], pasado: [...h.pasado, h.def], futuro: h.futuro.slice(1) };
}

export interface OtroEditor { nombre: string; mismaPersona: boolean }

/**
 * Una sesión por ventana y por filtro. Se guarda en la pestaña (sessionStorage)
 * para que recargar no deje a la ventana avisándose a sí misma: la sesión de
 * antes de recargar seguiría contando como abierta un minuto.
 */
function sesionDeVentana(formularioId: string): string {
  const clave = `filtro_editor_${formularioId}`;
  try {
    const ya = sessionStorage.getItem(clave);
    if (ya) return ya;
    const nueva = crypto.randomUUID();
    sessionStorage.setItem(clave, nueva);
    return nueva;
  } catch {
    return crypto.randomUUID();
  }
}

const mismo = (a: Definicion, b: Definicion) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function useEditorFiltro({ formularioId, inicial, revisionInicial, onGuardado, publicada: publicadaInicial }: {
  formularioId: string;
  inicial: Definicion;
  revisionInicial: number;
  /** Con lo que quedó guardado (lo usan las respuestas y las cuotas). */
  onGuardado?: (def: Definicion) => void;
  /** Solo en vivo: lo que contestan los participantes; lo que se edita es una copia. */
  publicada?: Definicion;
}) {
  const [h, dispatch] = useReducer(historia, { def: inicial, pasado: [], futuro: [] });
  const actual = useRef(h.def);
  actual.current = h.def;
  const guardada = useRef({ def: inicial, revision: revisionInicial });
  const [estado, setEstado] = useState<EstadoGuardado>('guardado');
  const [error, setError] = useState('');
  const [errorDe, setErrorDe] = useState<Definicion | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [enVuelo, setEnVuelo] = useState(false);
  const enVueloRef = useRef(false);
  const [otros, setOtros] = useState<OtroEditor[]>([]);
  const sesion = useMemo(() => sesionDeVentana(formularioId), [formularioId]);
  const onGuardadoRef = useRef(onGuardado);
  onGuardadoRef.current = onGuardado;
  /** Secciones que puso el generador con IA y se marcan como puestas con el próximo guardado (fase 3). */
  const porMarcar = useRef<Record<string, string>>({});
  const [publicada, setPublicada] = useState<Definicion | undefined>(publicadaInicial);
  const enVivo = publicadaInicial !== undefined;
  useEffect(() => setPublicada(publicadaInicial), [enVivo]); // eslint-disable-line react-hooks/exhaustive-deps

  const problemas = useMemo(() => revisarConLugar(h.def), [h.def]);

  /** Aplica un cambio (una función pura de editar.ts). Devuelve la definición nueva. */
  const aplicar = useCallback((cambio: (d: Definicion) => Definicion): Definicion => {
    const nueva = cambio(actual.current);
    if (nueva !== actual.current) {
      actual.current = nueva; // si llegan dos cambios seguidos, el segundo parte del primero
      dispatch({ tipo: 'poner', def: nueva });
    }
    return nueva;
  }, []);

  const guardarAhora = useCallback(async () => {
    if (enVueloRef.current) return;
    const def = actual.current;
    enVueloRef.current = true;
    setEnVuelo(true);
    setEstado('guardando');
    const aplicadas = { ...porMarcar.current };
    try {
      const r = await saveFormularioDefinicion({ formularioId, definicion: def, revision: guardada.current.revision, aplicadas });
      if (!r.ok) {
        setConflicto(true);
      } else {
        for (const id of Object.keys(aplicadas)) if (porMarcar.current[id] === aplicadas[id]) delete porMarcar.current[id];
        guardada.current = { def, revision: r.revision };
        setErrorDe(null);
        onGuardadoRef.current?.(def);
      }
    } catch (err) {
      setError((err as Error).message || 'No se pudo guardar.');
      setErrorDe(def);
    } finally {
      enVueloRef.current = false;
      setEnVuelo(false);
    }
  }, [formularioId]);

  // Guardado solo. Se vuelve a evaluar al terminar cada guardado (enVuelo), por si hubo cambios mientras tanto.
  useEffect(() => {
    if (enVuelo) return;
    if (conflicto) { setEstado('conflicto'); return; }
    if (h.def === guardada.current.def) { setEstado('guardado'); return; }
    if (problemas.length) { setEstado('por_corregir'); return; }
    if (errorDe === h.def) { setEstado('error'); return; }
    setEstado('pendiente');
    const t = setTimeout(guardarAhora, 700);
    return () => clearTimeout(t);
  }, [h.def, problemas, conflicto, enVuelo, errorDe, guardarAhora]);

  /** Carga lo que está guardado (de otra persona u otra ventana). Lo propio queda en Deshacer. */
  const cargarGuardada = useCallback(async () => {
    const r = await getFormularioDetail({ formularioId });
    if (!r.found) return;
    const def = r.cambios ?? r.definicion;
    guardada.current = { def, revision: r.revision ?? 0 };
    actual.current = def;
    dispatch({ tipo: 'poner', def });
    if (r.estado === 'en_vivo') setPublicada(r.definicion);
    setConflicto(false);
  }, [formularioId]);

  // ── En vivo: la copia de trabajo contra lo publicado ──
  const cambiosPendientes = useMemo(() => !!publicada && !mismo(h.def, publicada), [h.def, publicada]);
  const resumenCambios = useMemo(() => (cambiosPendientes && publicada ? cambiosEnPalabras(publicada, h.def) : []), [cambiosPendientes, publicada, h.def]);

  /** Espera a que termine el guardado en curso y guarda lo que falte. */
  const asentar = useCallback(async () => {
    for (let i = 0; enVueloRef.current && i < 50; i++) await new Promise((r) => setTimeout(r, 200));
    if (actual.current !== guardada.current.def) await guardarAhora();
  }, [guardarAhora]);

  /** Publica la copia de trabajo (o la descarta). Devuelve si se pudo; si otra ventana guardó antes, queda en conflicto. */
  const publicarCambios = useCallback(async (descartar = false): Promise<boolean> => {
    if (!descartar) await asentar();
    const r = await publishFormularioCambios({ formularioId, revision: guardada.current.revision, descartar }) as { ok: boolean; revision: number };
    if (!r.ok) { setConflicto(true); return false; }
    if (descartar && publicada) {
      guardada.current = { def: publicada, revision: r.revision };
      actual.current = publicada;
      dispatch({ tipo: 'poner', def: publicada });
    } else {
      guardada.current = { def: actual.current, revision: r.revision };
      setPublicada(actual.current);
    }
    return true;
  }, [formularioId, asentar, publicada]);

  // Aviso de quién más lo tiene abierto, y de si alguien guardó mientras tanto.
  useEffect(() => {
    let vivo = true;
    const avisar = async () => {
      try {
        const r = await pingFormularioEditor({ formularioId, sesion });
        if (!vivo) return;
        setOtros(r.otros ?? []);
        if (r.revision > guardada.current.revision && !enVueloRef.current) setConflicto(true);
      } catch { /* sin red: se reintenta en la siguiente vuelta */ }
    };
    avisar();
    const reloj = setInterval(avisar, 30_000);
    return () => {
      vivo = false;
      clearInterval(reloj);
      pingFormularioEditor({ formularioId, sesion, salir: true }).catch(() => {});
    };
  }, [formularioId, sesion]);

  // Cerrar la pestaña con cambios sin guardar pide confirmación.
  useEffect(() => {
    const avisar = (e: BeforeUnloadEvent) => {
      if (actual.current === guardada.current.def) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, []);

  return {
    def: h.def,
    /** Lo más reciente, aunque todavía no se haya vuelto a pintar (lo usa el generador entre llamadas). */
    leer: useCallback(() => actual.current, []),
    aplicar,
    /** Lo que guarde el siguiente guardado deja estas secciones del generador como puestas (id → firma de su plan). */
    marcarAlGuardar: useCallback((marcas: Record<string, string>) => { Object.assign(porMarcar.current, marcas); }, []),
    deshacer: useCallback(() => dispatch({ tipo: 'deshacer' }), []),
    rehacer: useCallback(() => dispatch({ tipo: 'rehacer' }), []),
    puedeDeshacer: h.pasado.length > 0,
    puedeRehacer: h.futuro.length > 0,
    estado,
    error,
    problemas,
    otros,
    cargarGuardada,
    reintentar: guardarAhora,
    sinGuardar: h.def !== guardada.current.def,
    /** En vivo: lo que contestan los participantes (undefined fuera de vivo). */
    publicada,
    cambiosPendientes,
    resumenCambios,
    publicar: useCallback(() => publicarCambios(false), [publicarCambios]),
    descartarCambios: useCallback(() => publicarCambios(true), [publicarCambios]),
  };
}

export type Editor = ReturnType<typeof useEditorFiltro>;
