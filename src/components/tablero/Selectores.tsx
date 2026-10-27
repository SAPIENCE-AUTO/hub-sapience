// Selectores de periodo, comparación y fecha de referencia. Sirven igual para el tablero entero y, con la opción «igual que el tablero», para un bloque suelto.
// La comparación es una elección de quien usa el tablero (nunca fija): cualquiera de estas formas, siempre a la vista.
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FECHAS_ETIQUETA } from '@/lib/tablero/campos';
import { ISO, fechaValida, parseISO, trimestreDe, MESES_ETIQUETA } from '@/lib/tablero/fechas';
import { etiquetaPeriodo } from '@/lib/tablero/periodos';
import type { Comparacion, Periodo } from '@/lib/tablero/periodos';
import type { FechaRef } from '@/lib/tablero/tipos';

const HEREDAR = '__heredar';

// ── Periodo ───────────────────────────────────────────────────────────────────

function atajos(hoy: ISO): { etiqueta: string; valor: Periodo }[] {
  const { y, m } = parseISO(hoy);
  const q = trimestreDe(m);
  const qAnt = q === 1 ? { anio: y - 1, trimestre: 4 } : { anio: y, trimestre: q - 1 };
  const mAnt = m === 1 ? { anio: y - 1, mes: 12 } : { anio: y, mes: m - 1 };
  return [
    { etiqueta: 'Todo el historial', valor: { modo: 'todo' } },
    { etiqueta: `Este año (${y})`, valor: { modo: 'anio', anio: y } },
    { etiqueta: `Año pasado (${y - 1})`, valor: { modo: 'anio', anio: y - 1 } },
    { etiqueta: 'Este trimestre', valor: { modo: 'trimestre', anio: y, trimestre: q } },
    { etiqueta: 'Trimestre pasado', valor: { modo: 'trimestre', ...qAnt } },
    { etiqueta: 'Este mes', valor: { modo: 'mes', anio: y, mes: m } },
    { etiqueta: 'Mes pasado', valor: { modo: 'mes', ...mAnt } },
    { etiqueta: 'Últimos 12 meses', valor: { modo: 'ultimos', cantidad: 12, unidad: 'meses' } },
    { etiqueta: 'Últimos 90 días', valor: { modo: 'ultimos', cantidad: 90, unidad: 'dias' } },
    { etiqueta: 'Últimos 30 días', valor: { modo: 'ultimos', cantidad: 30, unidad: 'dias' } },
  ];
}

type Forma = 'anio' | 'trimestre' | 'mes' | 'rango';

interface PropsPeriodo {
  valor: Periodo | undefined;
  onChange: (p: Periodo | undefined) => void;
  hoy: ISO;
  /** Con esto aparece la opción «igual que el tablero» (para un bloque). */
  heredar?: { etiqueta: string };
  className?: string;
}

