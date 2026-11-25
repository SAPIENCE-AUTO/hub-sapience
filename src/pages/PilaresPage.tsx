import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Layers, Search, Settings2, Sparkles } from 'lucide-react';
import { acceptPilarSuggestions, assignPilarToDeals, getPilaresClasificacion } from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import Pastilla from '@/components/clientes/Pastilla';
import PilarChip from '@/components/pilares/PilarChip';
import PilaresAdminDialog from '@/components/pilares/PilaresAdminDialog';
import RepartirDealDialog from '@/components/pilares/RepartirDealDialog';
import { precioEnPesos, type DealClasificarApi, type PilarCat } from '@/components/pilares/tipos';
import { formatoMonto, formatoPorcentaje } from '@/lib/pilares/dinero';
import { porcentajes } from '@/lib/pilares/reparto';
import { formatear } from '@/lib/tablero/formato';
import { ALERTA, EXITO, GRIS } from '@/lib/toolColors';

// Pilares (unidades de negocio): aquí se ve cuántos deals ya están repartidos entre Cualitativo, Cuantitativo, Digital, etc., y se clasifican los que faltan, de uno en uno o
// de golpe (aceptar lo que sugiere el texto viejo de «Tipo de proyecto», o ponerle un pilar a varios). Solo Owner o Socio; el candado real está en cada endpoint.

type FiltroEstado = 'sin' | 'sugerencia' | 'completar' | 'listos' | 'todos';
type Orden = 'precio' | 'reciente' | 'cliente';

const PASO = 100;
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const anioDe = (d: DealClasificarApi) => (d.fecha ? d.fecha.slice(0, 4) : 'Sin fecha');
const esSin = (d: DealClasificarApi) => d.estado === 'sin-clasificar';
const esCompletar = (d: DealClasificarApi) => d.estado === 'incompleto' || d.estado === 'excedido' || d.estado === 'sin-precio';

const FILTROS: { id: FiltroEstado; texto: string; cuenta: (d: DealClasificarApi) => boolean }[] = [
  { id: 'sin', texto: 'Sin clasificar', cuenta: esSin },
  { id: 'sugerencia', texto: 'Con sugerencia', cuenta: d => esSin(d) && !!d.sugerencia },
  { id: 'completar', texto: 'Por completar', cuenta: esCompletar },
  { id: 'listos', texto: 'Listos', cuenta: d => d.estado === 'listo' },
  { id: 'todos', texto: 'Todos', cuenta: () => true },
];

function EstadoDelDeal({ d }: { d: DealClasificarApi }) {
  switch (d.estado) {
    case 'listo': return <Pastilla tono="exito">Completo</Pastilla>;
    case 'incompleto': return <Pastilla tono="alerta">Faltan {formatoMonto(d.falta, d.moneda)}</Pastilla>;
    case 'excedido': return <Pastilla tono="peligro">Se pasa {formatoMonto(d.sobra, d.moneda)}</Pastilla>;
    case 'sin-precio': return <Pastilla tono="gris">Sin precio</Pastilla>;
    default: return <Pastilla tono="gris">Sin pilar</Pastilla>;
  }
}

