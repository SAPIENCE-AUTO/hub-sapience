// Cómo se dibuja cada tipo de bloque a partir del resultado del motor. Aquí no se calcula nada: solo se pinta. Los colores salen de la paleta del bloque y, si hay
// comparación, lo del periodo anterior va siempre en gris para distinguirlo de lo de ahora.
import { Fragment, useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { PHASE_COLOR_MAP } from '@/components/commercial/dealUtils';
import { cambio, formatear, formatearPct } from '@/lib/tablero/formato';
import { coloresDe } from '@/lib/tablero/paletas';
import type { Bloque, CeldaRes, Deal, MedidaDef, MonedaAlcance, Resultado } from '@/lib/tablero/tipos';

export interface PropsViz {
  res: Resultado;
  bloque: Bloque;
  oscuro: boolean;
  onDetalle: (titulo: string, deals: Deal[]) => void;
}

const GRIS = '#8b93a1';
const TOOLTIP = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, color: 'hsl(var(--foreground))' };
const EJE = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

const monedaDe = (b: Bloque): MonedaAlcance => b.consulta.moneda ?? 'todas';
const fmtDe = (m: MedidaDef | undefined, moneda: MonedaAlcance, compacto = true) => (v: unknown): string =>
  formatear(typeof v === 'number' ? v : null, m?.formato ?? 'numero', moneda, compacto);

// ── Series ────────────────────────────────────────────────────────────────────

interface Serie {
  key: string;
  nombre: string;
  previo?: boolean;
  /** Posición de la columna del cruce a la que corresponde (para abrir el detalle). */
  columna?: number;
}

/** Convierte el resultado en filas planas para Recharts: una serie por columna del cruce, o «ahora» y «comparación» si se compara. */
function armarSeries(res: Resultado): { datos: Record<string, unknown>[]; series: Serie[] } {
  if (res.hayCruce) {
    const series: Serie[] = res.columnas.map((c, j) => ({ key: `c_${j}`, nombre: c.etiqueta, columna: j }));
    const datos = res.filas.map(f => {
      const o: Record<string, unknown> = { etiqueta: f.etiqueta, _fila: f.clave };
      series.forEach((s, j) => { o[s.key] = f.celdas[j].valores[0]; });
      return o;
    });
    return { datos, series };
  }
  const comparando = !!res.periodos.previo && res.filas.some(f => f.celdas[0].previos);
  const series: Serie[] = [{ key: 'valor', nombre: comparando ? res.periodos.etiquetaActual : (res.medidas[0]?.etiqueta ?? 'Valor') }];
  if (comparando) series.push({ key: 'previo', nombre: res.periodos.etiquetaPrevio ?? 'Comparación', previo: true });
  const datos = res.filas.map(f => ({ etiqueta: f.etiqueta, _fila: f.clave, valor: f.celdas[0].valores[0], previo: f.celdas[0].previos?.[0] ?? null }));
  return { datos, series };
}

function detalle(res: Resultado, bloque: Bloque, filaClave: unknown, serie: Serie | undefined, onDetalle: PropsViz['onDetalle']) {
  const fila = res.filas.find(f => f.clave === filaClave);
  if (!fila) return;
  let deals: Deal[];
  let sufijo = '';
  if (serie?.columna !== undefined) {
    deals = fila.celdas[serie.columna].deals;
    sufijo = ` · ${serie.nombre}`;
  } else if (serie?.previo) {
    deals = fila.total.dealsPrevios;
    sufijo = ` · ${serie.nombre}`;
  } else {
    deals = fila.total.deals;
  }
  if (deals.length) onDetalle(`${bloque.titulo} — ${fila.etiqueta}${sufijo}`, deals);
}

const colorDeSerie = (s: Serie, i: number, colores: string[], hayCruce: boolean): string => (s.previo ? GRIS : hayCruce ? colores[i % colores.length] : colores[0]);

