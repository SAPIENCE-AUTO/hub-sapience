import { Check, Loader2, Plus, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatoMonto, formatoPorcentaje } from '@/lib/pilares/dinero';
import type { ResumenReparto } from '@/lib/pilares/reparto';
import Pastilla from '@/components/clientes/Pastilla';
import PilarChip from './PilarChip';
import type { PilarCat, ReferenciasCosto } from './tipos';

// Solo dibuja el reparto de un deal entre pilares (la lógica y los datos viven en DealPilares.tsx). Las fichas eligen los pilares; la tabla pide, por pilar, cuánto del precio
// (ingreso) y, si quien mira es Owner o Socio, cuánto del costo, en la moneda del deal. Los porcentajes salen solos.

export interface FilaVista {
  pilar: PilarCat;
  precioTexto: string;
  costoTexto: string;
  precioInvalido: boolean;
  costoInvalido: boolean;
  pctPrecio: number | null;
  pctCosto: number | null;
}

export interface VistaProps {
  pilares: PilarCat[];
  elegidos: string[];
  filas: FilaVista[];
  precioDeal: number | null;
  moneda: string;
  resumen: ResumenReparto;
  totalCosto: number;
  veCostos: boolean;
  puedeAdministrar: boolean;
  referencias: ReferenciasCosto | null;
  sugerencia: { nombres: string[]; textoViejo: string | null } | null;
  sucio: boolean;
  guardando: boolean;
  hayInvalidos: boolean;
  guardadoReciente: boolean;
  onToggle: (pilarId: string) => void;
  onTexto: (pilarId: string, campo: 'precio' | 'costo', valor: string) => void;
  onParejo: () => void;
  onCompletar: (pilarId: string) => void;
  onReajustar: () => void;
  onGuardar: () => void;
  onDescartar: () => void;
  onAdministrar: () => void;
  onUsarSugerencia: () => void;
}

const ESTADO_PASTILLA: Record<ResumenReparto['estado'], { tono: 'exito' | 'alerta' | 'gris' | 'peligro'; texto: (r: ResumenReparto, moneda: string) => string }> = {
  'sin-clasificar': { tono: 'gris', texto: () => 'Sin pilar' },
  listo: { tono: 'exito', texto: () => 'Completo' },
  'sin-precio': { tono: 'gris', texto: () => 'El deal no tiene precio' },
  incompleto: { tono: 'alerta', texto: (r, m) => `Faltan ${formatoMonto(r.falta, m)}` },
  excedido: { tono: 'peligro', texto: (r, m) => `Se pasa por ${formatoMonto(r.sobra, m)}` },
};

