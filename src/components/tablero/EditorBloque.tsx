// Panel para editar un bloque: qué mide, cómo se corta, con qué se cruza, qué gráfica, qué comparación y qué estilo. Va al costado (no tapa el tablero) y cada cambio se
// ve al instante en el bloque. Lo que no se toca se hereda del tablero.
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DIMENSIONES, DIMENSIONES_ORDEN, FECHAS_ETIQUETA, MEDIDAS, MEDIDAS_ORDEN, TIEMPO } from '@/lib/tablero/campos';
import { etiquetaComparacion, etiquetaPeriodo } from '@/lib/tablero/periodos';
import { GRAFICAS, graficaCompatible, graficasValidas, maxMedidas } from '@/lib/tablero/graficas';
import { PALETAS } from '@/lib/tablero/paletas';
import type { Bloque, ConsultaBloque, Contexto, Deal, DimensionRef, Granularidad, MonedaAlcance, Tablero } from '@/lib/tablero/tipos';
import { tituloSugerido } from '@/lib/tablero/vistas';
import Filtros from './Filtros';
import { SelectorComparacion, SelectorFecha, SelectorPeriodo } from './Selectores';

const NINGUNO = '__ninguno';

interface Props {
  bloque: Bloque;
  tablero: Pick<Tablero, 'periodo' | 'comparacion' | 'fecha'>;
  deals: Deal[];
  ctx: Contexto;
  onCambio: (b: Bloque) => void;
  onCerrar: () => void;
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-[11px] font-medium text-muted-foreground">{etiqueta}</Label>{children}</div>;
}

