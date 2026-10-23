import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Clock, Repeat } from 'lucide-react';
import { ALERTA, EXITO, INFO, NEUTRAL, PELIGRO, TEAL } from '@/lib/toolColors';
import { TOPE_MINUTOS } from '@/lib/formularios/duracion';
import { compararEstructuras, minutosDeEstructura, type CambioSeccion, type Estructura, type FrentePlan } from '@/lib/formularios/generador';
import { reglaVigente } from '@/lib/formularios/nse';
import { PAISES } from '@/lib/formularios/paises';
import { TIPOS } from '@/lib/formularios/tipos';
import { Pill } from '../editor/comun';
import type { GeneradorUI } from './useGenerador';
import { Supuestos } from './Supuestos';
import { AvanceIA, Etiqueta, MarcaIA, botonSecundario, botonTeal } from './comun';

const COLOR_CAMBIO: Record<CambioSeccion | 'sale', string> = { igual: NEUTRAL, cambia: ALERTA, nueva: INFO, sale: PELIGRO };
const NOMBRE_CAMBIO: Record<CambioSeccion | 'sale', string> = { igual: 'Igual', cambia: 'Cambia', nueva: 'Nueva', sale: 'Sale' };
const sinMarca = (t: string) => t.split('{opcion}').join('…');

function Minutos({ e }: { e: Estructura }) {
  const { tipico, maximo } = minutosDeEstructura(e).total;
  const color = tipico > TOPE_MINUTOS ? PELIGRO : maximo > TOPE_MINUTOS ? ALERTA : EXITO;
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color }} title="Estimado con el mismo cálculo de la barra del editor.">
      <Clock className="h-3.5 w-3.5" />≈ {tipico} min{maximo > tipico ? ` · hasta ${maximo}` : ''}<span className="font-normal text-muted-foreground">· tope {TOPE_MINUTOS}</span>
    </span>
  );
}

function FilaFrente({ f, editable, onGuardar }: { f: FrentePlan; editable: boolean; onGuardar: (c: { nombre?: string; meta?: number }) => void }) {
  const [nombre, setNombre] = useState(f.nombre);
  const [meta, setMeta] = useState(String(f.meta));
  useEffect(() => { setNombre(f.nombre); setMeta(String(f.meta)); }, [f.nombre, f.meta]);
  const guardarNombre = () => { if (nombre.trim() && nombre.trim() !== f.nombre) onGuardar({ nombre: nombre.trim() }); else setNombre(f.nombre); };
  const guardarMeta = () => { const n = Number(meta); if (Number.isInteger(n) && n > 0 && n !== f.meta) onGuardar({ meta: n }); else setMeta(String(f.meta)); };
  return (
    <li className="grid gap-x-3 gap-y-0.5 border-b border-[#E4E4E7] py-2 last:border-0 sm:grid-cols-[minmax(12rem,19rem)_4.5rem_1fr]">
      {editable
        ? <input aria-label="Nombre del perfil" value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={guardarNombre} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="rounded-md border bg-white px-2 py-1 text-sm font-semibold text-[#1F1F23]" />
        : <span className="text-sm font-semibold text-[#1F1F23]">{f.nombre}</span>}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {editable
          ? <input aria-label="Cuota" inputMode="numeric" value={meta} onChange={(e) => setMeta(e.target.value.replace(/\D/g, ''))} onBlur={guardarMeta} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className="w-14 rounded-md border bg-white px-2 py-1 text-sm text-[#1F1F23]" />
          : <span className="text-sm text-[#1F1F23]">{f.meta}</span>}
        <span className="sm:hidden">casos</span>
      </label>
      <span className="text-[13px] leading-snug text-[#257E55]">{f.quien}</span>
    </li>
  );
}

/**
 * Etapa 1 del generador: la estructura para revisar rápido antes de que se
 * escriban las preguntas. Se corrige con un comentario a la IA (y el nombre y
 * la cuota de los frentes, a mano); al aprobarla se escriben las preguntas.
 * También se abre desde un filtro ya escrito para cambiar su estructura:
 * entonces dice qué secciones cambian y cuáles se quedan igual.
 */