/** Leyenda de una gráfica: cuadrito de color y nombre, en el orden de las series (lo de ahora primero, la comparación después). */
function Leyenda({ series, colores, hayCruce }: { series: Serie[]; colores: string[]; hayCruce: boolean }) {
  return (
    <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorDeSerie(s, i, colores, hayCruce) }} />
          {s.nombre}
        </span>
      ))}
    </div>
  );
}

function SinDatos({ texto = 'Sin datos en este periodo' }: { texto?: string }) {
  return <div className="flex h-full min-h-[96px] items-center justify-center text-sm text-muted-foreground">{texto}</div>;
}

// ── Cifra ─────────────────────────────────────────────────────────────────────

function ChipCambio({ medida, valor, previo, etiquetaPrevio, moneda }: { medida: MedidaDef; valor: number | null; previo: number | null | undefined; etiquetaPrevio: string | null; moneda: MonedaAlcance }) {
  const c = cambio(valor, previo);
  if (!c) return null;
  const sinCambio = c.abs === 0;
  const bueno = medida.mejor === 'baja' ? c.abs < 0 : c.abs > 0;
  const color = sinCambio ? 'text-muted-foreground' : bueno ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive';
  const Icono = c.abs >= 0 ? TrendingUp : TrendingDown;
  return (
    <div className="space-y-0.5">
      <div className={`flex items-center gap-1 text-xs font-medium ${color}`}>
        <Icono className="h-3.5 w-3.5" />
        {c.pct !== null ? formatearPct(c.pct) : formatear(c.abs, medida.formato, moneda)}
      </div>
      <div className="text-[11px] leading-snug text-muted-foreground">contra {etiquetaPrevio ?? 'el periodo anterior'}: {formatear(previo, medida.formato, moneda, false)}</div>
    </div>
  );
}

export function Kpi({ res, bloque, onDetalle }: PropsViz) {
  const m = res.medidas[0];
  if (!m) return <SinDatos texto="Falta elegir qué medir" />;
  const moneda = monedaDe(bloque);
  const valor = res.total.valores[0];
  const abrir = res.total.deals.length ? () => onDetalle(bloque.titulo, res.total.deals) : undefined;
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-1">
      {m.etiqueta.trim().toLowerCase() !== bloque.titulo.trim().toLowerCase() && <div className="text-xs text-muted-foreground">{m.etiqueta}</div>}
      <button type="button" disabled={!abrir} onClick={abrir} className="w-fit text-left text-3xl font-bold tabular-nums leading-none text-foreground enabled:hover:text-primary" title={m.descripcion}>
        {formatear(valor, m.formato, moneda)}
      </button>
      <ChipCambio medida={m} valor={valor} previo={res.total.previos?.[0]} etiquetaPrevio={res.periodos.etiquetaPrevio} moneda={moneda} />
      {res.periodos.aviso && <div className="text-[11px] text-amber-600 dark:text-amber-400">{res.periodos.aviso}</div>}
    </div>
  );
}

// ── Barras, líneas y áreas ────────────────────────────────────────────────────

