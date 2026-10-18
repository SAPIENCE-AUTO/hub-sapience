import { useEffect, useMemo, useState } from 'react';
import { savePagosManagementReparto } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CLASE_BOTON_SUAVE, ESTILO_BOTON_PRIMARIO } from '@/components/payments/estilos';
import { motivoDelError } from '@/lib/payments/errores';
import {
  MONEDAS, estadoReparto, montoDe, normalizarNombre, sumaPorcentajes, textoNumero, validarReparto, type Moneda, type ProyectoManagement, type UsuarioReparto,
} from '@/lib/pagosManagement/reparto';
import {
  baseDe, conBase, conMonto, conPartesIguales, conPorcentaje, filaVacia, filasDe, personasDe, presupuestoAGuardar, recalcular, type FilaReparto,
} from '@/lib/pagosManagement/filas';
import { COLOR_ESTADO_REPARTO, fmtMonto, fmtPct } from './formato';

const CLASE_SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const valorDeSelect = (f: FilaReparto): string =>
  f.tipo === 'interno' && f.userId ? `u:${f.userId}` : f.tipo === 'externo' ? (f.nuevoExterno ? '__nueva__' : `e:${f.nombre}`) : '';

/**
 * El reparto del management de un proyecto: el presupuesto (el del deal, que se puede cambiar) y las personas con su porcentaje. Porcentaje y monto
 * están ligados: al escribir uno se calcula el otro. Se pueden repartir menos de 100 % y completarlo después.
 */