export function EstructuraPanel({ gen, actual, regla, onCerrar }: {
  gen: GeneradorUI;
  /** La estructura de lo ya escrito, cuando se abre desde el documento y aún no hay propuesta. */
  actual?: Estructura;
  /** La regla de NSE que ya tiene el filtro escrito (puede no ser la vigente del país). */
  regla?: string;
  onCerrar?: () => void;
}) {
  const g = gen.g;
  const propuesta = g?.etapa === 'estructura' ? g.estructura : undefined;
  const e = propuesta ?? actual;
  const [pedido, setPedido] = useState('');
  const comparacion = useMemo(() => (propuesta && g?.base ? compararEstructuras(g.base, propuesta) : undefined), [propuesta, g?.base]);
  if (!e) return null;

  const frentesIguales = !g?.base || JSON.stringify(g.base.frentes.map((f) => [f.id, f.nombre, f.meta, f.quien])) === JSON.stringify(e.frentes.map((f) => [f.id, f.nombre, f.meta, f.quien]));
  const nadaCambia = !!comparacion && !comparacion.salen.length && Object.values(comparacion.secciones).every((c) => c === 'igual') && frentesIguales;
  const base = g?.base;
  const problemas = propuesta ? gen.problemasEstructura : [];
  const pais = PAISES[e.pais];
  const reglaNse = regla ?? reglaVigente(e.pais);

  const pedirCambio = async () => {
    if (!pedido.trim()) return;
    if (await gen.pedirEstructura(pedido.trim(), propuesta ? 'propuesta' : 'escrito')) setPedido('');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold" style={{ color: TEAL }}>{propuesta ? (base ? 'Estructura propuesta' : 'Estructura') : 'Estructura del filtro'}</h3>
        <Minutos e={e} />
        {comparacion && (
          <span className="flex flex-wrap gap-1.5">
            {(['cambia', 'nueva'] as const).map((c) => {
              const n = Object.values(comparacion.secciones).filter((x) => x === c).length;
              return n ? <Pill key={c} color={COLOR_CAMBIO[c]}>{n} {c === 'cambia' ? (n === 1 ? 'cambia' : 'cambian') : n === 1 ? 'nueva' : 'nuevas'}</Pill> : null;
            })}
            {comparacion.salen.length > 0 && <Pill color={COLOR_CAMBIO.sale}>{comparacion.salen.length} {comparacion.salen.length === 1 ? 'sale' : 'salen'}</Pill>}
          </span>
        )}
      </div>

      <div className="grid gap-4 rounded-xl border bg-white px-4 py-4 shadow-sm sm:grid-cols-[12rem_1fr]">
        <div className="space-y-2">
          <div><Etiqueta>País</Etiqueta><p className="text-sm">{pais?.nombre ?? e.pais}{reglaNse ? ` · NSE ${reglaNse}` : ' · sin regla de NSE'}</p></div>
          <div><Etiqueta>Título que ve el participante</Etiqueta><p className="text-sm">{e.tituloPublico}</p></div>
        </div>
        <div><Etiqueta>A quién se busca</Etiqueta><p className="whitespace-pre-line text-sm leading-relaxed text-[#45454D]">{e.perfil || '—'}</p></div>
      </div>

      <section className="rounded-xl border bg-white px-4 py-3 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <Etiqueta>Perfiles y cuotas</Etiqueta>
          <span className="text-xs text-muted-foreground">Total {e.frentes.reduce((n, f) => n + f.meta, 0)}</span>
        </div>
        {e.frentes.length === 0 && <p className="py-2 text-sm" style={{ color: PELIGRO }}>Sin perfiles: nadie calificaría.</p>}
        <ul>{e.frentes.map((f) => <FilaFrente key={f.id} f={f} editable={!!propuesta} onGuardar={(c) => gen.editarFrente(f.id, c).catch((err) => toast.error((err as Error).message))} />)}</ul>
      </section>

      <section className="space-y-2">
        <Etiqueta>Secciones, en orden</Etiqueta>
        {comparacion?.salen.map((id) => (
          <div key={id} className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground line-through">
            <Pill color={COLOR_CAMBIO.sale}>Sale</Pill>{sinMarca(base?.secciones.find((s) => s.id === id)?.titulo ?? id)}
          </div>
        ))}
        {e.secciones.map((s) => {
          const m = minutosDeEstructura(e).porSeccion[s.id];
          const cambio = comparacion?.secciones[s.id];
          return (
            <article key={s.id} className={`rounded-lg border bg-white px-3 py-2.5 ${s.aparece ? 'ml-4 border-dashed' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 className="text-sm font-bold text-[#1F1F23]">{sinMarca(s.titulo)}</h4>
                {cambio && cambio !== 'igual' && <Pill color={COLOR_CAMBIO[cambio]}>{NOMBRE_CAMBIO[cambio]}</Pill>}
                {s.repetirPor && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Repeat className="h-3 w-3" />se repite</span>}
                {m && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">≈ {m.tipico} min</span>}
              </div>
              {s.para && <p className="text-[12.5px] text-muted-foreground">{s.para}</p>}
              {s.aparece && <p className="text-[12.5px]" style={{ color: TEAL }}>↳ {s.aparece}</p>}
              {s.nse
                ? <p className="mt-1 text-[12.5px] text-[#45454D]">Preguntas oficiales del NSE{reglaNse ? ` (${reglaNse})` : ''}: las pone el Hub.</p>
                : (
                  <ul className="mt-1 space-y-0.5">
                    {s.preguntas.map((p) => (
                      <li key={p.id} className="text-[13px] leading-snug text-[#1F1F23]">
                        {p.nombre && <span className="mr-1.5 font-semibold" style={{ color: TEAL }}>{sinMarca(p.nombre)}</span>}
                        {sinMarca(p.texto)}
                        <span className="ml-1.5 text-[10.5px] uppercase tracking-wide text-muted-foreground">{TIPOS[p.tipo]?.nombre ?? p.tipo}{p.opciones?.length ? ` · ${p.opciones.length} opciones` : ''}</span>
                        {p.soloSi && <span className="block text-[12px]" style={{ color: TEAL }}>↳ {p.soloSi}</span>}
                        {p.logica && <span className="block text-[12px] text-[#5B687B]">↳ {p.logica}</span>}
                      </li>
                    ))}
                  </ul>
                )}
            </article>
          );
        })}
      </section>

      {propuesta && g && (
        <Supuestos items={e.supuestos.map((texto) => ({ texto }))} revisado={g.supuestosRevisados} onRevisar={gen.marcarRevisados} />
      )}

      {problemas.length > 0 && (
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: `${PELIGRO}55`, backgroundColor: `${PELIGRO}0a` }}>
          <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: PELIGRO }}><AlertTriangle className="h-3.5 w-3.5" />Antes de escribir las preguntas hay que corregir esto (pídeselo a la IA abajo):</p>
          {problemas.map((p, i) => <p key={i} className="text-[12.5px] text-[#45454D]">{p}</p>)}
        </div>
      )}

      {gen.llamada.corriendo
        ? <AvanceIA pasos={gen.llamada.pasos} segundos={gen.llamada.segundos} />
        : (
          <section className="space-y-2 rounded-xl border border-[#0F3D4D]/20 bg-[#0F3D4D]/[0.02] px-4 py-3">
            <Etiqueta>{propuesta ? '¿Qué le cambiarías?' : '¿Qué quieres cambiar de la estructura?'}</Etiqueta>
            <textarea
              value={pedido}
              onChange={(ev) => setPedido(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); void pedirCambio(); } }}
              rows={2}
              placeholder="Por ejemplo: «quita la sección de marcas», «el perfil B es de 8», «agrega una pregunta de lugar de compra en cada bloque»."
              className="w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-[#0F3D4D]/50"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={propuesta ? botonSecundario : botonTeal} disabled={!pedido.trim()} onClick={pedirCambio}><MarcaIA />Pedir el cambio</button>
              {propuesta && !nadaCambia && (
                <button type="button" className={botonTeal} disabled={problemas.length > 0} onClick={() => gen.aprobar().then(() => onCerrar?.())}>
                  {base ? 'Aprobar y reescribir lo que cambia' : 'Aprobar y escribir las preguntas'}
                </button>
              )}
              {nadaCambia && <span className="text-xs text-muted-foreground">La propuesta no cambia nada de lo escrito.</span>}
              {propuesta && !base && g?.origen !== 'filtro' && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => gen.pedirEstructura()}>Volver a proponer desde los insumos</button>
              )}
              {propuesta && base && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => gen.descartar().then(() => onCerrar?.()).catch((err) => toast.error((err as Error).message))}>Descartar la propuesta</button>
              )}
              {!propuesta && onCerrar && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onCerrar}>Volver al documento</button>}
            </div>
          </section>
        )}
    </div>
  );
}