function SelectorCorte({ valor, onChange, conNinguno, etiquetaNinguno }: { valor: DimensionRef | undefined; onChange: (d: DimensionRef | undefined) => void; conNinguno?: boolean; etiquetaNinguno?: string }) {
  const grupos = ['Tiempo', 'Comercial', 'Proyecto'] as const;
  const cambiar = (v: string) => {
    if (v === NINGUNO) return onChange(undefined);
    onChange(v === TIEMPO ? { campo: TIEMPO, granularidad: valor?.campo === TIEMPO ? valor.granularidad : 'mes' } : { campo: v });
  };
  return (
    <div className="space-y-1.5">
      <Select value={valor?.campo ?? NINGUNO} onValueChange={cambiar}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {conNinguno && <SelectItem value={NINGUNO}>{etiquetaNinguno ?? 'Ninguno'}</SelectItem>}
          {grupos.map(g => (
            <SelectGroup key={g}>
              <SelectLabel className="text-[10px] uppercase tracking-wide">{g}</SelectLabel>
              {DIMENSIONES_ORDEN.filter(id => DIMENSIONES[id].grupo === g).map(id => (
                <SelectItem key={id} value={id}>{id === TIEMPO ? 'Línea de tiempo' : DIMENSIONES[id].etiqueta}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {valor?.campo === TIEMPO && (
        <div className="flex gap-1">
          {([['mes', 'Mes'], ['trimestre', 'Trimestre'], ['anio', 'Año']] as [Granularidad, string][]).map(([g, n]) => (
            <button key={g} type="button" onClick={() => onChange({ campo: TIEMPO, granularidad: g })} className={`flex-1 rounded border px-1 py-1 text-[11px] ${(valor.granularidad ?? 'mes') === g ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EditorBloque({ bloque, tablero, deals, ctx, onCambio, onCerrar }: Props) {
  const c = bloque.consulta;
  const validas = graficasValidas(c);
  const filasEsTiempo = c.filas?.campo === TIEMPO;
  const acumulable = filasEsTiempo && c.medidas.some(id => MEDIDAS[id]?.acumulable);
  const hoy = ctx.hoy;

  /** Aplica un cambio a la consulta: la gráfica se ajusta si ya no sirve y el título se actualiza solo mientras nadie lo haya escrito a mano. */
  const cambiar = (parche: Partial<ConsultaBloque>, tipo?: Bloque['tipo']) => {
    const consulta: ConsultaBloque = { ...c, ...parche };
    if (consulta.columnas && !consulta.filas) delete consulta.columnas;
    if (!(consulta.filas?.campo === TIEMPO) || !consulta.acumulado) delete consulta.acumulado;
    let pedida = tipo ?? bloque.tipo;
    // Al cruzar por primera vez, las barras pasan a apiladas (varias barras por mes se amontonan); al quitar el cruce, vuelven a barras.
    if (!tipo && 'columnas' in parche) {
      if (parche.columnas && !c.columnas && pedida === 'barras') pedida = 'barrasApiladas';
      if (!parche.columnas && c.columnas && pedida === 'barrasApiladas') pedida = 'barras';
    }
    // La dispersión compara dos medidas: si falta la segunda se agrega; las gráficas de una sola medida se quedan con la primera.
    if (pedida === 'dispersion' && consulta.medidas.length < 2) consulta.medidas = [consulta.medidas[0], consulta.medidas[0] === 'deals' ? 'ingresos' : 'deals'];
    const nuevoTipo = graficaCompatible(pedida, consulta);
    consulta.medidas = consulta.medidas.slice(0, maxMedidas(nuevoTipo));
    const sigueAutomatico = bloque.titulo === tituloSugerido(c);
    onCambio({ ...bloque, consulta, tipo: nuevoTipo, titulo: sigueAutomatico ? tituloSugerido(consulta) : bloque.titulo });
  };
  const estilo = (parche: Partial<Bloque['estilo']>) => onCambio({ ...bloque, estilo: { ...bloque.estilo, ...parche } });
  const dosMedidas = bloque.tipo === 'dispersion';

  return (
    <aside className="flex h-full w-full flex-col border-l bg-card" aria-label="Editar bloque">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Editar bloque</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCerrar} aria-label="Cerrar"><X className="h-4 w-4" /></Button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        <Campo etiqueta="Título"><Input value={bloque.titulo} onChange={e => onCambio({ ...bloque, titulo: e.target.value })} className="h-8 text-xs" /></Campo>

        <Campo etiqueta="Medir">
          <Select value={c.medidas[0]} onValueChange={v => cambiar({ medidas: [v, ...c.medidas.slice(1)] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{MEDIDAS_ORDEN.map(id => <SelectItem key={id} value={id}>{MEDIDAS[id].etiqueta}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">{MEDIDAS[c.medidas[0]]?.descripcion}</p>
        </Campo>

        <Campo etiqueta="Cortar por"><SelectorCorte valor={c.filas} onChange={d => cambiar({ filas: d })} conNinguno etiquetaNinguno="Nada (una sola cifra)" /></Campo>

        {c.filas && (
          <Campo etiqueta="Cruzar con">
            <SelectorCorte valor={c.columnas} onChange={d => cambiar({ columnas: d, medidas: d ? [c.medidas[0]] : c.medidas })} conNinguno etiquetaNinguno="Nada" />
          </Campo>
        )}

        <Campo etiqueta="Gráfica">
          <Select value={bloque.tipo} onValueChange={v => cambiar({}, v as Bloque['tipo'])}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{validas.map(t => <SelectItem key={t} value={t}>{GRAFICAS[t].etiqueta}</SelectItem>)}</SelectContent>
          </Select>
        </Campo>

        {dosMedidas && (
          <Campo etiqueta="Segunda medida (eje vertical)">
            <Select value={c.medidas[1] ?? 'deals'} onValueChange={v => cambiar({ medidas: [c.medidas[0], v] })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{MEDIDAS_ORDEN.map(id => <SelectItem key={id} value={id}>{MEDIDAS[id].etiqueta}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
        )}
        {bloque.tipo === 'tabla' && !c.columnas && c.filas && (
          <Campo etiqueta="Medidas en la tabla">
            <div className="space-y-1">
              {MEDIDAS_ORDEN.map(id => (
                <label key={id} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={c.medidas.includes(id)} onChange={e => {
                    const nuevas = e.target.checked ? [...c.medidas, id] : c.medidas.filter(m => m !== id);
                    if (nuevas.length >= 1) cambiar({ medidas: nuevas.slice(0, 6) });
                  }} />
                  {MEDIDAS[id].etiqueta}
                </label>
              ))}
            </div>
          </Campo>
        )}

        {c.filas && !filasEsTiempo && (
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Mostrar solo los">
              <Input type="number" min={1} max={200} placeholder="Todos" value={c.limite ?? ''} onChange={e => cambiar({ limite: e.target.value ? Math.max(1, Math.min(200, Math.round(Number(e.target.value)))) : undefined })} className="h-8 text-xs" />
            </Campo>
            <Campo etiqueta="Orden">
              <Select value={c.orden ?? 'auto'} onValueChange={v => cambiar({ orden: v === 'auto' ? undefined : (v as ConsultaBloque['orden']) })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automático</SelectItem>
                  <SelectItem value="valor-desc">De mayor a menor</SelectItem>
                  <SelectItem value="valor-asc">De menor a mayor</SelectItem>
                  <SelectItem value="etiqueta">A–Z</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
          </div>
        )}

        {acumulable && (
          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
            <span>Acumulado a lo largo del tiempo</span>
            <Switch checked={!!c.acumulado} onCheckedChange={v => cambiar({ acumulado: v || undefined })} />
          </label>
        )}

        <div className="space-y-3 rounded-lg border p-3">
          <div className="text-[11px] font-medium text-muted-foreground">En este bloque</div>
          <Campo etiqueta="Periodo"><SelectorPeriodo valor={c.periodo} onChange={p => cambiar({ periodo: p })} hoy={hoy} heredar={{ etiqueta: etiquetaPeriodo(tablero.periodo, hoy) }} className="w-full justify-start" /></Campo>
          <Campo etiqueta="Comparación"><SelectorComparacion valor={c.comparacion} onChange={x => cambiar({ comparacion: x })} heredar={{ etiqueta: etiquetaComparacion(tablero.comparacion).toLowerCase() }} className="w-full" sinPrefijo /></Campo>
          <Campo etiqueta="Fecha de referencia"><SelectorFecha valor={c.fecha} onChange={f => cambiar({ fecha: f })} heredar={{ etiqueta: FECHAS_ETIQUETA[tablero.fecha.campo].replace('Fecha de ', '') }} className="w-full" sinPrefijo /></Campo>
          <Campo etiqueta="Moneda">
            <Select value={c.moneda ?? 'todas'} onValueChange={v => cambiar({ moneda: v === 'todas' ? undefined : (v as MonedaAlcance) })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todo en pesos (convertido)</SelectItem>
                <SelectItem value="MXN">Solo deals en MXN</SelectItem>
                <SelectItem value="USD">Solo deals en USD (sin convertir)</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo etiqueta="Filtros propios (se suman a los del tablero)"><Filtros filtros={c.filtros} onChange={f => cambiar({ filtros: f })} deals={deals} ctx={ctx} compacto /></Campo>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="text-[11px] font-medium text-muted-foreground">Estilo</div>
          <Campo etiqueta="Colores">
            <div className="flex flex-wrap gap-1.5">
              {Object.values(PALETAS).map(p => (
                <button key={p.id} type="button" onClick={() => estilo({ paleta: p.id })} title={p.etiqueta} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] ${bloque.estilo.paleta === p.id ? 'border-primary bg-primary/10' : 'hover:bg-muted'}`}>
                  <span className="flex">{p.claro.slice(0, 4).map(col => <i key={col} className="h-3 w-3 first:rounded-l-sm last:rounded-r-sm" style={{ background: col }} />)}</span>
                  {p.etiqueta}
                </button>
              ))}
            </div>
          </Campo>
          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs"><span>Mostrar valores en la gráfica</span><Switch checked={bloque.estilo.etiquetas} onCheckedChange={v => estilo({ etiquetas: v })} /></label>
          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs"><span>Mostrar leyenda</span><Switch checked={bloque.estilo.leyenda} onCheckedChange={v => estilo({ leyenda: v })} /></label>
          {(bloque.tipo === 'barras' || bloque.tipo === 'barrasApiladas') && (
            <Campo etiqueta="Dirección de las barras">
              <Select value={bloque.estilo.orientacion} onValueChange={v => estilo({ orientacion: v as Bloque['estilo']['orientacion'] })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automática</SelectItem>
                  <SelectItem value="vertical">Verticales</SelectItem>
                  <SelectItem value="horizontal">Horizontales</SelectItem>
                </SelectContent>
              </Select>
            </Campo>
          )}
        </div>
      </div>
    </aside>
  );
}