export function RepartoDialog({ proyecto, usuarios, externos, onCerrar, onGuardado }: {
  /** null: cerrado. */
  proyecto: ProyectoManagement | null;
  usuarios: UsuarioReparto[];
  externos: string[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [presupuestoTexto, setPresupuestoTexto] = useState('');
  const [moneda, setMoneda] = useState<Moneda>('MXN');
  const [filas, setFilas] = useState<FilaReparto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  useEffect(() => {
    if (!proyecto) return;
    setPresupuestoTexto(proyecto.presupuesto !== null ? String(proyecto.presupuesto) : proyecto.montoDeal > 0 ? String(proyecto.montoDeal) : '');
    setMoneda(proyecto.moneda);
    setFilas(filasDe(proyecto));
    setError(null);
    setConfirmarQuitar(false);
  }, [proyecto]);

  const montoDeal = proyecto?.montoDeal ?? 0;
  const base = baseDe(presupuestoTexto, montoDeal);
  const personas = useMemo(() => personasDe(filas), [filas]);
  const conPorcentajeValido = personas.filter((p) => Number.isFinite(p.porcentaje));
  const suma = sumaPorcentajes(conPorcentajeValido);
  const estado = estadoReparto(conPorcentajeValido);
  const usuariosUsados = new Set(filas.filter((f) => f.tipo === 'interno' && f.userId).map((f) => f.userId as string));
  const externasUsadas = new Set(filas.filter((f) => f.tipo === 'externo' && f.nombre.trim()).map((f) => normalizarNombre(f.nombre)));

  if (!proyecto) return null;
  const editado = presupuestoAGuardar(presupuestoTexto, moneda, proyecto);
  // «Editado» solo tiene sentido si el deal trae un monto con el cual comparar.
  const esEditado = montoDeal > 0 && !('error' in editado) && editado.presupuesto !== null;

  const cambiarPresupuesto = (texto: string) => {
    setPresupuestoTexto(texto);
    setFilas((fs) => conBase(fs, baseDe(texto, montoDeal)));
  };
  const usarDelDeal = () => {
    setMoneda(proyecto.monedaDeal);
    cambiarPresupuesto(proyecto.montoDeal > 0 ? String(proyecto.montoDeal) : '');
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
    const presupuesto = presupuestoAGuardar(presupuestoTexto, moneda, proyecto);
    if ('error' in presupuesto) { setError(presupuesto.error); return; }
    const problema = validarReparto(personas);
    if (problema) { setError(problema); return; }
    setGuardando(true);
    try {
      await savePagosManagementReparto({
        projectId: proyecto.projectId,
        presupuesto: presupuesto.presupuesto,
        moneda: presupuesto.moneda,
        personas: personas.map((p) => ({ userId: p.userId, nombre: p.nombre, externo: p.externo, porcentaje: p.porcentaje })),
      });
      toast.success(personas.length === 0 && presupuesto.presupuesto === null ? 'Reparto quitado' : 'Reparto guardado');
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
      await savePagosManagementReparto({ projectId: proyecto.projectId, presupuesto: null, moneda: null, personas: [] });
      toast.success('Reparto quitado');
      onGuardado();
    } catch (e) {
      toast.error(motivoDelError(e, 'No se pudo quitar el reparto'));
    }
    setGuardando(false);
  };

  const montoRepartido = base !== undefined && base > 0 ? montoDe(base, suma) : 0;
  const resumen =
    estado === 'sinRepartir' ? 'Todavía no hay nada repartido.'
      : estado === 'excedido' ? `Pasa de 100 %: suma ${fmtPct(suma)}.`
        : estado === 'completo' ? `Repartido 100 %${base ? ` · ${fmtMonto(base, moneda)}` : ''}`
          : `Repartido ${fmtPct(suma)}${base ? ` · ${fmtMonto(montoRepartido, moneda)} de ${fmtMonto(base, moneda)}` : ''} — falta ${fmtPct(100 - suma)}${base ? ` (${fmtMonto(montoDe(base, 100 - suma), moneda)})` : ''}`;

  return (
    <>
      <Dialog open onOpenChange={(abierto) => { if (!abierto && !guardando) onCerrar(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {proyecto.codigo}
              {proyecto.cliente && <span className="ml-2 text-sm font-normal text-muted-foreground">{proyecto.cliente}</span>}
            </DialogTitle>
            <DialogDescription>{proyecto.dealNombre ? `Deal: ${proyecto.dealNombre}` : 'Reparto del management entre quienes participan.'}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <section className="space-y-1.5">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="presupuesto-management">Presupuesto de management</Label>
                  <Input
                    id="presupuesto-management"
                    inputMode="decimal"
                    value={presupuestoTexto}
                    placeholder={montoDeal > 0 ? String(montoDeal) : 'Monto'}
                    className="text-right tabular-nums"
                    onChange={(e) => cambiarPresupuesto(e.target.value)}
                  />
                </div>
                <div className="w-24 space-y-1.5">
                  <Label htmlFor="moneda-management">Moneda</Label>
                  <select id="moneda-management" value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)} className={CLASE_SELECT}>
                    {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {montoDeal > 0
                  ? <span>Del deal: {fmtMonto(montoDeal, proyecto.monedaDeal)} (con markup {fmtMonto(proyecto.montoDealConMarkup, proyecto.monedaDeal)})</span>
                  : <span>{proyecto.dealNombre ? 'El deal no tiene monto de management: escribe el presupuesto.' : 'El proyecto no tiene deal vinculado: escribe el presupuesto.'}</span>}
                {esEditado && (
                  <>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Editado</span>
                    <button type="button" onClick={usarDelDeal} className="font-semibold text-foreground underline-offset-2 hover:underline">Usar el del deal</button>
                  </>
                )}
              </p>
              {base === undefined && <p className="text-xs text-destructive">Escribe el presupuesto como un monto, por ejemplo 25000.</p>}
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

              <p className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs font-semibold" style={{ color: COLOR_ESTADO_REPARTO[estado] }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLOR_ESTADO_REPARTO[estado] }} />
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
              Se borran el presupuesto puesto a mano y el reparto entre {proyecto.personas.length} {proyecto.personas.length === 1 ? 'persona' : 'personas'}. No se puede deshacer.
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
