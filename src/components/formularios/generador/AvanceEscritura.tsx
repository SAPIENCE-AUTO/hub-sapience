import { useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { ALERTA, EXITO, PELIGRO, TEAL } from '@/lib/toolColors';
import { citar } from '@/lib/formularios/palabras';
import type { Definicion } from '@/lib/formularios/tipos';
import type { GeneradorUI } from './useGenerador';
import { MarcaIA } from './comun';

/** Los problemas nombran preguntas por su id: aquí se leen por su texto. */
const legible = (def: Definicion, texto: string) => texto.replace(/«([^»]+)»/g, (todo, id: string) => (def.secciones.some((s) => s.preguntas.some((p) => p.id === id)) ? citar(def, id, 50) : todo));

/**
 * Avance de la etapa 2 sobre el documento: cada sección con su estado, la
 * lógica final y lo que haya quedado por corregir. Las secciones aparecen en
 * el documento en cuanto llegan.
 */
export function AvanceEscritura({ gen, def }: { gen: GeneradorUI; def: Definicion }) {
  const [oculto, setOculto] = useState(false);
  const e = gen.g?.estructura;
  if (!e) return null;
  const estado = (id: string) => gen.secciones[id]?.estado ?? (gen.g?.aplicadas[id] ? 'lista' : 'esperando');
  const ids = e.secciones.map((s) => s.id);
  const listas = ids.filter((id) => estado(id) === 'lista').length;
  const errores = ids.filter((id) => estado(id) === 'error');
  const problemas = [
    ...e.secciones.flatMap((s) => (gen.secciones[s.id]?.problemas ?? []).map((p) => ({ donde: s.titulo, texto: p }))),
    ...gen.problemasLogica.map((p) => ({ donde: 'Perfiles y alertas', texto: p })),
  ];
  const terminado = listas === ids.length && gen.logica === 'lista';
  if (terminado && (!problemas.length || oculto)) return null;
  const pct = Math.round(((listas + (gen.logica === 'lista' ? 1 : 0)) / (ids.length + 1)) * 100);

  return (
    <section className="rounded-xl border border-[#0F3D4D]/15 bg-white px-4 py-3 shadow-sm">
      {!terminado && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <MarcaIA />
            <span className="text-sm font-semibold" style={{ color: TEAL }}>
              {gen.logica === 'armando' ? 'Armando quién entra a cada perfil…' : errores.length && !gen.escribiendo ? 'Faltan secciones por escribir' : `Escribiendo las preguntas: ${listas} de ${ids.length} secciones`}
            </span>
            {(errores.length > 0 || gen.logica === 'error') && !gen.escribiendo && (
              <button type="button" onClick={gen.reintentar} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium hover:bg-muted" style={{ color: TEAL }}>
                <RotateCcw className="h-3.5 w-3.5" />Reintentar lo que falta
              </button>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#0F3D4D]/10">
            <div className="h-full rounded-full bg-[#0F3D4D] transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {e.secciones.map((s) => {
              const st = estado(s.id);
              return (
                <li key={s.id} className="flex items-center gap-1 text-xs text-muted-foreground" title={gen.secciones[s.id]?.error}>
                  {st === 'lista' && <Check className="h-3.5 w-3.5" style={{ color: EXITO }} />}
                  {st === 'escribiendo' && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: TEAL }} />}
                  {st === 'esperando' && <span className="h-2 w-2 rounded-full border border-muted-foreground/50" />}
                  {st === 'error' && <AlertTriangle className="h-3.5 w-3.5" style={{ color: PELIGRO }} />}
                  <span className={st === 'escribiendo' ? 'font-medium text-[#1F1F23]' : ''}>{s.titulo.split('{opcion}').join('…')}</span>
                </li>
              );
            })}
            <li className="flex items-center gap-1 text-xs text-muted-foreground">
              {gen.logica === 'lista' ? <Check className="h-3.5 w-3.5" style={{ color: EXITO }} /> : gen.logica === 'armando' ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: TEAL }} /> : gen.logica === 'error' ? <AlertTriangle className="h-3.5 w-3.5" style={{ color: PELIGRO }} /> : <span className="h-2 w-2 rounded-full border border-muted-foreground/50" />}
              Perfiles y alertas
            </li>
          </ul>
          {/* Si todas fallaron por lo mismo (sin saldo, tope…), se dice una vez. */}
          {new Set(errores.map((id) => gen.secciones[id]?.error)).size === 1 && errores.length > 1
            ? <p className="mt-1 text-xs" style={{ color: PELIGRO }}>{gen.secciones[errores[0]]?.error}</p>
            : errores.map((id) => <p key={id} className="mt-1 text-xs" style={{ color: PELIGRO }}>{e.secciones.find((s) => s.id === id)?.titulo.split('{opcion}').join('…')}: {gen.secciones[id]?.error}</p>)}
          {gen.logica === 'error' && <p className="mt-1 text-xs" style={{ color: PELIGRO }}>Perfiles y alertas: {gen.errorLogica}</p>}
        </>
      )}
      {problemas.length > 0 && (
        <div className={terminado ? '' : 'mt-3 border-t pt-2'}>
          <p className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: ALERTA }}>
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />La IA dejó {problemas.length === 1 ? '1 cosa' : `${problemas.length} cosas`} por corregir: a mano o con el botón IA
            {terminado && <button type="button" aria-label="Ocultar" onClick={() => setOculto(true)} className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
          </p>
          <ul className="mt-1 space-y-0.5">
            {problemas.slice(0, 8).map((p, i) => <li key={i} className="text-xs text-[#45454D]"><span className="font-medium">{p.donde.split('{opcion}').join('…')}:</span> {legible(def, p.texto)}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
