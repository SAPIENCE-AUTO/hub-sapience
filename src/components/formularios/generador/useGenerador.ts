import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  generateFormularioEstructura, generateFormularioLogica, generateFormularioSeccion, saveFormularioGenerador, saveFormularioInsumos,
} from 'zite-endpoints-sdk';
import { useLlamadaLarga } from '@/components/propuestas/useLlamadaLarga';
import {
  avanceEscritura, firmaSeccion, ponerSeccion, prepararParaEscribir, seccionNse,
  type Generador, type ReunionInsumo,
} from '@/lib/formularios/generador';
import { aplicarParche, type Parche } from '@/lib/formularios/ia';
import type { Seccion } from '@/lib/formularios/tipos';
import type { Editor } from '../editor/useEditorFiltro';

/**
 * El generador con IA en pantalla (fase 3 de Filtros): insumos, estructura y
 * la escritura de las preguntas. Las secciones se piden de tres en tres y
 * cada una se pone en el documento en cuanto llega, con `editor.aplicar` (así
 * se puede deshacer y pasa por la revisión del editor). El servidor guarda lo
 * que la IA escribió: si se cierra la ventana, al volver se pone lo que ya
 * estaba y se sigue con lo que falta.
 */

export type EstadoSeccion = { estado: 'esperando' | 'escribiendo' | 'lista' | 'error'; error?: string; problemas?: string[] };
export type EstadoLogica = 'esperando' | 'armando' | 'lista' | 'error';

const EN_PARALELO = 3;