export function SelectorPeriodo({ valor, onChange, hoy, heredar, className }: PropsPeriodo) {
  const [abierto, setAbierto] = useState(false);
  const { y } = parseISO(hoy);
  const [forma, setForma] = useState<Forma>('anio');
  const [anio, setAnio] = useState(y);
  const [trimestre, setTrimestre] = useState(1);
  const [mes, setMes] = useState(1);
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const anios = Array.from({ length: 9 }, (_, i) => y + 1 - i);
  const elegir = (p: Periodo | undefined) => { onChange(p); setAbierto(false); };
  const etiqueta = valor ? etiquetaPeriodo(valor, hoy) : `Igual que el tablero${heredar ? ` (${heredar.etiqueta})` : ''}`;

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-8 gap-1.5 text-xs ${className ?? ''}`} aria-label="Periodo">
          <CalendarDays className="h-3.5 w-3.5" /> <span className="max-w-[180px] truncate">{etiqueta}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-2">
        {heredar && (
          <button type="button" className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${!valor ? 'bg-muted font-medium' : ''}`} onClick={() => elegir(undefined)}>
            Igual que el tablero ({heredar.etiqueta})
          </button>
        )}
        <div className="grid grid-cols-1">
          {atajos(hoy).map(a => (
            <button key={a.etiqueta} type="button" className={`rounded px-2 py-1.5 text-left text-xs hover:bg-muted ${valor && JSON.stringify(valor) === JSON.stringify(a.valor) ? 'bg-muted font-medium' : ''}`} onClick={() => elegir(a.valor)}>
              {a.etiqueta}
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t pt-2">
          <div className="text-[11px] font-medium text-muted-foreground">Elegir fechas</div>
          <div className="flex gap-1">
            {(['anio', 'trimestre', 'mes', 'rango'] as Forma[]).map(f => (
              <button key={f} type="button" onClick={() => setForma(f)} className={`flex-1 rounded border px-1 py-1 text-[11px] ${forma === f ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
                {{ anio: 'Año', trimestre: 'Trimestre', mes: 'Mes', rango: 'Rango' }[f]}
              </button>
            ))}
          </div>
          {forma !== 'rango' ? (
            <div className="flex gap-1">
              <Select value={String(anio)} onValueChange={v => setAnio(Number(v))}>
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{anios.map(a => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
              </Select>
              {forma === 'trimestre' && (
                <Select value={String(trimestre)} onValueChange={v => setTrimestre(Number(v))}>
                  <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4].map(t => <SelectItem key={t} value={String(t)}>Q{t}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {forma === 'mes' && (
                <Select value={String(mes)} onValueChange={v => setMes(Number(v))}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{MESES_ETIQUETA.map((n, i) => <SelectItem key={n} value={String(i + 1)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Button size="sm" className="h-8 text-xs" onClick={() => elegir(forma === 'anio' ? { modo: 'anio', anio } : forma === 'trimestre' ? { modo: 'trimestre', anio, trimestre } : { modo: 'mes', anio, mes })}>Usar</Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className="h-8 text-xs" aria-label="Desde" />
              <Input type="date" value={fin} onChange={e => setFin(e.target.value)} className="h-8 text-xs" aria-label="Hasta" />
              <Button size="sm" className="h-8 text-xs" disabled={!fechaValida(inicio) || !fechaValida(fin)} onClick={() => elegir({ modo: 'rango', inicio, fin })}>Usar</Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Comparación ───────────────────────────────────────────────────────────────

const OPCIONES_COMPARACION: { valor: Comparacion['modo']; etiqueta: string; ayuda: string }[] = [
  { valor: 'ninguna', etiqueta: 'Sin comparar', ayuda: 'No se compara con nada.' },
  { valor: 'mismaFecha', etiqueta: 'Misma fecha del año pasado', ayuda: 'El mismo tramo del año pasado, hasta la misma fecha de corte.' },
  { valor: 'anioCompleto', etiqueta: 'Año pasado completo', ayuda: 'El mismo periodo del año pasado, completo (aunque el de ahora no haya terminado).' },
  { valor: 'anterior', etiqueta: 'Periodo anterior', ayuda: 'El mes, trimestre o año inmediato anterior (o un rango igual de largo justo antes).' },
  { valor: 'rango', etiqueta: 'Otro rango…', ayuda: 'Fechas a tu elección.' },
];

interface PropsComparacion {
  valor: Comparacion | undefined;
  onChange: (c: Comparacion | undefined) => void;
  heredar?: { etiqueta: string };
  className?: string;
  /** Sin el «Comparar:» de adelante (cuando la etiqueta ya está arriba, como en el panel de un bloque). */
  sinPrefijo?: boolean;
}

export function SelectorComparacion({ valor, onChange, heredar, className, sinPrefijo }: PropsComparacion) {
  const clave = valor ? valor.modo : HEREDAR;
  const cambiar = (v: string) => {
    if (v === HEREDAR) return onChange(undefined);
    if (v === 'rango') return onChange({ modo: 'rango', inicio: valor?.modo === 'rango' ? valor.inicio : undefined, fin: valor?.modo === 'rango' ? valor.fin : undefined });
    onChange({ modo: v as Exclude<Comparacion['modo'], 'rango'> });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={clave} onValueChange={cambiar}>
        <SelectTrigger className={`h-8 w-auto min-w-[170px] gap-1.5 text-xs ${className ?? ''}`} aria-label="Comparar con">
          {!sinPrefijo && <span className="text-muted-foreground">Comparar:</span>}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {heredar && <SelectItem value={HEREDAR}>Igual que el tablero ({heredar.etiqueta})</SelectItem>}
          {OPCIONES_COMPARACION.map(o => <SelectItem key={o.valor} value={o.valor} title={o.ayuda}>{o.etiqueta}</SelectItem>)}
        </SelectContent>
      </Select>
      {valor?.modo === 'rango' && (
        <>
          <Input type="date" value={valor.inicio ?? ''} onChange={e => onChange({ modo: 'rango', inicio: fechaValida(e.target.value) ? e.target.value : undefined, fin: valor.fin })} className="h-8 w-[130px] text-xs" aria-label="Comparar desde" />
          <Input type="date" value={valor.fin ?? ''} onChange={e => onChange({ modo: 'rango', inicio: valor.inicio, fin: fechaValida(e.target.value) ? e.target.value : undefined })} className="h-8 w-[130px] text-xs" aria-label="Comparar hasta" />
        </>
      )}
    </div>
  );
}

// ── Fecha de referencia ───────────────────────────────────────────────────────

interface PropsFecha {
  valor: FechaRef | undefined;
  onChange: (f: FechaRef | undefined) => void;
  heredar?: { etiqueta: string };
  className?: string;
  sinPrefijo?: boolean;
}

export function SelectorFecha({ valor, onChange, heredar, className, sinPrefijo }: PropsFecha) {
  const clave = valor ? valor.campo : HEREDAR;
  const conAlterna = valor && (valor.campo === 'aprobacion' || valor.campo === 'propuesta');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={clave} onValueChange={v => onChange(v === HEREDAR ? undefined : { campo: v as FechaRef['campo'], alterna: valor?.alterna ?? true })}>
        <SelectTrigger className={`h-8 w-auto min-w-[150px] gap-1.5 text-xs ${className ?? ''}`} aria-label="Fecha de referencia">
          {!sinPrefijo && <span className="text-muted-foreground">Fecha:</span>}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {heredar && <SelectItem value={HEREDAR}>Igual que el tablero ({heredar.etiqueta})</SelectItem>}
          {(Object.keys(FECHAS_ETIQUETA) as FechaRef['campo'][]).map(k => <SelectItem key={k} value={k}>{FECHAS_ETIQUETA[k]}</SelectItem>)}
        </SelectContent>
      </Select>
      {conAlterna && (
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground" title="Si a un deal le falta esa fecha, se usa la otra (aprobación ↔ propuesta) en lugar de dejarlo fuera.">
          <Checkbox checked={valor.alterna} onCheckedChange={v => onChange({ ...valor, alterna: v === true })} className="h-3.5 w-3.5" />
          Si falta, usar la otra
        </label>
      )}
    </div>
  );
}
