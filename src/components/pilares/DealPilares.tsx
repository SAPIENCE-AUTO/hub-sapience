import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { getDealPilares, saveDealPilares } from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { leerMonto, montoParaEditar } from '@/lib/pilares/dinero';
import {
  completarConLoQueFalta, estadoReparto, ponerPilares, porcentajes, reajustarAlPrecio, repartoParejo, sumar, type FilaReparto,
} from '@/lib/pilares/reparto';
import DealPilaresVista, { type FilaVista } from './DealPilaresVista';
import PilaresAdminDialog from './PilaresAdminDialog';
import type { RepartoApi } from './tipos';

// El reparto de un deal entre pilares: carga lo guardado, deja editarlo (fichas + montos en la moneda del deal) y lo guarda. Toda la cuenta (porcentajes, lo que falta, parejo,
// reajuste) es de src/lib/pilares/reparto.ts; el servidor valida lo mismo. Lo usan la pestaña General del deal y la pantalla de Pilares.

type Textos = Record<string, { precio: string; costo: string }>;

interface Props {
  dealId: string;
  /** Precio y moneda ACTUALES del deal: el precio cambia desde la pestaña Cotizaciones sin que este bloque vuelva a leer el servidor. */
  precioDeal?: number | null;
  moneda?: string;
  /** Se llama al guardar, con el texto nuevo de «Tipo de proyecto» (nombres de los pilares). */
  onGuardado?: (info: { tipoProyecto: string; clasificado: boolean }) => void;
}

const aTextos = (items: { pilarId: string; precio: number | null; costo: number | null }[]): Textos =>
  Object.fromEntries(items.map(i => [i.pilarId, { precio: montoParaEditar(i.precio), costo: montoParaEditar(i.costo) }]));

