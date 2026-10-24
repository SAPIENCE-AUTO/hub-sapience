import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { condicionEnPalabras } from '@/lib/formularios/palabras';
import { comoSimple, preguntasParaCondicion } from '@/lib/formularios/editar';
import { opcionesDe } from '@/lib/formularios/tabla';
import { forma, type Condicion, type Pregunta } from '@/lib/formularios/tipos';
import { rango } from '@/lib/formularios/motor';
import { useDoc } from './comun';

/** Caja de un ajuste que se abre bajo la pregunta o la sección. */
function Caja({ titulo, children, onCerrar }: { titulo: string; children: ReactNode; onCerrar: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-[#0F3D4D]/25 bg-[#0F3D4D]/[0.03] p-3 text-sm" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#0F3D4D]">{titulo}</span>
        <button type="button" onClick={onCerrar} className="text-xs text-muted-foreground hover:text-foreground">Cerrar</button>
      </div>
      {children}
    </div>
  );
}

const numeroDe = (texto: string) => (texto.trim() === '' || Number.isNaN(Number(texto)) ? undefined : Number(texto));

function CampoNumero({ valor, onChange, ancho = 'w-16', etiqueta }: { valor?: number; onChange: (n?: number) => void; ancho?: string; etiqueta: string }) {
  return (
    <input
      aria-label={etiqueta}
      inputMode="numeric"
      className={`${ancho} rounded-md border bg-white px-2 py-1 text-sm`}
      value={valor ?? ''}
      onChange={(e) => onChange(numeroDe(e.target.value.replace(/[^\d.-]/g, '')))}
    />
  );
}

/**
 * «Mostrar solo si» en su forma simple: «si en tal pregunta marcó tal o tal».
 * Una condición combinada (varias reglas con «y», «o», «no») se lee en
 * palabras y se corrige con la IA en la fase 3; aquí solo se puede quitar o
 * cambiar por una simple.
 */
export function EditorCondicion({ lugar, actual, onGuardar, onCerrar }: {
  lugar: { seccion: string; pregunta?: string };
  actual?: Condicion;
  onGuardar: (c: Condicion | undefined) => void;
  onCerrar: () => void;
}) {
  const { def } = useDoc();
  const candidatas = preguntasParaCondicion(def, lugar);
  const simple = comoSimple(actual);
  const [combinada, setCombinada] = useState(!!actual && !simple);
  const [preguntaId, setPreguntaId] = useState(simple?.pregunta ?? candidatas[candidatas.length - 1]?.id ?? '');
  const [marcadas, setMarcadas] = useState<string[]>(simple?.incluye ?? []);
  const origen = candidatas.find((p) => p.id === preguntaId);
  const opciones = !origen ? []
    : origen.tipo === 'casilla' ? [{ id: 'si', label: 'Marcó la casilla' }] // sin marcar no guarda nada
      : forma(origen.tipo) === 'si_no' ? [{ id: 'si', label: 'Sí' }, { id: 'no', label: 'No' }]
        : opcionesDe(def, origen);
  const titulo = lugar.pregunta ? 'Mostrar esta pregunta solo si…' : 'Mostrar esta sección solo si…';

  if (combinada) {
    return (
      <Caja titulo={titulo} onCerrar={onCerrar}>
        <p className="text-[13px]">Ahora aparece si {condicionEnPalabras(actual!, def)}.</p>
        <p className="mt-1 text-xs text-muted-foreground">Esta regla combina varias condiciones: se corrige con la IA en la fase 3. Aquí la puedes quitar o cambiar por una simple.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCombinada(false)}>Cambiar por una simple</Button>
          <Button size="sm" variant="ghost" className="text-[#D32222]" onClick={() => { onGuardar(undefined); onCerrar(); }}>Quitar la condición</Button>
        </div>
      </Caja>
    );
  }

  if (candidatas.length === 0) {
    return (
      <Caja titulo={titulo} onCerrar={onCerrar}>
        <p className="text-[13px] text-muted-foreground">Antes no hay ninguna pregunta de opciones o de sí y no que se pueda usar.</p>
      </Caja>
    );
  }

  return (
    <Caja titulo={titulo} onCerrar={onCerrar}>
      <label className="block text-xs text-muted-foreground">En la pregunta</label>
      <select
        className="mt-1 w-full rounded-md border bg-white px-2 py-1.5 text-sm"
        value={preguntaId}
        onChange={(e) => { setPreguntaId(e.target.value); setMarcadas([]); }}
      >
        {candidatas.map((p) => <option key={p.id} value={p.id}>{p.texto.split('{opcion}').join('…')}</option>)}
      </select>
      <p className="mt-3 text-xs text-muted-foreground">{origen && forma(origen.tipo) === 'una' ? 'contestó alguna de estas' : 'marcó alguna de estas'}</p>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {opciones.map((o) => (
          <label key={o.id} className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#0F3D4D]"
              checked={marcadas.includes(o.id)}
              onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, o.id] : m.filter((x) => x !== o.id)))}
            />
            {o.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={!marcadas.length} onClick={() => { onGuardar({ pregunta: preguntaId, incluye: opciones.map((o) => o.id).filter((id) => marcadas.includes(id)) }); onCerrar(); }}>
          Guardar
        </Button>
        {actual && <Button size="sm" variant="ghost" className="text-[#D32222]" onClick={() => { onGuardar(undefined); onCerrar(); }}>Quitar la condición</Button>}
      </div>
    </Caja>
  );
}

