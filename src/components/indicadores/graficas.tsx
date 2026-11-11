import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { fmtNum, fmtPct } from './formato';

// Gráficas de la evolución mes por mes de «Por reclutador» (SVG a mano, sin librería). Siguen el método de la skill dataviz: columnas de máximo 24 px con la punta redondeada y la base recta,
// 2 px de hueco entre las partes apiladas, líneas de 2 px con puntos de 8 px, rejilla de una raya fina, leyenda siempre, el tooltip con todas las series de ese mes (también con el teclado)
// y el texto en los tonos de texto, nunca en el color de la serie. La tabla con los mismos números la pone quien las usa.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «2026-10» → «oct 26». */
export const etiquetaMes = (mes: string): string => `${MESES[Number(mes.slice(5, 7)) - 1] ?? '?'} ${mes.slice(2, 4)}`;
/** «2026-10» → «octubre de 2026». */
export const etiquetaMesLarga = (mes: string): string => `${MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? '?'} de ${mes.slice(0, 4)}`;

/** Un tope «redondo» para el eje y marcas parejas (0, 25, 50, 75, 100…): el paso es 1, 2 o 5 por una potencia de 10. */
export function escalaBonita(max: number, marcas = 4): { tope: number; ticks: number[] } {
  const bruto = Math.max(max, 0) / marcas;
  if (bruto <= 0) return { tope: marcas, ticks: Array.from({ length: marcas + 1 }, (_, i) => i) };
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const fraccion = bruto / potencia;
  const paso = (fraccion <= 1 ? 1 : fraccion <= 2 ? 2 : fraccion <= 5 ? 5 : 10) * potencia;
  return { tope: paso * marcas, ticks: Array.from({ length: marcas + 1 }, (_, i) => paso * i) };
}

export interface SerieGrafica { clave: string; nombre: string; color: string }
export interface SerieLinea extends SerieGrafica { marcador: 'circulo' | 'cuadro' | 'rombo' }

const W = 760;
const H = 232;
const M = { izq: 50, der: 18, arriba: 12, abajo: 30 };
const PLOT_W = W - M.izq - M.der;
const PLOT_H = H - M.arriba - M.abajo;
const TINTA = 'hsl(var(--muted-foreground))';
const RAYA = 'hsl(var(--border))';
const FONDO_ACTIVO = 'hsl(var(--muted))';

/** El eje y: marcas con su rejilla de una raya fina, y las etiquetas de los meses (una de cada tantas si son muchos). */
function Ejes({ meses, ticks, y, paso, formato }: { meses: string[]; ticks: number[]; y: (v: number) => number; paso: number; formato: (v: number) => string }) {
  const cada = Math.max(1, Math.ceil(meses.length / 13));
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.izq} x2={W - M.der} y1={y(t)} y2={y(t)} stroke={RAYA} strokeWidth={1} opacity={t === 0 ? 1 : 0.7} />
          <text x={M.izq - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={TINTA} className="tabular-nums">{formato(t)}</text>
        </g>
      ))}
      {meses.map((mes, i) => (i % cada === 0 || i === meses.length - 1) && (cada === 1 || i === meses.length - 1 || meses.length - 1 - i >= cada) ? (
        <text key={mes} x={M.izq + paso * (i + 0.5)} y={H - 10} textAnchor="middle" fontSize={11} fill={TINTA}>{etiquetaMes(mes)}</text>
      ) : null)}
    </g>
  );
}

