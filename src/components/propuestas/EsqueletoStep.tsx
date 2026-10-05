import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Check, RefreshCw } from 'lucide-react';
import { savePropuestaEsqueleto, generatePropuestaEsqueleto } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { TIPOS_LAMINA } from '../../lib/propuestasCatalogo';
import { Progreso, Seccion } from './PasoUi';
import { useLlamadaLarga } from './useLlamadaLarga';

const clonar = (x: any) => JSON.parse(JSON.stringify(x));
const mover = (arr: any[], i: number, d: number) => {
  const j = i + d; if (j < 0 || j >= arr.length) return arr;
  const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c;
};
const NINGUNA = '__ninguna__';

// Pantalla 2 (spec §6): todo lo que devolvió la llamada 1, editable.
export default function EsqueletoStep({ p, onChanged, onAprobado }: { p: any; onChanged: () => Promise<void> | void; onAprobado: () => void }) {
  const [d, setD] = useState<any>(() => clonar(p.esqueleto));
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const llamada = useLlamadaLarga();
  const set = (fn: (x: any) => void) => setD((prev: any) => { const c = clonar(prev); fn(c); return c; });

  // Mover o quitar una fase obliga a reindexar lo que apunta a ella por número.
  const reindexar = (c: any, mapa: (i: number) => number | null) => {
    c.precio.partidas = c.precio.partidas.map((x: any) => ({ ...x, fase: mapa(x.fase) })).filter((x: any) => x.fase !== null);
    c.tiempos.actividades = c.tiempos.actividades.map((a: any) => ({ ...a, fase: a.fase === null ? null : mapa(a.fase) }));
  };
  const moverFase = (i: number, dir: number) => set(c => {
    const j = i + dir; if (j < 0 || j >= c.fases.length) return;
    c.fases = mover(c.fases, i, dir);
    reindexar(c, k => (k === i ? j : k === j ? i : k));
  });
  const quitarFase = (i: number) => set(c => {
    if (c.fases.length <= 1) return;
    c.fases.splice(i, 1);
    reindexar(c, k => (k === i ? null : k > i ? k - 1 : k));
  });

  const repropuner = async () => {
    try {
      const pendientes = Object.fromEntries(Object.entries(respuestas).filter(([, v]) => v.trim()));
      const r = await llamada.correr(generatePropuestaEsqueleto({ id: p.id, respuestas: pendientes }));
      setD(clonar(r.esqueleto)); setRespuestas({});
      await onChanged();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo volver a proponer'); }
  };

  // Participantes por fase: ninguna viene marcada; la primera fase CON participantes va en «nuevos» (no puede ser «mismos»).
  const sinGente = (f: any) => f.participantes === 'ninguno';
  const esPrimeraConGente = (i: number) => d.fases.slice(0, i).every(sinGente);
  const faseSinElegir = d.fases.map((f: any, i: number) => (!f.participantes ? i : -1)).filter((i: number) => i >= 0);
  const primeraMismos = d.fases.findIndex((f: any, i: number) => esPrimeraConGente(i) && !sinGente(f) && f.participantes === 'mismos');
  const participantesOk = faseSinElegir.length === 0 && primeraMismos < 0;

  const aprobar = async () => {
    if (!participantesOk) { toast.error('Falta decidir los participantes de alguna fase'); return; }
    setGuardando(true);
    try { await savePropuestaEsqueleto({ id: p.id, esqueleto: d }); await onChanged(); onAprobado(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar el esqueleto'); }
    finally { setGuardando(false); }
  };

  const ocupado = llamada.corriendo || guardando;
  // Aviso (no bloquea): entre muestra e inversión solo va tiempos; lo demás va después de la inversión.
  const incluidas: any[] = d.indice.filter((l: any) => l.incluir);
  const iMuestra = incluidas.findIndex(l => l.tipo === 'muestra'), iInversion = incluidas.findIndex(l => l.tipo === 'inversion');
  const fueraDeLugar = iMuestra >= 0 && iInversion > iMuestra
    ? incluidas.slice(iMuestra + 1, iInversion).filter(l => l.tipo !== 'tiempos') : [];
  const faseOpts = d.fases.map((f: any, i: number) => <SelectItem key={i} value={String(i)}>{i + 1}. {f.nombre}</SelectItem>);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Lo que entendió Claude del brief</p>
        <p className="text-sm">{d.resumen_brief}</p>
      </div>

      {d.preguntas?.length > 0 && (
        <Seccion titulo="Preguntas pendientes" ayuda="Claude detectó información que falta y cambia la propuesta. Respóndelas y vuelve a proponer, o ignóralas.">
          <div className="space-y-3">
            {d.preguntas.map((q: string, i: number) => (
              <div key={i} className="space-y-1">
                <p className="text-sm">{q}{d.preguntas_estado?.find((e: any) => e.pregunta === q)?.respondida && <span className="ml-2 text-[11px] text-emerald-600">respondida</span>}</p>
                <Textarea rows={2} value={respuestas[q] ?? ''} onChange={e => setRespuestas(r => ({ ...r, [q]: e.target.value }))} disabled={ocupado} />
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={repropuner} disabled={ocupado || !Object.values(respuestas).some(v => v.trim())}>
              <RefreshCw className="w-3.5 h-3.5" /> Volver a proponer con mis respuestas
            </Button>
          </div>
        </Seccion>
      )}
      {llamada.corriendo && <Progreso pasos={llamada.pasos} segundos={llamada.segundos} />}

      <Seccion titulo="Fases" ayuda="Cada fase se bautiza para este proyecto. Mover o quitar una fase actualiza solo el precio y los tiempos que dependen de ella.">
        <div className="space-y-3">
          {d.fases.map((f: any, i: number) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                <Input className="h-8 font-semibold" value={f.nombre} onChange={e => set(c => { c.fases[i].nombre = e.target.value; })} disabled={ocupado} />
                <Input className="h-8 w-40" placeholder="Etapa (opcional)" value={f.etapa ?? ''} onChange={e => set(c => { c.fases[i].etapa = e.target.value || null; })} disabled={ocupado} />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moverFase(i, -1)} disabled={ocupado || i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moverFase(i, 1)} disabled={ocupado || i === d.fases.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => quitarFase(i)} disabled={ocupado || d.fases.length <= 1}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="flex flex-col md:flex-row md:items-center gap-2">
                <Select value={f.participantes ?? ''} onValueChange={v => set(c => { c.fases[i].participantes = v; })} disabled={ocupado}>
                  <SelectTrigger className={`h-8 md:w-72 ${!f.participantes || (i === primeraMismos) ? 'border-amber-400' : ''}`}><SelectValue placeholder="Elige quiénes participan…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nuevos">Participantes nuevos</SelectItem>
                    <SelectItem value="mismos" disabled={esPrimeraConGente(i)}>Mismos participantes</SelectItem>
                    <SelectItem value="ninguno">Sin participantes – trabajo de Sapience</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-8 flex-1" placeholder="Por qué (una frase)" value={f.razon_participantes ?? ''} onChange={e => set(c => { c.fases[i].razon_participantes = e.target.value; })} disabled={ocupado} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {([['goal', 'Goal'], ['tecnica', 'Técnica'], ['muestra', 'Muestra']] as const).map(([k, l]) => (
                  <div key={k} className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">{l}</p>
                    <Textarea rows={3} value={f[k] ?? ''} onChange={e => set(c => { c.fases[i][k] = e.target.value; })} disabled={ocupado} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5" disabled={ocupado}
            onClick={() => set(c => { c.fases.push({ nombre: 'Nueva fase', etapa: null, icono: 'FiCircle', goal: '', tecnica: '', muestra: '', razon_participantes: '' }); })}>
            <Plus className="w-3.5 h-3.5" /> Agregar fase
          </Button>
        </div>
      </Seccion>

      <Seccion titulo="Índice de láminas" ayuda="Palomea las que van, reordénalas con las flechas. Las que Claude dejó fuera aparecen sin palomear con su razón.">
        {fueraDeLugar.length > 0 && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Entre la muestra y la inversión solo va Tiempos. {fueraDeLugar.map(l => `«${l.titulo || TIPOS_LAMINA[l.tipo] || l.tipo}»`).join(', ')} {fueraDeLugar.length > 1 ? 'van' : 'va'} después de la inversión. Puedes dejarlo así, pero el revisor lo marcará.
          </div>
        )}
        <div className="rounded-xl border border-border divide-y divide-border">
          {d.indice.map((l: any, i: number) => (
            <div key={i} className={`flex items-start gap-3 px-3 py-2.5 ${l.incluir ? '' : 'bg-muted/30'}`}>
              <input type="checkbox" className="mt-1" checked={l.incluir} onChange={e => set(c => { c.indice[i].incluir = e.target.checked; })} disabled={ocupado} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">{TIPOS_LAMINA[l.tipo] ?? l.tipo}</span>
                  <Input className={`h-7 text-sm ${l.incluir ? '' : 'opacity-60'}`} value={l.titulo} onChange={e => set(c => { c.indice[i].titulo = e.target.value; })} disabled={ocupado} />
                </div>
                <p className={`text-xs mt-1 ${l.incluir ? 'text-foreground' : 'text-muted-foreground'}`}>{l.resumen}</p>
                {l.razon && <p className="text-[11px] text-muted-foreground italic">{l.razon}</p>}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => set(c => { c.indice = mover(c.indice, i, -1); })} disabled={ocupado || i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => set(c => { c.indice = mover(c.indice, i, 1); })} disabled={ocupado || i === d.indice.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Precio" ayuda="Los precios los pones tú: Claude no propone ninguno. Escribe la cantidad (MXN $000,000.00 + IVA) o déjalo vacío o en TBC; la propuesta saldrá con un hueco marcado «PRECIO POR CONFIRMAR».">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Select value={d.precio.modo} onValueChange={v => set(c => { c.precio.modo = v; })} disabled={ocupado}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="unico">Precio único</SelectItem><SelectItem value="por_fase">Por fase</SelectItem></SelectContent>
          </Select>
          <Input className="h-8" placeholder="Total: MXN $000,000.00 + IVA o TBC" value={d.precio.total} onChange={e => set(c => { c.precio.total = e.target.value; })} disabled={ocupado} />
          <Input className="h-8 md:col-span-2" placeholder="Total en letra" value={d.precio.letra} onChange={e => set(c => { c.precio.letra = e.target.value; })} disabled={ocupado} />
        </div>
        {d.precio.partidas.map((pa: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-3">
              <Select value={String(pa.fase)} onValueChange={v => set(c => { c.precio.partidas[i].fase = Number(v); })} disabled={ocupado}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent>{faseOpts}</SelectContent>
              </Select>
            </div>
            <Input className="h-8 col-span-5" placeholder="Descripción" value={pa.descripcion} onChange={e => set(c => { c.precio.partidas[i].descripcion = e.target.value; })} disabled={ocupado} />
            <Input className="h-8 col-span-3" placeholder="MXN $000,000.00 o TBC" value={pa.precio} onChange={e => set(c => { c.precio.partidas[i].precio = e.target.value; })} disabled={ocupado} />
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => set(c => { c.precio.partidas.splice(i, 1); })} disabled={ocupado}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1.5" disabled={ocupado} onClick={() => set(c => { c.precio.partidas.push({ fase: 0, descripcion: '', precio: '' }); })}>
          <Plus className="w-3.5 h-3.5" /> Agregar partida
        </Button>
      </Seccion>

      <Seccion titulo="Tiempos" ayuda="Duraciones PROPUESTAS por Claude — pendientes de confirmar con Sergio (no son regla definitiva). La lámina se calcula con esto.">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Fecha de inicio</p>
          <Input type="date" className="h-8 w-44" value={d.tiempos.fecha_inicio ?? ''} onChange={e => set(c => { c.tiempos.fecha_inicio = e.target.value || null; })} disabled={ocupado} />
          <p className="text-[11px] text-muted-foreground">Sin fecha, las semanas salen como «Semana 1», «Semana 2»…</p>
        </div>
        <div className="grid grid-cols-12 gap-2 text-[11px] font-medium text-muted-foreground px-0.5">
          <span className="col-span-4">Actividad</span><span className="col-span-3">Fase</span><span className="col-span-2">Inicia (semana)</span><span className="col-span-2">Dura (semanas)</span>
        </div>
        {d.tiempos.actividades.map((a: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <Input className="h-8 col-span-4" value={a.nombre} onChange={e => set(c => { c.tiempos.actividades[i].nombre = e.target.value; })} disabled={ocupado} />
            <div className="col-span-3">
              <Select value={a.fase === null ? NINGUNA : String(a.fase)} onValueChange={v => set(c => { c.tiempos.actividades[i].fase = v === NINGUNA ? null : Number(v); })} disabled={ocupado}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NINGUNA}>(sin fase)</SelectItem>{faseOpts}</SelectContent>
              </Select>
            </div>
            <Input type="number" min={0} step={0.5} className="h-8 col-span-2" value={a.inicio_semana} onChange={e => set(c => { c.tiempos.actividades[i].inicio_semana = Math.max(0, Number(e.target.value)); })} disabled={ocupado} />
            <Input type="number" min={0.5} step={0.5} className="h-8 col-span-2" value={a.duracion_semanas} onChange={e => set(c => { c.tiempos.actividades[i].duracion_semanas = Math.max(0.5, Number(e.target.value)); })} disabled={ocupado} />
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => set(c => { c.tiempos.actividades.splice(i, 1); })} disabled={ocupado}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1.5" disabled={ocupado} onClick={() => set(c => { c.tiempos.actividades.push({ nombre: 'Actividad', fase: null, inicio_semana: 0, duracion_semanas: 1 }); })}>
          <Plus className="w-3.5 h-3.5" /> Agregar actividad
        </Button>
      </Seccion>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
        <div>
          <p className="text-sm font-medium">Propuesta ilustrada</p>
          <p className="text-xs text-muted-foreground">Deja huecos marcados ILUSTRACIÓN donde no subas imagen (paso Diseño).</p>
        </div>
        <Switch checked={!!d.diseno.ilustraciones} onCheckedChange={v => set(c => { c.diseno.ilustraciones = v; })} disabled={ocupado} />
      </div>

      {!participantesOk && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {faseSinElegir.length > 0 && <p>Falta decidir quiénes participan en: {faseSinElegir.map((i: number) => `«${d.fases[i].nombre}»`).join(', ')}. Elige una opción en cada fase para continuar.</p>}
          {primeraMismos >= 0 && <p>«{d.fases[primeraMismos].nombre}» es la primera fase con participantes, así que va con participantes nuevos.</p>}
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={aprobar} disabled={ocupado || !participantesOk} className="gap-1.5"><Check className="w-4 h-4" /> Aprobar esqueleto y continuar</Button>
      </div>
    </div>
  );
}