export default function DealPilaresVista(p: VistaProps) {
  const unidad = p.moneda === 'MXN' ? 'pesos' : p.moneda;
  const varios = p.filas.length >= 2;
  const estado = ESTADO_PASTILLA[p.resumen.estado];
  const puedeParejo = varios && (p.precioDeal ?? 0) > 0;
  const puedeReajustar = varios && (p.precioDeal ?? 0) > 0 && (p.resumen.estado === 'incompleto' || p.resumen.estado === 'excedido');
  const noGuardable = !p.sucio || p.guardando || p.hayInvalidos || p.resumen.estado === 'excedido';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {p.pilares.filter(x => x.activo || p.elegidos.includes(x.id)).map(x => {
          const sel = p.elegidos.includes(x.id);
          return (
            <button
              key={x.id}
              type="button"
              aria-pressed={sel}
              onClick={() => p.onToggle(x.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${sel ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted'} ${x.activo ? '' : 'opacity-60'}`}
            >
              <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: x.color }} aria-hidden />
              {x.nombre}
              {!x.activo && <span className="text-[10px]">(inactivo)</span>}
              {sel && <Check className="h-3 w-3" />}
            </button>
          );
        })}
        {p.puedeAdministrar && (
          <button type="button" onClick={p.onAdministrar} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted" title="Crear, renombrar o desactivar pilares">
            <Plus className="h-3 w-3" /> Pilar
            <Settings2 className="h-3 w-3 opacity-60" />
          </button>
        )}
        {p.guardadoReciente && <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600"><Check className="h-3 w-3" /> Guardado</span>}
      </div>

      {p.sugerencia && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
          <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
          <span className="text-foreground">
            El texto anterior de este deal decía «{p.sugerencia.textoViejo}». ¿Usar {p.sugerencia.nombres.join(' y ')}?
          </span>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={p.onUsarSugerencia}>Usar</Button>
        </div>
      )}

      {p.filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Elige uno o varios pilares. Con uno solo, todo el deal es de ese pilar; con varios, escribe cuánto es de cada uno y el porcentaje se calcula solo.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Pilar</th>
                <th className="px-3 py-2 text-right font-semibold">Ingreso ({unidad})</th>
                <th className="px-2 py-2 text-right font-semibold">%</th>
                {p.veCostos && <th className="px-3 py-2 text-right font-semibold">Costo ({unidad})</th>}
                {p.veCostos && <th className="px-2 py-2 text-right font-semibold">%</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.filas.map(f => (
                <tr key={f.pilar.id}>
                  <td className="px-3 py-1.5"><PilarChip nombre={f.pilar.nombre} color={f.pilar.color} activo={f.pilar.activo} /></td>
                  <td className="px-3 py-1.5 text-right">
                    {varios ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        {p.resumen.falta > 0 && (
                          <button type="button" onClick={() => p.onCompletar(f.pilar.id)} className="text-[11px] text-primary hover:underline" title="Poner aquí lo que falta para completar el precio">
                            + {formatoMonto(p.resumen.falta, p.moneda)}
                          </button>
                        )}
                        <Input
                          inputMode="decimal"
                          aria-label={`Ingreso de ${f.pilar.nombre}`}
                          className={`h-8 w-32 text-right tabular-nums ${f.precioInvalido ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                          value={f.precioTexto}
                          placeholder="0"
                          onChange={e => p.onTexto(f.pilar.id, 'precio', e.target.value)}
                        />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{p.precioDeal ? `Todo el precio: ${formatoMonto(p.precioDeal, p.moneda)}` : 'Todo el precio del deal'}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{formatoPorcentaje(f.pctPrecio)}</td>
                  {p.veCostos && (
                    <td className="px-3 py-1.5 text-right">
                      <Input
                        inputMode="decimal"
                        aria-label={`Costo de ${f.pilar.nombre}`}
                        className={`ml-auto h-8 w-32 text-right tabular-nums ${f.costoInvalido ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        value={f.costoTexto}
                        placeholder="Sin capturar"
                        onChange={e => p.onTexto(f.pilar.id, 'costo', e.target.value)}
                      />
                    </td>
                  )}
                  {p.veCostos && <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{formatoPorcentaje(f.pctCosto)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/20 text-xs">
              <tr>
                <td className="px-3 py-2 font-semibold text-foreground">Total</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {formatoMonto(p.resumen.asignado, p.moneda)}
                  {p.precioDeal ? <span className="font-normal text-muted-foreground"> de {formatoMonto(p.precioDeal, p.moneda)}</span> : null}
                </td>
                <td className="px-2 py-2" />
                {p.veCostos && <td className="px-3 py-2 text-right tabular-nums font-semibold">{p.totalCosto > 0 ? formatoMonto(p.totalCosto, p.moneda) : '—'}</td>}
                {p.veCostos && <td className="px-2 py-2" />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {p.filas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {varios && <Pastilla tono={estado.tono}>{estado.texto(p.resumen, p.moneda)}</Pastilla>}
            {puedeParejo && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={p.onParejo}>Repartir parejo</Button>}
            {puedeReajustar && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={p.onReajustar} title="Escala los montos para que sumen el precio actual del deal, conservando sus proporciones">Reajustar al precio</Button>}
          </div>
          <div className="flex items-center gap-2">
            {p.sucio && !p.guardando && <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={p.onDescartar}>Descartar</Button>}
            <Button type="button" size="sm" className="h-8 gap-1.5" disabled={noGuardable} onClick={p.onGuardar}>
              {p.guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {p.guardando ? 'Guardando' : 'Guardar reparto'}
            </Button>
          </div>
        </div>
      )}

      {p.veCostos && p.referencias && (p.referencias.real !== null || p.referencias.cotizado !== null) && (
        <p className="text-[11px] text-muted-foreground">
          Costo ya registrado en el Hub (en pesos):{' '}
          {p.referencias.real !== null && <>gastado {formatoMonto(p.referencias.real)} en órdenes de compra</>}
          {p.referencias.real !== null && p.referencias.cotizado !== null && ', '}
          {p.referencias.cotizado !== null && <>cotizado {formatoMonto(p.referencias.cotizado)}</>}
          {p.referencias.otraMoneda && '. Incluye órdenes en dólares sumadas sin convertir'}
          {p.moneda !== 'MXN' && `. El deal está en ${p.moneda}: no son comparables con los montos de arriba`}
          .
        </p>
      )}
    </div>
  );
}