/** El cuadro que sale al pasar el cursor o enfocar un mes: el mes, y cada serie con su valor (el valor manda, el nombre acompaña). */
function Tarjeta({ izquierda, titulo, filas, pie }: { izquierda: number; titulo: string; filas: Array<{ clave: string; nombre: string; valor: string; color: string; forma?: ReactNode }>; pie?: string }) {
  // Al lado de la columna y no encima, del lado donde hay más lugar: así no tapa lo que se está mirando.
  const lado = izquierda < 50 ? { left: `calc(${izquierda}% + 16px)` } : { right: `calc(${100 - izquierda}% + 16px)` };
  return (
    <div aria-hidden="true" className="pointer-events-none absolute top-1 z-10 min-w-[190px] rounded-lg border bg-card px-3 py-2 text-xs shadow-md" style={lado}>
      <div className="mb-1 font-semibold text-foreground">{titulo}</div>
      {filas.map((f) => (
        <div key={f.clave} className="flex items-center gap-2 py-px">
          {f.forma ?? <span className="inline-block h-[3px] w-3.5 rounded-full" style={{ backgroundColor: f.color }} />}
          <span className="font-semibold tabular-nums text-foreground">{f.valor}</span>
          <span className="text-muted-foreground">{f.nombre}</span>
        </div>
      ))}
      {pie && <div className="mt-1 border-t pt-1 text-muted-foreground">{pie}</div>}
    </div>
  );
}

function Leyenda({ series }: { series: Array<SerieGrafica & { marcador?: SerieLinea['marcador'] }> }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.clave} className="inline-flex items-center gap-1.5">
          {s.marcador
            ? <svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" stroke={s.color} strokeWidth="2" strokeLinecap="round" />{marcadorSvg(s.marcador, 11, 5, s.color)}</svg>
            : <i className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />}
          {s.nombre}
        </span>
      ))}
    </div>
  );
}

function marcadorSvg(forma: SerieLinea['marcador'], x: number, y: number, color: string, anillo = false): ReactNode {
  const contorno = anillo ? { stroke: 'hsl(var(--card))', strokeWidth: 2 } : {};
  if (forma === 'cuadro') return <rect x={x - 4} y={y - 4} width={8} height={8} rx={1} fill={color} {...contorno} />;
  if (forma === 'rombo') return <rect x={x - 4} y={y - 4} width={8} height={8} rx={1} fill={color} transform={`rotate(45 ${x} ${y})`} {...contorno} />;
  return <circle cx={x} cy={y} r={4} fill={color} {...contorno} />;
}

/** El camino de una columna con la punta redondeada y la base recta. */
function columna(x: number, arriba: number, ancho: number, alto: number, radio: number): string {
  const r = Math.max(0, Math.min(radio, alto / 2, ancho / 2));
  return `M${x},${arriba + alto} V${arriba + r} Q${x},${arriba} ${x + r},${arriba} H${x + ancho - r} Q${x + ancho},${arriba} ${x + ancho},${arriba + r} V${arriba + alto} Z`;
}

/**
 * Lo mismo que el cursor, para el teclado: la gráfica entera es UNA sola parada del tabulador (no una por mes: serían doce o más por gráfica); al entrar se pone en el último mes,
 * las flechas recorren los meses y Inicio y Fin saltan a los extremos; al salir de la gráfica se suelta el mes.
 */
function conTeclado(n: number, activo: number | null, ir: (i: number | null) => void) {
  return (e: KeyboardEvent) => {
    const mover = (i: number) => { e.preventDefault(); ir(Math.max(0, Math.min(n - 1, i))); };
    if (e.key === 'ArrowRight') mover(activo === null ? 0 : activo + 1);
    else if (e.key === 'ArrowLeft') mover(activo === null ? n - 1 : activo - 1);
    else if (e.key === 'Home') mover(0);
    else if (e.key === 'End') mover(n - 1);
  };
}
/** Lo que se queda del cuadro para quien usa lector de pantalla: el mes activo, dicho en una frase (el cuadro visible va oculto para ellos). */
function Aviso({ texto }: { texto: string }) {
  return <p className="sr-only" aria-live="polite">{texto}</p>;
}
const CLASE_SVG = 'h-auto w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#0F3D4D]/40';