export default function PilaresPage() {
  const { user } = useAuth();
  const [datos, setDatos] = useState<{ pilares: PilarCat[]; deals: DealClasificarApi[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soloGanados, setSoloGanados] = useState(true);
  const [filtro, setFiltro] = useState<FiltroEstado>('sin');
  const [anio, setAnio] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<Orden>('precio');
  const [limite, setLimite] = useState(PASO);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [repartir, setRepartir] = useState<DealClasificarApi | null>(null);
  const [adminAbierto, setAdminAbierto] = useState(false);
  const [pilarLote, setPilarLote] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setDatos((await getPilaresClasificacion({})) as { pilares: PilarCat[]; deals: DealClasificarApi[] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista de deals');
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const pilares = datos?.pilares ?? [];
  const activos = pilares.filter(p => p.activo);
  const porId = useMemo(() => new Map(pilares.map(p => [p.id, p])), [pilares]);

  // Lo que sale de las filas: primero fase, año y búsqueda (de ahí salen los conteos de cada filtro), luego el filtro de estado y el orden.
  const base = useMemo(() => {
    const q = plano(busqueda.trim());
    return (datos?.deals ?? []).filter(d =>
      (!soloGanados || d.fase === 'Ganado') && (anio === 'todos' || anioDe(d) === anio) && (!q || plano(`${d.nombre} ${d.cliente ?? ''}`).includes(q)));
  }, [datos, soloGanados, anio, busqueda]);

  const filas = useMemo(() => {
    const elegido = FILTROS.find(f => f.id === filtro)!;
    const lista = base.filter(elegido.cuenta);
    const cmp: Record<Orden, (a: DealClasificarApi, b: DealClasificarApi) => number> = {
      precio: (a, b) => precioEnPesos(b) - precioEnPesos(a),
      reciente: (a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''),
      cliente: (a, b) => (a.cliente ?? '').localeCompare(b.cliente ?? '', 'es') || a.nombre.localeCompare(b.nombre, 'es'),
    };
    return [...lista].sort(cmp[orden]);
  }, [base, filtro, orden]);

  const anios = useMemo(() => [...new Set((datos?.deals ?? []).map(anioDe))].sort((a, b) => b.localeCompare(a)), [datos]);

  const resumen = useMemo(() => {
    const suma = (f: (d: DealClasificarApi) => boolean) => base.filter(f).reduce((s, d) => s + precioEnPesos(d), 0);
    const total = suma(() => true);
    return {
      total, deals: base.length,
      listos: suma(d => d.estado === 'listo'), completar: suma(esCompletar), sin: suma(esSin),
    };
  }, [base]);

  const visibles = filas.slice(0, limite);
  const marcados = visibles.filter(d => seleccion.has(d.id)).length;
  const alternar = (id: string) => setSeleccion(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternarTodos = () => setSeleccion(s => (marcados === visibles.length ? new Set([...s].filter(id => !visibles.some(d => d.id === id))) : new Set([...s, ...visibles.map(d => d.id)])));

  const correr = async (accion: () => Promise<string>) => {
    setTrabajando(true);
    try {
      toast.success(await accion());
      setSeleccion(new Set());
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo hacer el cambio');
    } finally {
      setTrabajando(false);
    }
  };

  const aceptar = (ids: string[]) => correr(async () => {
    const r = (await acceptPilarSuggestions({ dealIds: ids })) as { aceptados: number; omitidos: number; mixtos: number };
    const partes = [`${r.aceptados} deal${r.aceptados === 1 ? '' : 's'} clasificado${r.aceptados === 1 ? '' : 's'}`];
    if (r.mixtos) partes.push(`${r.mixtos} mezcla${r.mixtos === 1 ? '' : 's'} pilares: reparte${r.mixtos === 1 ? 'lo' : 'los'} a mano`);
    if (r.omitidos) partes.push(`${r.omitidos} sin sugerencia o ya repartido${r.omitidos === 1 ? '' : 's'}`);
    return partes.join('; ');
  });

  const asignar = () => correr(async () => {
    const r = (await assignPilarToDeals({ dealIds: [...seleccion], pilarId: pilarLote })) as { asignados: number; omitidos: number };
    return `${r.asignados} deal${r.asignados === 1 ? '' : 's'} con ${porId.get(pilarLote)?.nombre ?? 'el pilar'}${r.omitidos ? `; ${r.omitidos} ya tenían reparto y no se tocaron` : ''}`;
  });

  // Este módulo solo aparece en el menú para Owner o Socio (Layout.tsx), pero el candado real está en cada endpoint.
  if (user && user.role !== 'Owner' && user.role !== 'Socio') {
    return <div className="p-6"><p className="text-sm text-muted-foreground">No tienes permisos para ver este módulo.</p></div>;
  }

  const seg = (valor: number) => (resumen.total > 0 ? (valor / resumen.total) * 100 : 0);

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold"><Layers className="h-5 w-5 text-primary" /> Pilares</h2>
          <p className="text-sm text-muted-foreground">Cada deal se reparte entre las unidades de negocio (Cualitativo, Cuantitativo, Digital…) para poder ver la rentabilidad de cada una.</p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={() => setAdminAbierto(true)}><Settings2 className="h-4 w-4" /> Administrar pilares</Button>
      </div>

      {datos && (
        <div className="space-y-2 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-foreground">{resumen.deals} deals, {formatear(resumen.total, 'moneda')} en pesos</span>
            <span className="text-xs text-muted-foreground">{soloGanados ? 'Solo ganados' : 'Todas las fases'}{anio !== 'todos' ? `, ${anio}` : ''}</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Qué parte del dinero ya está repartida entre pilares">
            <div style={{ width: `${seg(resumen.listos)}%`, backgroundColor: EXITO }} title="Completos" />
            <div style={{ width: `${seg(resumen.completar)}%`, backgroundColor: ALERTA }} title="Por completar" />
            <div style={{ width: `${seg(resumen.sin)}%`, backgroundColor: GRIS }} title="Sin clasificar" />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: EXITO }} />Completos {formatear(resumen.listos, 'moneda')} ({formatoPorcentaje(Math.round(seg(resumen.listos)))})</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ALERTA }} />Por completar {formatear(resumen.completar, 'moneda')} ({formatoPorcentaje(Math.round(seg(resumen.completar)))})</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: GRIS }} />Sin clasificar {formatear(resumen.sin, 'moneda')} ({formatoPorcentaje(Math.round(seg(resumen.sin)))})</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Buscar deal o cliente..." value={busqueda} onChange={e => { setBusqueda(e.target.value); setLimite(PASO); }} />
        </div>
        <Select value={soloGanados ? 'ganados' : 'todas'} onValueChange={v => { setSoloGanados(v === 'ganados'); setLimite(PASO); }}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ganados">Solo ganados</SelectItem><SelectItem value="todas">Todas las fases</SelectItem></SelectContent>
        </Select>
        <Select value={anio} onValueChange={v => { setAnio(v); setLimite(PASO); }}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos los años</SelectItem>{anios.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={orden} onValueChange={v => setOrden(v as Orden)}>
          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="precio">Mayor precio primero</SelectItem><SelectItem value="reciente">Más reciente primero</SelectItem><SelectItem value="cliente">Por cliente</SelectItem></SelectContent>
        </Select>
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map(f => {
            const activo = filtro === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={activo}
                onClick={() => { setFiltro(f.id); setLimite(PASO); }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${activo ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'}`}
              >
                {f.texto}<span className={activo ? 'opacity-75' : 'text-muted-foreground'}>{base.filter(f.cuenta).length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {seleccion.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{seleccion.size} seleccionado{seleccion.size === 1 ? '' : 's'}</span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={trabajando} onClick={() => aceptar([...seleccion])}><Sparkles className="h-3.5 w-3.5" /> Aceptar sugerencias</Button>
          <span className="text-xs text-muted-foreground">o poner a todos:</span>
          <Select value={pilarLote} onValueChange={setPilarLote}>
            <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Elegir pilar" /></SelectTrigger>
            <SelectContent>{activos.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="h-8" disabled={trabajando || !pilarLote} onClick={asignar}>Asignar 100%</Button>
          <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setSeleccion(new Set())}>Quitar selección</Button>
        </div>
      )}

      {error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">{error}<Button size="sm" variant="outline" onClick={cargar}>Reintentar</Button></div>
      ) : !datos ? (
        <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : filas.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Ningún deal coincide con estos filtros.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="w-10 px-3 py-2.5"><Checkbox checked={visibles.length > 0 && marcados === visibles.length} onCheckedChange={alternarTodos} aria-label="Seleccionar todos los visibles" /></th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Deal</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Año</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Precio</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Pilares</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Estado</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibles.map(d => {
                  const pct = porcentajes(d.items, d.precio);
                  const sugerenciaSimple = esSin(d) && d.sugerencia && !d.sugerencia.mixta;
                  return (
                    <tr key={d.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-3 py-2"><Checkbox checked={seleccion.has(d.id)} onCheckedChange={() => alternar(d.id)} aria-label={`Seleccionar ${d.nombre}`} /></td>
                      <td className="max-w-[320px] px-3 py-2">
                        <div className="truncate font-medium" title={d.nombre}>{d.nombre || 'Deal sin nombre'}</div>
                        <div className="truncate text-xs text-muted-foreground">{[d.cliente, d.fase !== 'Ganado' ? d.fase : null].filter(Boolean).join(', ')}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{anioDe(d)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{d.precio ? formatoMonto(d.precio, d.moneda) : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {d.items.map((i, k) => {
                            const p = porId.get(i.pilarId);
                            return p ? <PilarChip key={i.pilarId} nombre={p.nombre} color={p.color} activo={p.activo} pct={formatoPorcentaje(pct[k]?.precio)} /> : null;
                          })}
                          {esSin(d) && d.sugerencia && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground" title="Sale del texto que tenía «Tipo de proyecto»">
                              <Sparkles className="h-3 w-3" /> Sugerencia: {d.sugerencia.nombres.join(' + ')}{d.sugerencia.mixta ? ' (reparto por definir)' : ''}
                            </span>
                          )}
                          {d.items.length === 0 && !d.sugerencia && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2"><EstadoDelDeal d={d} /></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {sugerenciaSimple && <Button size="sm" variant="ghost" className="mr-1 h-7 text-xs" disabled={trabajando} onClick={() => aceptar([d.id])}>Aceptar</Button>}
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRepartir(d)}>{d.items.length ? 'Editar' : 'Repartir'}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Mostrando {visibles.length} de {filas.length}</span>
            {filas.length > limite && <Button size="sm" variant="outline" onClick={() => setLimite(l => l + PASO)}>Mostrar {Math.min(PASO, filas.length - limite)} más</Button>}
          </div>
        </>
      )}

      <RepartirDealDialog deal={repartir} onCerrar={() => setRepartir(null)} onGuardado={() => void cargar()} />
      <PilaresAdminDialog abierto={adminAbierto} onCerrar={() => setAdminAbierto(false)} onCambio={() => void cargar()} />
    </div>
  );
}