export default function DealPilares({ dealId, precioDeal, moneda, onGuardado }: Props) {
  const { user } = useAuth();
  const puedeAdministrar = user?.role === 'Owner' || user?.role === 'Socio';
  const [datos, setDatos] = useState<RepartoApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [textos, setTextos] = useState<Textos>({});
  const [sucio, setSucio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardadoReciente, setGuardadoReciente] = useState(false);
  const [adminAbierto, setAdminAbierto] = useState(false);
  const pedido = useRef(0);

  const aplicar = useCallback((r: RepartoApi) => {
    setDatos(r);
    setElegidos(r.items.map(i => i.pilarId));
    setTextos(aTextos(r.items));
    setSucio(false);
  }, []);

  const cargar = useCallback(async () => {
    const mio = ++pedido.current;
    setError(null);
    try {
      const r = (await getDealPilares({ dealId })) as RepartoApi;
      if (mio === pedido.current) aplicar(r);
    } catch (e) {
      if (mio === pedido.current) setError(e instanceof Error ? e.message : 'No se pudo cargar el reparto');
    }
  }, [dealId, aplicar]);

  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  const catalogo = datos?.pilares ?? [];
  const orden = useMemo(() => catalogo.map(p => p.id), [catalogo]);
  const precio = precioDeal !== undefined ? precioDeal : datos?.deal.precio ?? null;
  const monedaCorta = (moneda ?? datos?.deal.moneda ?? 'MXN').trim().slice(0, 3).toUpperCase() || 'MXN';

  // Las filas con lo que se ha escrito: un texto que no es monto cuenta como vacío para la cuenta y se marca en rojo.
  const { filas, invalidos } = useMemo(() => {
    const inval = new Set<string>();
    const lista: FilaReparto[] = elegidos.map(id => {
      const t = textos[id] ?? { precio: '', costo: '' };
      const pr = leerMonto(t.precio);
      const co = leerMonto(t.costo);
      if (Number.isNaN(pr)) inval.add(`${id}:precio`);
      if (Number.isNaN(co)) inval.add(`${id}:costo`);
      return { pilarId: id, precio: Number.isNaN(pr) ? null : pr, costo: Number.isNaN(co) ? null : co };
    });
    return { filas: lista, invalidos: inval };
  }, [elegidos, textos]);

  const resumen = useMemo(() => estadoReparto(filas, precio), [filas, precio]);
  const pct = useMemo(() => porcentajes(filas, precio), [filas, precio]);

  const poner = (nuevas: FilaReparto[], conservarCostos = true) => {
    setElegidos(nuevas.map(f => f.pilarId));
    setTextos(prev => Object.fromEntries(nuevas.map(f => [f.pilarId, { precio: montoParaEditar(f.precio), costo: conservarCostos ? (prev[f.pilarId]?.costo ?? montoParaEditar(f.costo)) : montoParaEditar(f.costo) }])));
    setSucio(true);
  };

  const alternar = (pilarId: string) => {
    const nuevos = elegidos.includes(pilarId) ? elegidos.filter(x => x !== pilarId) : [...elegidos, pilarId];
    poner(ponerPilares(filas, nuevos, precio, orden));
  };

  const cambiarTexto = (pilarId: string, campo: 'precio' | 'costo', valor: string) => {
    setTextos(prev => ({ ...prev, [pilarId]: { ...(prev[pilarId] ?? { precio: '', costo: '' }), [campo]: valor } }));
    setSucio(true);
  };

  const parejo = () => {
    if (!precio || precio <= 0) return;
    const partes = repartoParejo(precio, filas.length);
    poner(filas.map((f, i) => ({ ...f, precio: partes[i] })));
  };
  const completar = (pilarId: string) => poner(completarConLoQueFalta(filas, filas.findIndex(f => f.pilarId === pilarId), precio));
  const reajustar = () => { if (precio && precio > 0) poner(reajustarAlPrecio(filas, precio)); };

  const usarSugerencia = () => {
    if (!datos?.sugerencia) return;
    poner(ponerPilares([], datos.sugerencia.pilarIds, precio, orden), false);
  };

  const guardar = async () => {
    if (invalidos.size > 0) { toast.error('Hay montos que no se entienden: revisa los campos en rojo.'); return; }
    setGuardando(true);
    try {
      const r = (await saveDealPilares({ dealId, items: filas.map(f => ({ pilarId: f.pilarId, precio: f.precio, costo: f.costo })) })) as RepartoApi;
      aplicar(r);
      setGuardadoReciente(true);
      setTimeout(() => setGuardadoReciente(false), 1800);
      onGuardado?.({ tipoProyecto: r.deal.tipoProyecto ?? '', clasificado: r.items.length > 0 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar el reparto');
    } finally {
      setGuardando(false);
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive">
        {error}
        <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={cargar}>Reintentar</Button>
      </div>
    );
  }
  if (!datos) return <Skeleton className="h-16 w-full rounded-lg" />;

  const vista: FilaVista[] = filas.map((f, i) => ({
    pilar: catalogo.find(p => p.id === f.pilarId)!,
    precioTexto: textos[f.pilarId]?.precio ?? '',
    costoTexto: textos[f.pilarId]?.costo ?? '',
    precioInvalido: invalidos.has(`${f.pilarId}:precio`),
    costoInvalido: invalidos.has(`${f.pilarId}:costo`),
    pctPrecio: pct[i].precio,
    pctCosto: pct[i].costo,
  })).filter(v => v.pilar);

  return (
    <>
      <DealPilaresVista
        pilares={catalogo}
        elegidos={elegidos}
        filas={vista}
        precioDeal={precio}
        moneda={monedaCorta}
        resumen={resumen}
        totalCosto={sumar(filas, 'costo')}
        veCostos={datos.veCostos}
        puedeAdministrar={puedeAdministrar}
        referencias={datos.referencias}
        sugerencia={datos.sugerencia && elegidos.length === 0 ? { nombres: datos.sugerencia.nombres, textoViejo: datos.deal.tipoProyecto } : null}
        sucio={sucio}
        guardando={guardando}
        hayInvalidos={invalidos.size > 0}
        guardadoReciente={guardadoReciente}
        onToggle={alternar}
        onTexto={cambiarTexto}
        onParejo={parejo}
        onCompletar={completar}
        onReajustar={reajustar}
        onGuardar={guardar}
        onDescartar={() => aplicar(datos)}
        onAdministrar={() => setAdminAbierto(true)}
        onUsarSugerencia={usarSugerencia}
      />
      {puedeAdministrar && <PilaresAdminDialog abierto={adminAbierto} onCerrar={() => setAdminAbierto(false)} onCambio={cargarConservandoEdicion(cargar, sucio)} />}
    </>
  );
}

// Si hay cambios sin guardar, recargar el catálogo no debe borrarlos: solo se vuelve a leer cuando no hay nada editado.
function cargarConservandoEdicion(cargar: () => Promise<void>, sucio: boolean) {
  return () => { if (!sucio) void cargar(); else toast.info('Se actualizó el catálogo. Guarda o descarta tus cambios y se verán los pilares nuevos.'); };
}