/** Una columna por mes, con las partes apiladas de abajo hacia arriba en el orden de `series`. `valores[serie][mes]`. */
export function BarrasApiladasMes({ meses, series, valores, descripcion, nombreTotal = 'Total' }: {
  meses: string[];
  series: SerieGrafica[];
  valores: number[][];
  descripcion: string;
  nombreTotal?: string;
}) {
  const [elegido, ir] = useState<number | null>(null);
  // Si cambian los meses (otro periodo u otra persona) con un mes elegido, el elegido puede quedar fuera: ahí no hay mes activo.
  const activo = elegido !== null && elegido < meses.length ? elegido : null;
  const totales = meses.map((_, i) => valores.reduce((s, v) => s + (v[i] ?? 0), 0));
  const { tope, ticks } = escalaBonita(Math.max(0, ...totales));
  const paso = PLOT_W / Math.max(1, meses.length);
  const grosor = Math.min(24, Math.max(4, paso - 8));
  const y = (v: number) => M.arriba + PLOT_H * (1 - v / tope);
  return (
    <div className="relative">
      {activo !== null && (
        <Tarjeta
          izquierda={((M.izq + paso * (activo + 0.5)) / W) * 100}
          titulo={etiquetaMesLarga(meses[activo])}
          filas={[...series].reverse().map((s, k) => ({ clave: s.clave, nombre: s.nombre, color: s.color, valor: fmtNum(valores[series.length - 1 - k]?.[activo] ?? 0), forma: <i className="inline-block h-2.5 w-3.5 rounded-sm" style={{ backgroundColor: s.color }} /> }))}
          pie={`${nombreTotal}: ${fmtNum(totales[activo])}`}
        />
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`} className={CLASE_SVG} role="group" aria-roledescription="gráfica" aria-label={`${descripcion} Con las flechas se recorren los meses.`}
        tabIndex={0} onFocus={() => ir(activo ?? meses.length - 1)} onBlur={() => ir(null)} onKeyDown={conTeclado(meses.length, activo, ir)} onPointerLeave={() => ir(null)}
      >
        <Ejes meses={meses} ticks={ticks} y={y} paso={paso} formato={fmtNum} />
        {meses.map((mes, i) => {
          const x = M.izq + paso * i + (paso - grosor) / 2;
          const visibles = series.map((_, k) => k).filter((k) => (valores[k]?.[i] ?? 0) > 0);
          let acumulado = 0;
          return (
            <g key={mes}>
              {activo === i && <rect x={M.izq + paso * i} y={M.arriba} width={paso} height={PLOT_H} fill={FONDO_ACTIVO} opacity={0.7} />}
              {visibles.map((k, posicion) => {
                const v = valores[k][i];
                const abajo = y(acumulado);
                const arriba = y(acumulado + v);
                acumulado += v;
                const hayArriba = posicion < visibles.length - 1;
                const hayAbajo = posicion > 0;
                const top = arriba + (hayArriba ? 1 : 0);
                const alto = Math.max(1.5, abajo - (hayAbajo ? 1 : 0) - top);
                return !hayArriba
                  ? <path key={k} d={columna(x, top, grosor, alto, 4)} fill={series[k].color} />
                  : <rect key={k} x={x} y={top} width={grosor} height={alto} fill={series[k].color} />;
              })}
              <rect x={M.izq + paso * i} y={M.arriba} width={paso} height={PLOT_H} fill="transparent" className="cursor-default" onPointerEnter={() => ir(i)} />
            </g>
          );
        })}
      </svg>
      <Aviso texto={activo === null ? '' : `${etiquetaMesLarga(meses[activo])}: ${series.map((s, k) => `${s.nombre} ${fmtNum(valores[k]?.[activo] ?? 0)}`).join(', ')}. ${nombreTotal}: ${fmtNum(totales[activo])}.`} />
      <Leyenda series={series} />
    </div>
  );
}

/** Una línea por serie con un punto por mes; un mes sin valor (`null`) corta la línea. Los valores son porcentajes de 0 a 100. */
export function LineasMes({ meses, series, valores, descripcion, notas }: {
  meses: string[];
  series: SerieLinea[];
  valores: Array<Array<number | null>>;
  descripcion: string;
  /** Un texto por mes para el pie del cuadro (por ejemplo, de cuántas respuestas sale el porcentaje). */
  notas?: ReadonlyArray<string>;
}) {
  const [elegido, ir] = useState<number | null>(null);
  // Si cambian los meses (otro periodo u otra persona) con un mes elegido, el elegido puede quedar fuera: ahí no hay mes activo.
  const activo = elegido !== null && elegido < meses.length ? elegido : null;
  const maximo = Math.max(0, ...valores.flat().map((v) => v ?? 0));
  const { tope, ticks } = escalaBonita(Math.min(100, maximo));
  const paso = PLOT_W / Math.max(1, meses.length);
  const x = (i: number) => M.izq + paso * (i + 0.5);
  const y = (v: number) => M.arriba + PLOT_H * (1 - Math.min(v, tope) / tope);
  // Una etiqueta al final de cada línea solo si no se encimarían; si no, la leyenda y el cuadro llevan los valores.
  const finales = series.map((_, k) => { for (let i = meses.length - 1; i >= 0; i--) { const v = valores[k]?.[i]; if (v !== null && v !== undefined) return { i, v }; } return null; });
  const ys = finales.filter(Boolean).map((f) => y(f!.v)).sort((a, b) => a - b);
  const etiquetasFinales = ys.every((v, j) => j === 0 || v - ys[j - 1] >= 14);
  return (
    <div className="relative">
      {activo !== null && (
        <Tarjeta
          izquierda={(x(activo) / W) * 100}
          titulo={etiquetaMesLarga(meses[activo])}
          filas={series.map((s, k) => ({ clave: s.clave, nombre: s.nombre, color: s.color, valor: fmtPct(valores[k]?.[activo] ?? null) }))}
          pie={notas?.[activo]}
        />
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`} className={CLASE_SVG} role="group" aria-roledescription="gráfica" aria-label={`${descripcion} Con las flechas se recorren los meses.`}
        tabIndex={0} onFocus={() => ir(activo ?? meses.length - 1)} onBlur={() => ir(null)} onKeyDown={conTeclado(meses.length, activo, ir)} onPointerLeave={() => ir(null)}
      >
        <Ejes meses={meses} ticks={ticks} y={y} paso={paso} formato={(v) => `${v}%`} />
        {activo !== null && <line x1={x(activo)} x2={x(activo)} y1={M.arriba} y2={M.arriba + PLOT_H} stroke={RAYA} strokeWidth={1} />}
        {series.map((s, k) => {
          const trazos: string[] = [];
          let actual = '';
          meses.forEach((_, i) => {
            const v = valores[k]?.[i];
            if (v === null || v === undefined) { if (actual) trazos.push(actual); actual = ''; return; }
            actual += `${actual ? 'L' : 'M'}${x(i)},${y(v)} `;
          });
          if (actual) trazos.push(actual);
          return (
            <g key={s.clave}>
              {trazos.map((d, j) => <path key={j} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />)}
              {meses.map((mes, i) => { const v = valores[k]?.[i]; return v === null || v === undefined ? null : <g key={mes}>{marcadorSvg(s.marcador, x(i), y(v), s.color, true)}</g>; })}
              {etiquetasFinales && finales[k] && (
                <text x={x(finales[k]!.i) + 9} y={y(finales[k]!.v)} dominantBaseline="middle" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))" className="tabular-nums">{fmtPct(finales[k]!.v)}</text>
              )}
            </g>
          );
        })}
        {meses.map((mes, i) => (
          <rect key={mes} x={M.izq + paso * i} y={M.arriba} width={paso} height={PLOT_H} fill="transparent" className="cursor-default" onPointerEnter={() => ir(i)} />
        ))}
      </svg>
      <Aviso texto={activo === null ? '' : `${etiquetaMesLarga(meses[activo])}: ${series.map((s, k) => `${s.nombre} ${fmtPct(valores[k]?.[activo] ?? null)}`).join(', ')}.${notas?.[activo] ? ` ${notas[activo]}.` : ''}`} />
      <Leyenda series={series} />
    </div>
  );
}