/** Rango de un número (y cuándo no califica por estar fuera) o de una escala. */
export function EditorRango({ p, onGuardar, onCerrar }: { p: Pregunta; onGuardar: (cambio: Partial<Pregunta>) => void; onCerrar: () => void }) {
  const r = rango(p);
  const [min, setMin] = useState<number | undefined>(p.tipo === 'numero' ? p.min : r.min);
  const [max, setMax] = useState<number | undefined>(p.tipo === 'numero' ? p.max : r.max);
  const [paso, setPaso] = useState<number | undefined>(p.paso);
  const [corta, setCorta] = useState(!!p.terminaFuera);
  const [cMin, setCMin] = useState<number | undefined>(p.terminaFuera?.min);
  const [cMax, setCMax] = useState<number | undefined>(p.terminaFuera?.max);
  const motivo = p.terminaFuera?.motivo;
  const [cortar, setCortar] = useState(!!p.terminaFuera?.cortar);

  const guardar = () => {
    const cambio: Partial<Pregunta> = p.tipo === 'estrellas' ? { max } : { min, max };
    if (p.tipo === 'deslizador') cambio.paso = paso;
    if (p.tipo === 'numero') {
      cambio.terminaFuera = corta && cMin !== undefined && cMax !== undefined
        ? { min: cMin, max: cMax, motivo: motivo ?? `Fuera de ${cMin} a ${cMax}`, ...(cortar ? { cortar: true } : {}) }
        : undefined;
    }
    onGuardar(cambio);
    onCerrar();
  };

  return (
    <Caja titulo={p.tipo === 'numero' ? 'Qué números acepta' : 'Rango de la escala'} onCerrar={onCerrar}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {p.tipo === 'estrellas'
          ? <>De 1 a <CampoNumero etiqueta="Máximo de estrellas" valor={max} onChange={setMax} /> estrellas</>
          : <>De <CampoNumero etiqueta="Mínimo" valor={min} onChange={setMin} /> a <CampoNumero etiqueta="Máximo" valor={max} onChange={setMax} /></>}
        {p.tipo === 'deslizador' && <>de <CampoNumero etiqueta="Paso" valor={paso} onChange={setPaso} /> en <span>{paso ?? 1}</span></>}
      </div>
      {p.tipo === 'numero' && (
        <div className="mt-3 space-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-[#0F3D4D]" checked={corta} onChange={(e) => setCorta(e.target.checked)} />
            No califica si contesta fuera de un rango
          </label>
          {corta && (
            <>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                Califica solo de <CampoNumero etiqueta="Desde" valor={cMin} onChange={setCMin} /> a <CampoNumero etiqueta="Hasta" valor={cMax} onChange={setCMax} />
              </div>
              <label className="flex items-center gap-2 pl-6 text-muted-foreground">
                <input type="checkbox" className="accent-[#0F3D4D]" checked={cortar} onChange={(e) => setCortar(e.target.checked)} />
                Y cortar el filtro ahí (si no, contesta todo y se registra)
              </label>
            </>
          )}
        </div>
      )}
      <div className="mt-3"><Button size="sm" onClick={guardar}>Guardar</Button></div>
    </Caja>
  );
}

/** Tope de cuántas se marcan (varias) o cuántas se ordenan. */
export function EditorMaximo({ p, onGuardar, onCerrar }: { p: Pregunta; onGuardar: (n?: number) => void; onCerrar: () => void }) {
  const [n, setN] = useState<number | undefined>(p.maxOpciones);
  return (
    <Caja titulo={p.tipo === 'ordenar' ? 'Cuántas ordena' : 'Cuántas puede marcar'} onCerrar={onCerrar}>
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {p.tipo === 'ordenar' ? 'Sus' : 'Hasta'} <CampoNumero etiqueta="Máximo" valor={n} onChange={setN} /> {p.tipo === 'ordenar' ? 'primeras' : 'opciones'}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={n === undefined || n < 1} onClick={() => { onGuardar(n); onCerrar(); }}>Guardar</Button>
        {p.maxOpciones !== undefined && <Button size="sm" variant="ghost" onClick={() => { onGuardar(undefined); onCerrar(); }}>Sin tope</Button>}
      </div>
    </Caja>
  );
}