export function useGenerador({ formularioId, editor, inicial, usoInicial }: {
  formularioId: string;
  editor: Editor;
  inicial?: Generador;
  usoInicial?: { usadas: number; limite: number };
}) {
  const [g, setG] = useState<Generador | undefined>(inicial);
  const gRef = useRef(g);
  gRef.current = g;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const [secciones, setSecciones] = useState<Record<string, EstadoSeccion>>({});
  const [logica, setLogica] = useState<EstadoLogica>(inicial?.logicaLista ? 'lista' : 'esperando');
  const [errorLogica, setErrorLogica] = useState('');
  const [problemasEstructura, setProblemasEstructura] = useState<string[]>([]);
  const [problemasLogica, setProblemasLogica] = useState<string[]>([]);
  const [uso, setUso] = useState(usoInicial);
  const llamada = useLlamadaLarga();
  const corriendo = useRef(false);
  /** La escritura está en marcha (las secciones «en fila» después de un error no cuentan como trabajando). */
  const [enMarcha, setEnMarcha] = useState(false);
  /** Llamadas a la IA en curso, para «Detener». */
  const enCurso = useRef(new Set<{ cancelar: () => void }>());
  const [detenido, setDetenido] = useState(false);
  const detenidoRef = useRef(false);
  const seguir = <T extends { cancelar: () => void }>(c: T): T => {
    enCurso.current.add(c);
    void Promise.resolve(c as unknown as Promise<unknown>).catch(() => {}).finally(() => enCurso.current.delete(c));
    return c;
  };
  const fueDetenido = (err: unknown) => (err as { code?: string })?.code === 'DETENIDO';

  /** «Detener»: corta lo que la IA esté haciendo (estructura, secciones o lógica); lo ya escrito se queda. */
  const detener = useCallback(() => {
    detenidoRef.current = true;
    setDetenido(true);
    for (const c of enCurso.current) c.cancelar();
  }, []);

  const contarUso = useCallback((n = 1) => setUso((u) => (u ? { ...u, usadas: u.usadas + n } : u)), []);

  const guardarInsumos = useCallback(async (cambio: { notas?: string; reuniones?: ReunionInsumo[]; archivo?: { nombre: string; mime: string; base64: string }; quitarArchivo?: string }) => {
    const r = await saveFormularioInsumos({ formularioId, ...cambio });
    setG(r.generador);
  }, [formularioId]);

  /** Etapa 1: propone la estructura, o la ajusta con un comentario (la propuesta o la de lo ya escrito). */
  const pedirEstructura = useCallback(async (pedido?: string, sobre?: 'propuesta' | 'escrito') => {
    detenidoRef.current = false;
    setDetenido(false);
    try {
      const r = await llamada.correr(seguir(generateFormularioEstructura({ formularioId, pedido, sobre, definicion: sobre === 'escrito' ? editorRef.current.leer() : undefined })));
      setG(r.generador);
      setProblemasEstructura(r.problemas ?? []);
      contarUso();
      return true;
    } catch (err) {
      if (fueDetenido(err)) toast('Se detuvo. Todo quedó como estaba.');
      else toast.error((err as Error).message || 'La IA no pudo armar la estructura.');
      return false;
    }
  }, [formularioId]); // eslint-disable-line react-hooks/exhaustive-deps

  const editarFrente = useCallback(async (id: string, cambio: { nombre?: string; meta?: number }) => {
    const r = await saveFormularioGenerador({ formularioId, frente: { id, ...cambio } });
    setG(r.generador);
  }, [formularioId]);

  const marcarRevisados = useCallback(async () => {
    setG((x) => (x ? { ...x, supuestosRevisados: true } : x));
    await saveFormularioGenerador({ formularioId, supuestosRevisados: true }).catch(() => {});
  }, [formularioId]);

  const usarTalCual = useCallback(async () => {
    const r = await saveFormularioGenerador({ formularioId, usarTalCual: true });
    setG(r.generador);
  }, [formularioId]);

  /** Descarta una propuesta de cambio de estructura: el filtro se queda como está. */
  const descartar = useCallback(async () => {
    const r = await saveFormularioGenerador({ formularioId, descartar: true });
    setG(r.generador);
    setProblemasEstructura([]);
  }, [formularioId]);

  /** Pone en el documento una sección escrita (o la del NSE) y la marca para el próximo guardado. */
  const poner = (seccion: Seccion, firma: string) => {
    const e = gRef.current?.estructura;
    if (!e) return;
    editorRef.current.aplicar((d) => ponerSeccion(d, seccion, e));
    editorRef.current.marcarAlGuardar({ [seccion.id]: firma });
    setG((x) => (x ? { ...x, aplicadas: { ...x.aplicadas, [seccion.id]: firma } } : x));
  };

  const escribirUna = async (id: string): Promise<boolean> => {
    const e = gRef.current?.estructura;
    const plan = e?.secciones.find((s) => s.id === id);
    if (!e || !plan) return false;
    setSecciones((s) => ({ ...s, [id]: { estado: 'escribiendo' } }));
    try {
      const r = await seguir(generateFormularioSeccion({ formularioId, seccionId: id, definicion: editorRef.current.leer() }));
      contarUso();
      // Si mientras tanto cambió la estructura, esta sección ya no va.
      if (gRef.current?.estructura?.secciones.find((s) => s.id === id) && firmaSeccion(gRef.current.estructura.secciones.find((s) => s.id === id)!) === r.firma) {
        setG((x) => (x ? {
          ...x,
          escritas: { ...x.escritas, [id]: { seccion: r.seccion, firma: r.firma } },
          supuestosSecciones: { ...x.supuestosSecciones, [id]: r.supuestos },
          supuestosRevisados: r.supuestos.length ? false : x.supuestosRevisados,
        } : x));
        poner(r.seccion, r.firma);
      }
      setSecciones((s) => ({ ...s, [id]: { estado: 'lista', problemas: r.problemas } }));
      return true;
    } catch (err) {
      setSecciones((s) => ({ ...s, [id]: fueDetenido(err) ? { estado: 'esperando' } : { estado: 'error', error: (err as Error).message || 'No se pudo escribir.' } }));
      return false;
    }
  };

  const armarLogica = async () => {
    setLogica('armando');
    setErrorLogica('');
    try {
      const r = await seguir(generateFormularioLogica({ formularioId, definicion: editorRef.current.leer() }));
      contarUso();
      editorRef.current.aplicar((d) => aplicarParche(d, r.parche as Parche));
      setProblemasLogica(r.problemas ?? []);
      setG((x) => (x ? { ...x, supuestosLogica: r.supuestos, logicaLista: true, etapa: 'listo', supuestosRevisados: r.supuestos.length ? false : x.supuestosRevisados } : x));
      setLogica('lista');
    } catch (err) {
      if (fueDetenido(err)) { setLogica('esperando'); return; }
      setErrorLogica((err as Error).message || 'No se pudo armar la lógica.');
      setLogica('error');
    }
  };

  /**
   * Etapa 2: pone lo que ya estaba escrito, escribe lo que falta de tres en
   * tres y al final arma la lógica. Se puede volver a llamar para seguir
   * (después de un error o al reabrir el filtro).
   */
  const escribir = useCallback(async () => {
    if (corriendo.current) return;
    const actual = gRef.current;
    const e = actual?.estructura;
    if (!actual || !e) return;
    corriendo.current = true;
    detenidoRef.current = false;
    setDetenido(false);
    setEnMarcha(true);
    try {
      const { porEscribir, porPoner } = avanceEscritura(actual);
      for (const id of porPoner) {
        const plan = e.secciones.find((s) => s.id === id)!;
        const firma = firmaSeccion(plan);
        const seccion = plan.nse ? seccionNse(plan, e.pais) : actual.escritas[id]?.seccion;
        if (seccion) poner(seccion, firma);
        else editorRef.current.marcarAlGuardar({ [id]: firma }); // NSE sin regla en el país: no hay nada que poner
        setSecciones((s) => ({ ...s, [id]: { estado: 'lista' } }));
      }
      setSecciones((s) => ({ ...s, ...Object.fromEntries(porEscribir.map((id) => [id, { estado: 'esperando' as const }])) }));
      const cola = [...porEscribir];
      let fallaron = 0;
      // Si una sección falla, no se piden más (la causa suele ser la misma para todas: sin saldo, tope, sin conexión).
      // Las que ya iban terminan; las demás esperan a «Reintentar lo que falta».
      await Promise.all(Array.from({ length: Math.min(EN_PARALELO, cola.length) }, async () => {
        const siguiente = () => (fallaron || detenidoRef.current ? undefined : cola.shift());
        for (let id = siguiente(); id; id = siguiente()) if (!(await escribirUna(id))) fallaron++;
      }));
      if (!fallaron && !detenidoRef.current && !gRef.current?.logicaLista) await armarLogica();
    } finally {
      corriendo.current = false;
      setEnMarcha(false);
    }
  }, [formularioId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Aprueba la estructura: quita lo que sale, ordena y empieza a escribir. */
  const aprobar = useCallback(async () => {
    try {
      const r = await saveFormularioGenerador({ formularioId, aprobar: true });
      const e = r.generador.estructura;
      editorRef.current.aplicar((d) => prepararParaEscribir(d, e, r.salen));
      gRef.current = r.generador;
      setG(r.generador);
      setLogica('esperando');
      setSecciones({});
      void escribir();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [formularioId, escribir]);

  const reintentar = useCallback(() => { void escribir(); }, [escribir]);

  // Al abrir un filtro que se quedó a medias, se sigue.
  useEffect(() => {
    if (inicial?.etapa === 'preguntas') void escribir();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const avance = g ? avanceEscritura(g) : undefined;
  const escribiendo = enMarcha || logica === 'armando';

  return {
    g, secciones, logica, errorLogica, problemasEstructura, problemasLogica, uso, llamada, avance, escribiendo, detenido,
    guardarInsumos, pedirEstructura, editarFrente, marcarRevisados, usarTalCual, descartar, aprobar, reintentar, contarUso, detener,
  };
}

export type GeneradorUI = ReturnType<typeof useGenerador>;