export function Barras({ res, bloque, oscuro, onDetalle, apiladas }: PropsViz & { apiladas?: boolean }) {
  const colores = coloresDe(bloque.estilo.paleta, oscuro);
  const { datos, series } = useMemo(() => armarSeries(res), [res]);
  if (datos.length === 0) return <SinDatos />;
  const f = fmtDe(res.medidas[0], monedaDe(bloque));
  const horizontal = bloque.estilo.orientacion === 'horizontal' || (bloque.estilo.orientacion === 'auto' && !res.filasEsTiempo && datos.length > 6);
  const conLeyenda = bloque.estilo.leyenda && series.length > 1;
  return (
    <div className="flex h-full flex-col">
      {conLeyenda && <Leyenda series={series} colores={colores} hayCruce={res.hayCruce} />}
      <div className="min-h-0 flex-1">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? <XAxis type="number" tick={EJE} tickFormatter={f} /> : <XAxis dataKey="etiqueta" tick={EJE} interval="preserveStartEnd" />}
        {horizontal ? <YAxis type="category" dataKey="etiqueta" tick={EJE} width={110} interval={0} /> : <YAxis tick={EJE} tickFormatter={f} width={56} />}
        <Tooltip contentStyle={TOOLTIP} formatter={(v, nombre) => [f(v), nombre]} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.nombre}
            stackId={apiladas ? 'a' : undefined}
            fill={colorDeSerie(s, i, colores, res.hayCruce)}
            fillOpacity={s.previo ? 0.55 : 1}
            radius={apiladas ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
            cursor="pointer"
            onClick={(d: { payload?: { _fila?: unknown } }) => detalle(res, bloque, d?.payload?._fila, s, onDetalle)}
          >
            {bloque.estilo.etiquetas && <LabelList dataKey={s.key} position={apiladas ? 'center' : horizontal ? 'right' : 'top'} formatter={f} style={{ fontSize: 10, fill: apiladas ? '#fff' : 'hsl(var(--foreground))' }} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Pone un punto solo al final de la línea (el último dato que existe), como en las gráficas de tendencia. */
const puntoFinal = (ultimo: number, color: string) => (p: { cx?: number; cy?: number; index?: number }) =>
  p.index === ultimo && p.cx !== undefined && p.cy !== undefined
    ? <circle key={`fin-${p.index}`} cx={p.cx} cy={p.cy} r={4} fill={color} stroke="hsl(var(--card))" strokeWidth={2} />
    : <Fragment key={`nada-${p.index}`} />;

export function Lineas({ res, bloque, oscuro, onDetalle, area }: PropsViz & { area?: boolean }) {
  const colores = coloresDe(bloque.estilo.paleta, oscuro);
  const { datos, series } = useMemo(() => armarSeries(res), [res]);
  if (datos.length === 0) return <SinDatos />;
  const f = fmtDe(res.medidas[0], monedaDe(bloque));
  const conLeyenda = bloque.estilo.leyenda && series.length > 1;
  const Grafica = area ? AreaChart : LineChart;
  const ultimoDe = (key: string) => datos.reduce((u, d, i) => (typeof d[key] === 'number' ? i : u), -1);
  return (
    <div className="flex h-full flex-col">
      {conLeyenda && <Leyenda series={series} colores={colores} hayCruce={res.hayCruce} />}
      <div className="min-h-0 flex-1">
    <ResponsiveContainer width="100%" height="100%">
      <Grafica data={datos} margin={{ top: 8, right: 14, left: 0, bottom: 0 }} onClick={(e: unknown) => {
        // Recharts 3 manda la categoría tocada en activeLabel.
        const fila = res.filas.find(x => x.etiqueta === (e as { activeLabel?: string } | undefined)?.activeLabel);
        if (fila) detalle(res, bloque, fila.clave, undefined, onDetalle);
      }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="etiqueta" tick={EJE} interval="preserveStartEnd" />
        <YAxis tick={EJE} tickFormatter={f} width={56} />
        <Tooltip contentStyle={TOOLTIP} formatter={(v, nombre) => [f(v), nombre]} />
        {series.map((s, i) => {
          const color = colorDeSerie(s, i, colores, res.hayCruce);
          const comunes = { dataKey: s.key, name: s.nombre, stroke: color, strokeWidth: 2, strokeDasharray: s.previo ? '5 4' : undefined, connectNulls: false, isAnimationActive: false };
          return area
            ? <Area key={s.key} type="monotone" {...comunes} fill={color} fillOpacity={s.previo ? 0.04 : 0.14} dot={false} />
            : <Line key={s.key} type="monotone" {...comunes} dot={s.previo ? false : puntoFinal(ultimoDe(s.key), color)} activeDot={{ r: 4 }} />;
        })}
      </Grafica>
    </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Pastel y dona ─────────────────────────────────────────────────────────────

export function Circular({ res, bloque, oscuro, onDetalle, dona }: PropsViz & { dona?: boolean }) {
  const colores = coloresDe(bloque.estilo.paleta, oscuro);
  const datos = res.filas.map(f => ({ name: f.etiqueta, value: Math.max(0, f.celdas[0].valores[0] ?? 0), _fila: f.clave })).filter(d => d.value > 0);
  if (datos.length === 0) return <SinDatos />;
  // Si el límite de renglones dejó cosas fuera y la medida se puede sumar, lo que falta para el total entra como «Otros»: así los porcentajes son del total de verdad.
  const mostrado = datos.reduce((s, d) => s + d.value, 0);
  const global = res.medidas[0]?.acumulable ? (res.total.valores[0] ?? mostrado) : mostrado;
  const resto = global - mostrado;
  if (resto > global * 0.005) datos.push({ name: 'Otros', value: resto, _fila: '__otros' });
  const total = mostrado + (resto > global * 0.005 ? resto : 0);
  const f = fmtDe(res.medidas[0], monedaDe(bloque));
  const colorDe = (d: { _fila: unknown }, i: number) => (d._fila === '__otros' ? GRIS : colores[i % colores.length]);
  return (
    <div className="flex h-full items-center gap-3">
      <div className="h-full min-h-[110px] w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={datos} dataKey="value" nameKey="name" innerRadius={dona ? '55%' : 0} outerRadius="92%" paddingAngle={dona ? 2 : 0} stroke="hsl(var(--card))" cursor="pointer" isAnimationActive={false}
              onClick={(d: { payload?: { _fila?: unknown } }) => detalle(res, bloque, d?.payload?._fila, undefined, onDetalle)}>
              {datos.map((d, i) => <Cell key={i} fill={colorDe(d, i)} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP} formatter={(v, nombre) => [`${f(v)} (${Math.round((Number(v) / total) * 100)}%)`, nombre]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {bloque.estilo.leyenda && (
        <ul className="max-h-full min-w-0 flex-1 space-y-1 overflow-auto text-xs">
          {datos.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colorDe(d, i) }} />
              <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
              <span className="tabular-nums text-muted-foreground">{Math.round((d.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Ranking y embudo ──────────────────────────────────────────────────────────

export function Ranking({ res, bloque, oscuro, onDetalle }: PropsViz) {
  const colores = coloresDe(bloque.estilo.paleta, oscuro);
  const m = res.medidas[0];
  if (res.filas.length === 0 || !m) return <SinDatos />;
  const moneda = monedaDe(bloque);
  const max = Math.max(...res.filas.map(f => Math.max(f.celdas[0].valores[0] ?? 0, 0)), 1);
  return (
    <div className="h-full space-y-2 overflow-auto pr-1">
      {res.filas.map((fila, i) => {
        const v = fila.celdas[0].valores[0];
        const c = cambio(v, fila.celdas[0].previos?.[0]);
        const bueno = c ? (m.mejor === 'baja' ? c.abs < 0 : c.abs > 0) : false;
        return (
          <button key={fila.clave} type="button" className="flex w-full items-center gap-2 rounded-md text-left hover:bg-muted/50" onClick={() => detalle(res, bloque, fila.clave, undefined, onDetalle)}>
            <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm" title={fila.etiqueta}>{fila.etiqueta}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums">
                  {c && c.pct !== null && c.abs !== 0 && <span className={`text-[11px] font-normal ${bueno ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>{formatearPct(c.pct)}</span>}
                  {formatear(v, m.formato, moneda)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${(Math.max(v ?? 0, 0) / max) * 100}%`, background: colores[0] }} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function Embudo({ res, bloque, oscuro, onDetalle }: PropsViz) {
  const colores = coloresDe(bloque.estilo.paleta, oscuro);
  const m = res.medidas[0];
  if (res.filas.length === 0 || !m) return <SinDatos />;
  const moneda = monedaDe(bloque);
  const max = Math.max(...res.filas.map(f => f.celdas[0].valores[0] ?? 0), 1);
  const total = res.filas.reduce((suma, f) => suma + (f.celdas[0].valores[0] ?? 0), 0);
  return (
    <div className="flex h-full flex-col justify-center gap-1.5 overflow-auto py-1">
      {res.filas.map((fila, i) => {
        const v = fila.celdas[0].valores[0] ?? 0;
        return (
          <button key={fila.clave} type="button" className="flex items-center gap-2 text-left" onClick={() => detalle(res, bloque, fila.clave, undefined, onDetalle)}>
            <div className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground" title={fila.etiqueta}>{fila.etiqueta}</div>
            <div className="flex flex-1 justify-center">
              <div className="flex h-7 items-center justify-center rounded px-1 text-xs font-semibold text-white" style={{ width: `${Math.max((v / max) * 100, 12)}%`, background: PHASE_COLOR_MAP[fila.etiqueta] ?? colores[i % colores.length] }}>
                {formatear(v, m.formato, moneda)}
              </div>
            </div>
            <div className="w-10 shrink-0 text-right text-xs text-muted-foreground">{total > 0 ? `${Math.round((v / total) * 100)}%` : ''}</div>
          </button>
        );
      })}
    </div>
  );
}

// ── Dispersión ────────────────────────────────────────────────────────────────

export function Dispersion({ res, bloque, oscuro, onDetalle }: PropsViz) {
  const colores = coloresDe(bloque.estilo.paleta, oscuro);
  const [mx, my] = res.medidas;
  if (!mx || !my) return <SinDatos texto="Elige dos medidas para comparar" />;
  const moneda = monedaDe(bloque);
  const puntos = res.filas.map(f => ({ name: f.etiqueta, x: f.celdas[0].valores[0] ?? 0, y: f.celdas[0].valores[1] ?? 0, _fila: f.clave }));
  if (puntos.length === 0) return <SinDatos />;
  const fx = fmtDe(mx, moneda);
  const fy = fmtDe(my, moneda);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="x" type="number" tick={EJE} tickFormatter={fx} label={{ value: mx.etiqueta, position: 'insideBottom', offset: -10, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
        <YAxis dataKey="y" type="number" tick={EJE} tickFormatter={fy} width={56} label={{ value: my.etiqueta, angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
        <ZAxis range={[60, 60]} />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as { name: string; x: number; y: number };
          return (
            <div className="space-y-0.5 rounded-lg border bg-card p-2 text-xs shadow-md">
              <p className="font-semibold text-foreground">{p.name}</p>
              <p className="text-muted-foreground">{mx.etiqueta}: <span className="font-medium text-foreground">{fx(p.x)}</span></p>
              <p className="text-muted-foreground">{my.etiqueta}: <span className="font-medium text-foreground">{fy(p.y)}</span></p>
            </div>
          );
        }} />
        <Scatter data={puntos} fill={colores[0]} fillOpacity={0.85} cursor="pointer" isAnimationActive={false} onClick={(d: { payload?: { _fila?: unknown } }) => detalle(res, bloque, d?.payload?._fila ?? (d as { _fila?: unknown })._fila, undefined, onDetalle)} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── Tabla ─────────────────────────────────────────────────────────────────────

function CeldaTabla({ celda, medida, k, moneda, mostrarCambio }: { celda: CeldaRes; medida: MedidaDef; k: number; moneda: MonedaAlcance; mostrarCambio: boolean }) {
  const v = celda.valores[k];
  const c = mostrarCambio ? cambio(v, celda.previos?.[k]) : null;
  const bueno = c ? (medida.mejor === 'baja' ? c.abs < 0 : c.abs > 0) : false;
  return (
    <div className="tabular-nums">
      <span>{formatear(v, medida.formato, moneda)}</span>
      {c && c.pct !== null && c.abs !== 0 && <span className={`ml-1 text-[10px] ${bueno ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>{formatearPct(c.pct)}</span>}
    </div>
  );
}

export function Tabla({ res, bloque, onDetalle }: PropsViz) {
  if (res.filas.length === 0) return <SinDatos />;
  const moneda = monedaDe(bloque);
  const comparando = !!res.periodos.previo;
  // Sin cruce, una columna por medida; con cruce, una por columna del cruce (con la primera medida) y el total.
  const columnas = res.hayCruce
    ? res.columnas.map((c, j) => ({ titulo: c.etiqueta, celda: (f: Resultado['filas'][number]) => f.celdas[j], k: 0, medida: res.medidas[0] }))
    : res.medidas.map((m, k) => ({ titulo: m.etiqueta, celda: (f: Resultado['filas'][number]) => f.celdas[0], k, medida: m }));
  const totalColumnas = res.hayCruce ? [{ titulo: 'Total', celda: (f: Resultado['filas'][number]) => f.total, k: 0, medida: res.medidas[0] }] : [];
  const todas = [...columnas, ...totalColumnas];
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-muted-foreground">
            <th className="py-1 pr-2 text-left font-medium" />
            {todas.map(c => <th key={c.titulo} className="px-2 py-1 text-right font-medium">{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody>
          {res.filas.map(f => (
            <tr key={f.clave} className="border-b border-border/40 hover:bg-muted/40">
              <td className="max-w-[160px] truncate py-1 pr-2" title={f.etiqueta}>
                <button type="button" className="truncate text-left hover:text-primary" onClick={() => detalle(res, bloque, f.clave, undefined, onDetalle)}>{f.etiqueta}</button>
              </td>
              {todas.map(c => (
                <td key={c.titulo} className="px-2 py-1 text-right"><CeldaTabla celda={c.celda(f)} medida={c.medida} k={c.k} moneda={moneda} mostrarCambio={comparando && !res.hayCruce} /></td>
              ))}
            </tr>
          ))}
          {res.filas.length > 1 && (
            <tr className="font-medium">
              <td className="py-1 pr-2">Total</td>
              {res.hayCruce
                ? res.columnas.map((c, j) => (
                  <td key={c.clave} className="px-2 py-1 text-right tabular-nums">{formatear(res.totalColumnas[j]?.valores[0] ?? null, res.medidas[0].formato, moneda)}</td>
                )).concat(<td key="total" className="px-2 py-1 text-right tabular-nums">{formatear(res.total.valores[0], res.medidas[0].formato, moneda)}</td>)
                : res.medidas.map((m, k) => <td key={m.id} className="px-2 py-1 text-right"><CeldaTabla celda={res.total} medida={m} k={k} moneda={moneda} mostrarCambio={comparando} /></td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Selector ──────────────────────────────────────────────────────────────────

export function Visualizacion(props: PropsViz) {
  const { bloque, res } = props;
  if (res.medidas.length === 0) return <SinDatos texto="Falta elegir qué medir" />;
  if ((res.sinDatos || (res.hayCruce && res.columnas.length === 0)) && bloque.tipo !== 'kpi') return <SinDatos />;
  switch (bloque.tipo) {
    case 'kpi': return <Kpi {...props} />;
    case 'barras': return <Barras {...props} />;
    case 'barrasApiladas': return <Barras {...props} apiladas />;
    case 'lineas': return <Lineas {...props} />;
    case 'area': return <Lineas {...props} area />;
    case 'pie': return <Circular {...props} />;
    case 'dona': return <Circular {...props} dona />;
    case 'ranking': return <Ranking {...props} />;
    case 'embudo': return <Embudo {...props} />;
    case 'dispersion': return <Dispersion {...props} />;
    case 'tabla': return <Tabla {...props} />;
  }
}
