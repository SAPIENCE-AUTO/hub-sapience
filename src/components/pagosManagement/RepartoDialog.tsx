import { useEffect, useMemo, useState } from 'react';
import { savePagosManagementReparto } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Plus, Trash2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CLASE_BOTON_SUAVE, ESTILO_BOTON_PRIMARIO, FONDO_ALERTA, TEXTO_ALERTA } from '@/components/payments/estilos';
import { motivoDelError } from '@/lib/payments/errores';
import {
  MONEDAS, costoDealDe, esPorOmision, estadoReparto, leerMonto, managementDe, montoDe, normalizarNombre, redondear, rubrosPorOmision, sumaPorcentajes, textoNumero, validarReparto,
  type DealManagement, type Moneda, type ProyectoManagement, type Rubro, type RubrosDeal, type UsuarioReparto,
} from '@/lib/pagosManagement/reparto';
import {
  agregarRubro, conBase, conMonto, conPartesIguales, conPorcentaje, conTextoDeRubro, dealAGuardar, filaVacia, filasDe, personasDe, quitarRubro, recalcular, rubroEditado,
  rubrosAGuardar, rubrosDe, rubrosFaltantes, totalDe, type FilaReparto, type FilaRubro,
} from '@/lib/pagosManagement/filas';
import { COLOR_ESTADO_REPARTO, fmtMonto, fmtPct, fmtUnidades } from './formato';

const CLASE_SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const valorDeSelect = (f: FilaReparto): string =>
  f.tipo === 'interno' && f.userId ? `u:${f.userId}` : f.tipo === 'externo' ? (f.nuevoExterno ? '__nueva__' : `e:${f.nombre}`) : '';

/**
 * El reparto de un proyecto: de qué deal sale su Management, el presupuesto (por omisión el Management de su deal, al que se le pueden sumar otros
 * rubros de la cotización; todos los montos se pueden cambiar) y las personas con su porcentaje. Porcentaje y monto están ligados: al escribir uno se
 * calcula el otro. Se pueden repartir menos de 100 % y completarlo después. Si el deal se fragmenta en varios proyectos, cada uno escribe lo que se
 * lleva y aquí se ve cuánto queda de lo cotizado.
 */
