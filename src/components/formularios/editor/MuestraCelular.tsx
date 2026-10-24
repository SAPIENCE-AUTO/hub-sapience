import { useEffect, useMemo, useRef, useState } from 'react';
import { pantallaDeMuestra } from '@/lib/formularios/motor';
import type { Definicion, Respuestas, Valor } from '@/lib/formularios/tipos';
import { CampoPregunta } from '../CampoPregunta';
import { BarraPantalla, Bienvenida, CuerpoPantalla, Despedida, Marco } from '../Participante';

/** El marco del teléfono de las vistas previas del editor. */
export const marcoTelefono = 'overflow-hidden rounded-[38px] border-[9px] border-[#1F1F23] bg-[#F6F6F7] shadow-xl';

export const MUESTRA_BIENVENIDA = '__bienvenida';
export const MUESTRA_FINAL = '__final';

/**
 * El celular junto al documento: la parte donde se hizo clic (bienvenida, una
 * sección o el final) tal cual la ve el participante, para ver cómo quedan
 * las imágenes, las matrices, etc. Se puede contestar (no se guarda nada) y
 * «Atrás» y «Siguiente» pasan a la sección de antes o de después en el orden
 * del documento, sin la lógica: el camino completo se prueba en la pestaña Celular.
 */
export function MuestraCelular({ def, seccion, pregunta, onSeccion }: {
  def: Definicion;
  /** Id de la sección, MUESTRA_BIENVENIDA o MUESTRA_FINAL. */
  seccion: string;
  /** La pregunta elegida en el documento: se lleva a la vista y se marca. */
  pregunta?: string | null;
  onSeccion: (id: string) => void;
}) {
  const [resp, setResp] = useState<Respuestas>({});
  const scroll = useRef<HTMLDivElement>(null);
  const orden = [MUESTRA_BIENVENIDA, ...def.secciones.map((s) => s.id), MUESTRA_FINAL];
  const i = Math.max(0, orden.indexOf(seccion));
  const pantalla = useMemo(() => pantallaDeMuestra(def, seccion, 'muestra'), [def, seccion]);

  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [seccion]);
  useEffect(() => {
    if (pregunta) scroll.current?.querySelector(`[data-muestra="${CSS.escape(pregunta)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pregunta, seccion]);

  const cambiar = (clave: string, valor: Valor | undefined) => setResp((r) => {
    const n = { ...r };
    if (valor === undefined) delete n[clave]; else n[clave] = valor;
    return n;
  });
  const ir = (paso: number) => onSeccion(orden[Math.min(orden.length - 1, Math.max(0, i + paso))]);

  const s = pantalla?.seccion;
  const condicionales = !!s && (!!s.mostrarSi || s.preguntas.some((p) => p.mostrarSi));
  const repetida = pantalla?.instancia;

  return (
    <div className="space-y-2">
      <div className={`h-[min(720px,calc(100vh-14rem))] min-h-[460px] w-full ${marcoTelefono}`}>
        <Marco prueba={false} enMarco progreso={pantalla ? Math.round((i / (orden.length - 2)) * 100) : undefined} scroll={scroll}>
          {seccion === MUESTRA_BIENVENIDA && <Bienvenida def={def} onEmpezar={() => ir(1)} />}
          {seccion === MUESTRA_FINAL && <Despedida texto={def.despedida} />}
          {pantalla && (
            <>
              <CuerpoPantalla pantalla={pantalla} enMarco>
                {pantalla.preguntas.map((pv) => (
                  <div key={pv.clave} data-muestra={pv.pregunta.id} className={pv.pregunta.id === pregunta ? 'rounded-lg outline outline-2 outline-offset-[6px] outline-[#0F3D4D]/30' : undefined}>
                    <CampoPregunta pv={pv} resp={resp} codigo="" pais={def.pais} simular onChange={cambiar} />
                  </div>
                ))}
              </CuerpoPantalla>
              <BarraPantalla enMarco ultima={i === orden.length - 2} onAtras={() => ir(-1)} onSiguiente={() => ir(1)} />
            </>
          )}
        </Marco>
      </div>
      <div className="space-y-1 px-2 text-center text-[11.5px] leading-snug text-muted-foreground">
        {repetida && <p>Se repite por cada opción marcada; aquí, «{repetida.corto ?? repetida.label}».</p>}
        {condicionales && <p>Se ven todas sus preguntas; algunas solo salen si aplica.</p>}
        <p>Haz clic en una parte del documento para verla aquí.</p>
      </div>
    </div>
  );
}
