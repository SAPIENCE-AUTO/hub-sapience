import { CornerDownRight, Flag, Repeat2 } from 'lucide-react';
import { ALERTA, EXITO, GOLD, INFO, NEUTRAL, PELIGRO, TEAL } from '@/lib/toolColors';
import { mapaFlujo, type BloqueFlujo } from '@/lib/formularios/flujo';
import type { Definicion } from '@/lib/formularios/tipos';
import { Pill } from './comun';
import { ConMarcador } from './TextoEditable';

const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;

/** Lo que hay que ver de un bloque, en pills chicos y una línea de detalle. */
function Rasgos({ b, compacto }: { b: BloqueFlujo; compacto: boolean }) {
  const filas: { color: string; pill: string; detalle?: string }[] = [];
  if (b.repite) filas.push({ color: INFO, pill: 'Se repite', detalle: b.repite });
  if (b.condicion) filas.push({ color: TEAL, pill: 'Solo si aplica', detalle: b.condicion });
  if (b.termina.length) filas.push({ color: PELIGRO, pill: compacto ? `Termina · ${b.termina.length}` : 'Puede terminar', detalle: b.termina.join(' · ') });
  if (b.descarta.length) filas.push({ color: ALERTA, pill: 'Descarta el bloque', detalle: b.descarta.join(' · ') });
  if (b.excluye.length) filas.push({ color: INFO, pill: 'Fuera de frentes', detalle: b.excluye.join(', ') });
  if (b.frentes.length) filas.push({ color: EXITO, pill: compacto ? `Frentes · ${b.frentes.length}` : 'Toca frentes', detalle: b.frentes.join(', ') });
  if (b.alertas.length) filas.push({ color: ALERTA, pill: 'Alerta', detalle: b.alertas.join(' · ') });
  if (b.nse) filas.push({ color: GOLD, pill: 'NSE' });
  if (filas.length === 0) return null;
  if (compacto) {
    return <div className="mt-1 flex flex-wrap gap-1">{filas.map((f) => <Pill key={f.pill} color={f.color}>{f.pill}</Pill>)}</div>;
  }
  return (
    <div className="mt-2 space-y-1">
      {filas.map((f) => (
        <div key={f.pill} className="flex items-start gap-2 text-[12.5px] leading-snug">
          <Pill color={f.color}>{f.pill}</Pill>
          {f.detalle && <span className="min-w-0 text-muted-foreground">{f.detalle}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * El mapa del flujo: los bloques en orden, con lo que se repite, lo que solo
 * aparece si aplica (corrido a la derecha), dónde puede terminar alguien y
 * qué toca frentes o da alerta. Un clic lleva a esa parte del documento.
 * `compacto` es la versión chica que va junto al Documento.
 */
export function MapaFlujo({ def, compacto = false, onIr }: { def: Definicion; compacto?: boolean; onIr: (seccionId: string) => void }) {
  const bloques = mapaFlujo(def);
  const frentes = def.frentes ?? [];
  return (
    <div className={compacto ? 'text-sm' : 'mx-auto max-w-3xl'}>
      <ol className="relative">
        {bloques.map((b, i) => {
          const rama = !!b.condicion;
          return (
            <li key={b.id} className={`relative ${rama ? (compacto ? 'pl-4' : 'pl-10') : ''}`}>
              {i > 0 && <span aria-hidden className={`absolute top-0 h-3 w-px bg-[#0F3D4D]/25 ${compacto ? 'left-3' : 'left-5'}`} />}
              {rama && <CornerDownRight aria-hidden className={`absolute text-[#0F3D4D]/40 ${compacto ? 'left-0 top-4 h-3.5 w-3.5' : 'left-3 top-5 h-5 w-5'}`} />}
              <button
                type="button"
                onClick={() => onIr(b.id)}
                className={`mt-3 w-full rounded-lg border bg-white text-left transition-colors hover:border-[#0F3D4D]/50 hover:bg-[#0F3D4D]/[0.03] ${
                  rama ? 'border-dashed' : ''
                } ${b.repite ? 'shadow-[3px_3px_0_0_rgba(15,61,77,0.12)]' : ''} ${compacto ? 'px-2.5 py-2' : 'px-4 py-3'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`min-w-0 font-semibold text-[#0F3D4D] ${compacto ? 'text-[12.5px] leading-snug' : 'text-[15px]'}`}>
                    {b.repite && <Repeat2 className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />}
                    <ConMarcador texto={b.titulo} />
                  </span>
                  <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                    {b.soloContenido ? 'Pantalla de texto' : plural(b.preguntas, 'pregunta', 'preguntas')}
                    {!compacto && b.condicionales > 0 && ` · ${plural(b.condicionales, 'solo si aplica', 'solo si aplican')}`}
                  </span>
                </div>
                <Rasgos b={b} compacto={compacto} />
              </button>
            </li>
          );
        })}
      </ol>
      <div className={`mt-4 rounded-lg border-l-4 bg-[#257E55]/[0.06] ${compacto ? 'px-2.5 py-2 text-[12px]' : 'px-4 py-3 text-[13px]'}`} style={{ borderColor: EXITO }}>
        <p className="flex items-center gap-1.5 font-semibold" style={{ color: EXITO }}><Flag className="h-3.5 w-3.5" />Al terminar</p>
        {frentes.length
          ? <p className="mt-0.5 text-[#1F1F23]">Califica si entra a algún frente: {frentes.map((f) => `${f.nombre} (${f.meta})`).join(', ')}.</p>
          : <p className="mt-0.5 text-muted-foreground">Sin frentes: nadie califica todavía.</p>}
        <p className="mt-0.5" style={{ color: NEUTRAL }}>Quien termina antes ve un mensaje neutral, sin saber por qué.</p>
      </div>
    </div>
  );
}