export function RepartoDialog({ proyecto, deals, asignados, dealInicial, usuarios, externos, onCerrar, onGuardado }: {
  /** null: cerrado. */
  proyecto: ProyectoManagement | null;
  /** Los deals con Management cotizado a los que se le puede asignar el proyecto. */
  deals: DealManagement[];
  /** Lo que ya se llevan los proyectos de cada deal (la suma de su Management), por deal. */
  asignados: Record<string, number>;
  /** El deal con el que abre un proyecto que todavía no sale de él (al agregarlo desde la pestaña de Deals). */
  dealInicial?: string | null;
  usuarios: UsuarioReparto[];
  externos: string[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [rubroFilas, setRubroFilas] = useState<FilaRubro[]>([]);
  const [moneda, setMoneda] = useState<Moneda>('MXN');
  const [filas, setFilas] = useState<FilaReparto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  /** El deal elegido; '' = ninguno. */
  const [dealId, setDealId] = useState('');

  useEffect(() => {
    if (!proyecto) return;
    const inicial = dealInicial ?? proyecto.dealId ?? '';
    const otroDeal = inicial !== (proyecto.dealId ?? '');
    // Con otro deal que el de siempre no hay nada «del deal» por omisión: el Management se escribe, y la moneda es la de ese deal.
    const filasRubro = rubrosDe(proyecto);
    setRubroFilas(otroDeal ? conTextoDeRubro(filasRubro, 'Management', '') : filasRubro);
    setMoneda(otroDeal ? deals.find((g) => g.dealId === inicial)?.moneda ?? proyecto.moneda : proyecto.moneda);
    setDealId(inicial);
    setFilas(filasDe(proyecto));
    setError(null);
    setConfirmarQuitar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deals` solo se lee al abrir: si cambia a media captura no debe borrar lo escrito.
  }, [proyecto, dealInicial]);

  const personas = useMemo(() => personasDe(filas), [filas]);
  const conPorcentajeValido = personas.filter((p) => Number.isFinite(p.porcentaje));
  const suma = sumaPorcentajes(conPorcentajeValido);
  const estado = estadoReparto(conPorcentajeValido);
  const usuariosUsados = new Set(filas.filter((f) => f.tipo === 'interno' && f.userId).map((f) => f.userId as string));
  const externasUsadas = new Set(filas.filter((f) => f.tipo === 'externo' && f.nombre.trim()).map((f) => normalizarNombre(f.nombre)));

  if (!proyecto) return null;

  // El deal elegido. Si no es el de siempre (el asignado o, si no, el vinculado), nada se toma «del deal» por omisión: cada monto se escribe.
  const dealGuardado = proyecto.dealId ?? '';
  const cambiaDeDeal = dealId !== dealGuardado;
  const deal = deals.find((g) => g.dealId === dealId);
  const rubrosDeal: RubrosDeal = cambiaDeDeal ? {} : proyecto.rubrosDeal;
  const monedaDeal: Moneda = cambiaDeDeal ? deal?.moneda ?? proyecto.monedaDeal : proyecto.monedaDeal;
  const base = totalDe(rubroFilas, rubrosDeal);
  const monedaDistinta = moneda !== monedaDeal;

  // Lo que se lleva este proyecto del Management del deal (lo escrito o, si se dejó vacío, lo de su deal) y cuánto quedaría de lo cotizado.
  const filaManagement = rubroFilas.find((f) => f.rubro === 'Management');
  const montoEscrito = filaManagement ? leerMonto(filaManagement.texto) : undefined;
  const montoManagement = typeof montoEscrito === 'number' ? montoEscrito : montoEscrito === null ? costoDealDe(rubrosDeal, 'Management') : 0;
  const yaLlevaba = deal && proyecto.dealId === deal.dealId ? managementDe(proyecto) : 0;
  const delResto = deal ? (asignados[deal.dealId] ?? 0) - yaLlevaba : 0; // lo que se llevan los demás proyectos del deal
  const quedaria = deal ? redondear(deal.cotizado - delResto - montoManagement) : 0;
  const mostrarSaldo = !!deal && (cambiaDeDeal || !!proyecto.dealFragmentado);

  const vinculado = proyecto.dealVinculadoId ?? '';
  // El deal vinculado puede no estar en la lista (si no tiene Management cotizado): se deja para poder volver a él.
  const opcionesDeal = [
    ...(vinculado && !deals.some((g) => g.dealId === vinculado) ? [{ id: vinculado, etiqueta: `${proyecto.dealVinculadoNombre ?? 'Deal vinculado'} (vinculado)` }] : []),
    ...deals.map((g) => ({ id: g.dealId, etiqueta: `${g.nombre}${g.cliente ? ` · ${g.cliente}` : ''}${g.dealId === vinculado ? ' (vinculado)' : ''}` })),
  ];

  const elegirDeal = (id: string) => {
    setDealId(id);
    const elegido = deals.find((g) => g.dealId === id);
    const otro = id !== dealGuardado;
    // Con otro deal el Management se escribe; al volver al de siempre vuelve lo que traía. Y la moneda es la del deal elegido.
    const nuevas = otro ? conTextoDeRubro(rubroFilas, 'Management', '') : conTextoDeRubro(rubroFilas, 'Management', rubrosDe(proyecto).find((f) => f.rubro === 'Management')?.texto ?? '');
    setRubroFilas(nuevas);
    setFilas((fs) => conBase(fs, totalDe(nuevas, otro ? {} : proyecto.rubrosDeal)));
    if (elegido && elegido.moneda !== moneda) setMoneda(elegido.moneda);
  };
  /** Suma el precio de una unidad cotizada al monto de Management (un vacío cuenta como cero, no como lo del deal). */
  const sumarUnidad = (precio: number) => {
    cambiarRubros(conTextoDeRubro(rubroFilas, 'Management', String(redondear((typeof montoEscrito === 'number' ? montoEscrito : 0) + precio))));
  };
  /** Lo que queda de lo cotizado, sin lo que se llevan los demás proyectos: para el último proyecto que cierra el deal. */
  const usarLoQueQueda = () => {
    if (deal) cambiarRubros(conTextoDeRubro(rubroFilas, 'Management', String(redondear(deal.cotizado - delResto))));
  };

  /** Cambió algo de los rubros: los porcentajes de las personas se quedan y sus montos se vuelven a calcular con el presupuesto nuevo. */
  const cambiarRubros = (nuevos: FilaRubro[]) => {
    setRubroFilas(nuevos);
    setFilas((fs) => conBase(fs, totalDe(nuevos, rubrosDeal)));
  };
  const usarDelDeal = (rubro: Rubro) => {
    const costo = costoDealDe(rubrosDeal, rubro);
    cambiarRubros(conTextoDeRubro(rubroFilas, rubro, costo > 0 ? String(costo) : ''));
  };
  const cambiarFila = (i: number, cambio: Partial<FilaReparto>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  const elegirPersona = (i: number, valor: string) => {
    if (valor.startsWith('u:')) {
      const usuario = usuarios.find((u) => u.id === valor.slice(2));
      cambiarFila(i, { tipo: 'interno', userId: valor.slice(2), nombre: usuario?.nombre ?? '', nuevoExterno: false });
    } else if (valor.startsWith('e:')) cambiarFila(i, { tipo: 'externo', userId: null, nombre: valor.slice(2), nuevoExterno: false });
    else if (valor === '__nueva__') cambiarFila(i, { tipo: 'externo', userId: null, nombre: '', nuevoExterno: true });
    else cambiarFila(i, { tipo: 'sin', userId: null, nombre: '', nuevoExterno: false });
  };
  const agregarPersona = () => {
    // La persona nueva ya trae lo que falta para llegar a 100, si algo falta y los demás renglones ya tienen su porcentaje.
    const falta = 100 - suma;
    const pct = suma > 0 && falta > 0.0001 && filas.every((f) => f.pct.trim() !== '') ? textoNumero(falta) : '';
    setFilas((fs) => recalcular([...fs, filaVacia(pct)], base));
  };

  const guardar = async () => {
    setError(null);
    const presupuesto = rubrosAGuardar(rubroFilas, moneda, { rubrosDeal, monedaDeal });
    if ('error' in presupuesto) { setError(presupuesto.error); return; }
    const problema = validarReparto(personas);
    if (problema) { setError(problema); return; }
    const dealAsignado = dealAGuardar(dealId, proyecto.dealVinculadoId);
    if (dealAsignado && !(montoManagement > 0)) { setError('Escribe cuánto management se lleva este proyecto del deal.'); return; }
    setGuardando(true);
    try {
      await savePagosManagementReparto({
        projectId: proyecto.projectId,
        rubros: presupuesto.rubros,
        moneda: presupuesto.moneda,
        personas: personas.map((p) => ({ userId: p.userId, nombre: p.nombre, externo: p.externo, porcentaje: p.porcentaje })),
        dealId: dealAsignado,
      });
      toast.success(personas.length === 0 && esPorOmision(presupuesto.rubros) && !dealAsignado ? 'Reparto quitado' : 'Reparto guardado');
      onGuardado();
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudo guardar el reparto'));
    }
    setGuardando(false);
  };

  const quitar = async () => {
    setConfirmarQuitar(false);
    setGuardando(true);
    try {
      await savePagosManagementReparto({ projectId: proyecto.projectId, rubros: rubrosPorOmision(), moneda: null, personas: [], dealId: null });
      toast.success('Reparto quitado');
      onGuardado();
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudo quitar el reparto'));
    }
    setGuardando(false);
  };

  const montoRepartido = base !== undefined && base > 0 ? montoDe(base, suma) : 0;
  // Pasarse de 100 % es un aviso, no un error: se muestra pero Guardar sigue funcionando.
  const seTePasa = estado === 'excedido';
  const resumen =
    estado === 'sinRepartir' ? 'Todavía no hay nada repartido.'
      : estado === 'completo' ? `Repartido 100 %${base ? ` · ${fmtMonto(base, moneda)}` : ''}`
        : `Repartido ${fmtPct(suma)}${base ? ` · ${fmtMonto(montoRepartido, moneda)} de ${fmtMonto(base, moneda)}` : ''} — ${seTePasa ? 'se pasa' : 'falta'} ${fmtPct(Math.abs(100 - suma))}${base ? ` (${fmtMonto(montoDe(base, Math.abs(100 - suma)), moneda)})` : ''}`;
  const faltantes = rubrosFaltantes(rubroFilas);

  return (
    <>
      <Dialog open onOpenChange={(abierto) => { if (!abierto && !guardando) onCerrar(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {proyecto.codigo}
              {proyecto.cliente && <span className="ml-2 text-sm font-normal text-muted-foreground">{proyecto.cliente}</span>}
            </DialogTitle>
            <DialogDescription>Reparto del presupuesto entre quienes participan.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="deal-proyecto" className="text-sm font-semibold">Deal</Label>
                <select id="deal-proyecto" value={dealId} onChange={(e) => elegirDeal(e.target.value)} className={`${CLASE_SELECT} !h-8 max-w-[19rem]`}>
                  {!vinculado && <option value="">Sin deal</option>}
                  {opcionesDeal.map((o) => <option key={o.id} value={o.id}>{o.etiqueta}</option>)}
                </select>
              </div>
              {cambiaDeDeal && deal && vinculado && <p className="text-xs text-muted-foreground">No cambia el deal vinculado del proyecto (presupuesto, costos y cobranza).</p>}
              {mostrarSaldo && deal && (quedaria < -0.004 ? (
                <p role="status" className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ backgroundColor: FONDO_ALERTA, color: TEXTO_ALERTA }}>
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>Se pasa {fmtMonto(-quedaria, deal.moneda)} de lo cotizado ({fmtMonto(deal.cotizado, deal.moneda)})</span>
                </p>
              ) : (
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                  <span className="font-semibold">Quedan {fmtMonto(quedaria, deal.moneda)} de {fmtMonto(deal.cotizado, deal.moneda)}</span>
                  {deal.unidades.length > 0 && <span className="ml-2 tabular-nums text-muted-foreground">{fmtUnidades(deal.unidades, deal.moneda)}</span>}
                </p>
              ))}
            </section>

            <section className="space-y-3">
              <div className="flex items-end justify-between gap-2">
                <p className="text-sm font-semibold">Presupuesto</p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="moneda-presupuesto" className="text-xs text-muted-foreground">Moneda</Label>
                  <select id="moneda-presupuesto" value={moneda} disabled={cambiaDeDeal && !!deal} title={cambiaDeDeal && deal ? 'La del deal' : undefined} onChange={(e) => setMoneda(e.target.value as Moneda)} className={`${CLASE_SELECT} !h-8 !w-24 disabled:cursor-not-allowed disabled:opacity-60`}>
                    {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {rubroFilas.map((f, i) => {
                const costo = costoDealDe(rubrosDeal, f.rubro);
                const editado = rubroEditado(f, rubrosDeal, moneda, monedaDeal);
                return (
                  <div key={f.clave} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`rubro-${i}`} className="flex-1 text-sm font-medium">{f.rubro}</Label>
                      <Input
                        id={`rubro-${i}`}
                        inputMode="decimal"
                        value={f.texto}
                        placeholder={costo > 0 ? String(costo) : 'Monto'}
                        className="w-40 text-right tabular-nums"
                        onChange={(e) => cambiarRubros(conTextoDeRubro(rubroFilas, f.rubro, e.target.value))}
                      />
                      {rubroFilas.length > 1 && (
                        <button type="button" aria-label={`Quitar ${f.rubro}`} onClick={() => cambiarRubros(quitarRubro(rubroFilas, f.rubro))} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {costo > 0
                        ? <span>Del deal: {fmtMonto(costo, monedaDeal)} (con markup {fmtMonto(rubrosDeal[f.rubro]?.conMarkup ?? 0, monedaDeal)})</span>
                        : <span>{f.rubro === 'Management' && mostrarSaldo ? 'Escribe cuánto se lleva de este deal.'
                          : dealId ? `El deal no tiene monto de ${f.rubro}: escríbelo.` : 'El proyecto no tiene deal: escribe el monto.'}</span>}
                      {editado && (
                        <>
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Editado</span>
                          {!monedaDistinta && <button type="button" onClick={() => usarDelDeal(f.rubro)} className="font-semibold text-foreground underline-offset-2 hover:underline">Usar el del deal</button>}
                        </>
                      )}
                    </p>
                    {f.rubro === 'Management' && mostrarSaldo && deal && costo <= 0 && (deal.unidades.length > 0 || deal.cotizado - delResto > 0) && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="text-xs text-muted-foreground">Sumar</span>
                        {deal.unidades.map((u) => (
                          <button key={u.precio} type="button" className={CLASE_BOTON_SUAVE} onClick={() => sumarUnidad(u.precio)}>+ {fmtMonto(u.precio, deal.moneda)}</button>
                        ))}
                        {deal.cotizado - delResto > 0 && <button type="button" className={CLASE_BOTON_SUAVE} onClick={usarLoQueQueda}>Lo que queda ({fmtMonto(deal.cotizado - delResto, deal.moneda)})</button>}
                      </div>
                    )}
                  </div>
                );
              })}

              {monedaDistinta && (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>El deal está en {monedaDeal}: escribe los montos en {moneda}.</span>
                  <button type="button" onClick={() => setMoneda(monedaDeal)} className="font-semibold text-foreground underline-offset-2 hover:underline">Volver a {monedaDeal}</button>
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                {faltantes.length > 0 ? (
                  <select
                    aria-label="Agregar rubro"
                    value=""
                    onChange={(e) => { if (e.target.value) cambiarRubros(agregarRubro(rubroFilas, e.target.value as Rubro, rubrosDeal)); }}
                    className="h-8 rounded-[10px] border bg-card px-2.5 text-xs font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">+ Agregar rubro</option>
                    {faltantes.map((r) => {
                      const costo = costoDealDe(rubrosDeal, r);
                      return <option key={r} value={r}>{r}{costo > 0 ? ` (deal ${fmtMonto(costo, monedaDeal)})` : ''}</option>;
                    })}
                  </select>
                ) : <span />}
                {rubroFilas.length > 1 && base !== undefined && (
                  <p className="text-sm">Presupuesto total <span className="ml-1 font-bold tabular-nums">{fmtMonto(base, moneda)}</span></p>
                )}
              </div>
              {base === undefined && <p className="text-xs text-destructive">Escribe cada monto como un número, por ejemplo 25000.</p>}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4" />Reparto</p>
                <div className="flex gap-2">
                  <button type="button" className={CLASE_BOTON_SUAVE} onClick={() => setFilas((fs) => conPartesIguales(fs, base))} disabled={filas.length < 2}>Partes iguales</button>
                  <button type="button" className={CLASE_BOTON_SUAVE} onClick={agregarPersona}><Plus className="h-3.5 w-3.5" />Agregar persona</button>
                </div>
              </div>

              <div className="space-y-2">
                {filas.map((f, i) => (
                  <div key={f.clave} className="flex flex-wrap items-start gap-2 rounded-lg border p-2 sm:border-0 sm:p-0">
                    <div className="min-w-[11rem] flex-1 space-y-1.5">
                      <select aria-label={`Persona ${i + 1}`} value={valorDeSelect(f)} onChange={(e) => elegirPersona(i, e.target.value)} className={CLASE_SELECT}>
                        <option value="">Elegir persona…</option>
                        <optgroup label="Equipo">
                          {usuarios.map((u) => (
                            <option key={u.id} value={`u:${u.id}`} disabled={usuariosUsados.has(u.id) && f.userId !== u.id}>{u.nombre}{u.departamento ? ` · ${u.departamento}` : ''}</option>
                          ))}
                        </optgroup>
                        {externos.length > 0 && (
                          <optgroup label="Externas (ya usadas)">
                            {externos.map((nombre) => (
                              <option key={nombre} value={`e:${nombre}`} disabled={externasUsadas.has(normalizarNombre(nombre)) && normalizarNombre(f.nombre) !== normalizarNombre(nombre)}>{nombre}</option>
                            ))}
                          </optgroup>
                        )}
                        <option value="__nueva__">Otra persona externa…</option>
                      </select>
                      {f.tipo === 'externo' && f.nuevoExterno && (
                        <Input aria-label={`Nombre de la persona externa ${i + 1}`} value={f.nombre} placeholder="Nombre de la persona externa" maxLength={120} onChange={(e) => cambiarFila(i, { nombre: e.target.value })} />
                      )}
                    </div>
                    <div className="relative w-28">
                      <Input aria-label={`Porcentaje de ${f.nombre || `la persona ${i + 1}`}`} inputMode="decimal" value={f.pct} placeholder="0" className="pr-6 text-right tabular-nums" onChange={(e) => setFilas((fs) => conPorcentaje(fs, i, e.target.value, base))} />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                    </div>
                    <div className="relative w-32">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                      <Input aria-label={`Monto de ${f.nombre || `la persona ${i + 1}`}`} inputMode="decimal" value={f.monto} placeholder="0" disabled={!base} className="pl-5 text-right tabular-nums" onChange={(e) => setFilas((fs) => conMonto(fs, i, e.target.value, base))} />
                    </div>
                    <button type="button" aria-label={`Quitar a ${f.nombre || `la persona ${i + 1}`}`} onClick={() => setFilas((fs) => (fs.length === 1 ? [filaVacia()] : fs.filter((_, j) => j !== i)))} className="mt-1.5 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <p
                role={seTePasa ? 'status' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${seTePasa ? '' : 'bg-muted/50'}`}
                style={seTePasa ? { backgroundColor: FONDO_ALERTA, color: TEXTO_ALERTA } : { color: COLOR_ESTADO_REPARTO[estado] }}
              >
                {seTePasa
                  ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  : <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLOR_ESTADO_REPARTO[estado] }} />}
                {resumen}
              </p>
              {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
            </section>
          </div>

          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            <div>
              {proyecto.repartoId && (
                <button type="button" onClick={() => setConfirmarQuitar(true)} disabled={guardando} className="text-xs font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-60">Quitar reparto</button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
              <Button className="gap-1.5 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO} onClick={guardar} disabled={guardando}>
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmarQuitar} onOpenChange={setConfirmarQuitar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar el reparto de {proyecto.codigo}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran el reparto entre {proyecto.personas.length} {proyecto.personas.length === 1 ? 'persona' : 'personas'} y los cambios al presupuesto{proyecto.dealAsignadoId ? '; el proyecto vuelve a seguir a su deal vinculado' : ''}. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={quitar}>Quitar reparto</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
