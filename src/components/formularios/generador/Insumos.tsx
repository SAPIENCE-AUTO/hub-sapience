import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, Loader2, Mic, Upload, X } from 'lucide-react';
import { getFormularioReuniones, getMuestra } from 'zite-endpoints-sdk';
import { INFO, TEAL } from '@/lib/toolColors';
import { traeArchivos } from '@/lib/swipe/imagenes';
import type { ReunionInsumo } from '@/lib/formularios/generador';
import type { GeneradorUI } from './useGenerador';
import { AvanceIA, Etiqueta, MarcaIA, archivoABase64, botonSecundario, botonTeal } from './comun';

type Reunion = ReunionInsumo & { tipo?: string };

/** Lo que el filtro ya trae de la muestra del proyecto (sin contar lo que el filtro también tiene). */
interface DeLaMuestra {
  perfiles: { nombre: string; cuota: number }[];
  archivos: string[];
  reuniones: ReunionInsumo[];
  notas: string;
}

/** Lo que acepta cada punto de partida, por extensión. */
const ACEPTA = { word: ['docx', 'pdf'], otros: ['pdf', 'pptx', 'docx'] };
const extension = (nombre: string) => nombre.split('.').pop()?.toLowerCase() ?? '';

const fecha = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TIPO_ARCHIVO = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', imagen: 'Imagen' } as const;

/**
 * Paso 1 del generador: de dónde sale el filtro. Notas, la propuesta (PDF o
 * PowerPoint) y la transcripción del kick-off de Notetaker; o el Word de un
 * screener que ya existe; o qué cambia de un filtro anterior.
 */
export function Insumos({ gen, formularioId, proyectoId }: { gen: GeneradorUI; formularioId: string; proyectoId?: string }) {
  const g = gen.g!;
  const origen = g.origen;
  const [notas, setNotas] = useState(g.insumos.notas ?? '');
  const [subiendo, setSubiendo] = useState<string[]>([]);
  const [reuniones, setReuniones] = useState<Reunion[] | null>(null);
  const [encima, setEncima] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const acepta = origen === 'word' ? ACEPTA.word : ACEPTA.otros;
  const elegidas = new Set(g.insumos.reuniones.map((r) => r.id));
  const [muestra, setMuestra] = useState<DeLaMuestra | null>(null);

  // Los perfiles, las cuotas y los insumos de la muestra del proyecto: el filtro los usa sin volver a subirlos.
  useEffect(() => {
    if (!proyectoId) return;
    getMuestra({ proyectoId }).then((r) => {
      const ins = r.insumos?.insumos ?? { archivos: [], reuniones: [] };
      const perfiles = ((r.muestra?.definicion?.perfiles ?? []) as { nombre: string; cuota: number }[]).filter((p) => p.cuota > 0);
      setMuestra({ perfiles, archivos: (ins.archivos ?? []).map((a: { nombre: string }) => a.nombre), reuniones: ins.reuniones ?? [], notas: ins.notas?.trim() ?? '' });
    }).catch(() => setMuestra(null));
  }, [proyectoId]);
  const propiosArchivos = new Set(g.insumos.archivos.map((a) => a.nombre.trim().toLowerCase()));
  const archivosMuestra = (muestra?.archivos ?? []).filter((n) => !propiosArchivos.has(n.trim().toLowerCase()));
  const reunionesMuestra = new Set((muestra?.reuniones ?? []).map((r) => r.id));
  const soloDeMuestra = (muestra?.reuniones ?? []).filter((r) => !elegidas.has(r.id));
  // El texto de la muestra cuenta si no es el mismo del filtro (mientras nadie la toca, la muestra usa el de un filtro).
  const notasMuestra = !!muestra?.notas && muestra.notas !== (g.insumos.notas ?? '').trim();
  const hayDeMuestra = !!muestra && (muestra.perfiles.length > 0 || archivosMuestra.length > 0 || soloDeMuestra.length > 0 || notasMuestra);

  useEffect(() => {
    if (origen === 'word') return;
    getFormularioReuniones({ formularioId }).then((r) => setReuniones(r.reuniones ?? [])).catch(() => setReuniones([]));
  }, [formularioId, origen]);

  const guardarNotas = async () => {
    if (notas === (g.insumos.notas ?? '')) return;
    try { await gen.guardarInsumos({ notas }); } catch (err) { toast.error((err as Error).message); }
  };

  const subir = async (archivos: FileList | File[] | null) => {
    const lista = Array.from(archivos ?? []);
    const fuera = lista.filter((a) => !acepta.includes(extension(a.name)));
    if (fuera.length) toast.error(`${fuera.map((a) => `«${a.name}»`).join(', ')}: sube ${origen === 'word' ? 'un Word o un PDF' : 'un PDF, un PowerPoint o un Word'}.`);
    for (const archivo of lista.filter((a) => acepta.includes(extension(a.name)))) {
      setSubiendo((s) => [...s, archivo.name]);
      try {
        await gen.guardarInsumos({ archivo: { nombre: archivo.name, mime: archivo.type, base64: await archivoABase64(archivo) } });
      } catch (err) {
        toast.error((err as Error).message || `No se pudo subir «${archivo.name}».`);
      } finally {
        setSubiendo((s) => s.filter((n) => n !== archivo.name));
      }
    }
    if (input.current) input.current.value = '';
  };

  const alternarReunion = async (r: Reunion) => {
    const lista = elegidas.has(r.id) ? g.insumos.reuniones.filter((x) => x.id !== r.id) : [...g.insumos.reuniones, { id: r.id, titulo: r.titulo, fecha: r.fecha }];
    try { await gen.guardarInsumos({ reuniones: lista }); } catch (err) { toast.error((err as Error).message); }
  };

  const proponer = async () => {
    await guardarNotas();
    await gen.pedirEstructura(origen === 'filtro' ? notas.trim() || undefined : undefined);
  };

  const hayAlgo = !!(notas.trim() || g.insumos.archivos.length || g.insumos.reuniones.length || archivosMuestra.length || soloDeMuestra.length || notasMuestra);
  const listo = origen === 'word' ? g.insumos.archivos.length > 0 : origen === 'filtro' ? true : hayAlgo;
  const ocupado = gen.llamada.corriendo || subiendo.length > 0;

  const titulo = origen === 'word' ? 'El screener que ya existe' : origen === 'filtro' ? `Partes de «${g.insumos.filtroBase?.titulo ?? 'un filtro anterior'}»` : 'De dónde sale el filtro';
  const textoNotas = origen === 'filtro'
    ? '¿Qué cambia para este estudio? Perfil, cuotas, ciudad, marcas, condiciones…'
    : origen === 'word'
      ? 'Algo que cambiar al convertirlo (opcional).'
      : 'Lo que no dicen la propuesta ni el kick-off: cuotas, ciudad, edades, incentivo, lo que pidió el cliente…';

  // Se puede soltar el archivo en cualquier parte del paso, no solo en el recuadro.
  const arrastre = {
    onDragOver: (e: React.DragEvent) => { if (!traeArchivos(e.dataTransfer)) return; e.preventDefault(); if (!ocupado) setEncima(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false); },
    onDrop: (e: React.DragEvent) => {
      if (!traeArchivos(e.dataTransfer)) return;
      e.preventDefault();
      setEncima(false);
      if (!ocupado) void subir(e.dataTransfer.files);
    },
  };

  return (
    <div className="space-y-5" {...arrastre}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: TEAL }}>{titulo}</h3>
        {origen === 'word' && <p className="text-xs text-muted-foreground">Se convierte en un filtro editable con su misma redacción. Lo que la IA tenga que interpretar queda en los supuestos.</p>}
        {origen === 'filtro' && <p className="text-xs text-muted-foreground">Ya es una copia. Si no cambia nada, úsalo tal cual; si cambia algo, la IA lo adapta y lo que no cambia se queda igual.</p>}
      </div>

      {hayDeMuestra && muestra && (
        <section className="space-y-1.5 rounded-lg border px-3 py-2.5" style={{ borderColor: `${TEAL}30`, backgroundColor: `${TEAL}06` }}>
          <Etiqueta>De la Muestra · se usa sola</Etiqueta>
          {muestra.perfiles.length > 0 && (
            <p className="text-sm"><span className="font-medium" style={{ color: TEAL }}>Perfiles y cuotas: </span>{muestra.perfiles.map((p) => `${p.nombre} ${p.cuota}`).join(' · ')}</p>
          )}
          {(archivosMuestra.length > 0 || soloDeMuestra.length > 0 || notasMuestra) && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium" style={{ color: TEAL }}>Insumos: </span>
              {[...archivosMuestra, ...soloDeMuestra.map((r) => r.titulo), ...(notasMuestra ? ['texto de la Muestra'] : [])].join(' · ')}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">Se cambian en Reclutamiento → Muestra. Aquí suma solo lo propio del filtro.</p>
        </section>
      )}

      <section className="space-y-1.5">
        <Etiqueta>{origen === 'filtro' ? 'Qué cambia' : 'Notas'}</Etiqueta>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          onBlur={guardarNotas}
          disabled={gen.llamada.corriendo}
          rows={origen === 'insumos' ? 5 : 3}
          placeholder={textoNotas}
          className="w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-[#0F3D4D]/50"
        />
      </section>

      <section className="space-y-1.5">
        <Etiqueta>{origen === 'word' ? 'Word o PDF del screener' : 'Archivos: propuesta en PDF o PowerPoint, o un Word'}</Etiqueta>
        <input ref={input} type="file" multiple={origen !== 'word'} accept={acepta.map((x) => `.${x}`).join(',')} className="hidden" onChange={(e) => subir(e.target.files)} />
        {g.insumos.archivos.length > 0 && (
          <ul className="space-y-1">
            {g.insumos.archivos.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-sm">
                <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{a.nombre}</span>
                <span className="text-[11px] text-muted-foreground">{TIPO_ARCHIVO[a.tipo]}{a.caracteres ? ` · ${a.caracteres >= 1000 ? `${Math.round(a.caracteres / 1000)} mil` : a.caracteres} caracteres` : ''}</span>
                <button type="button" aria-label={`Quitar ${a.nombre}`} disabled={ocupado} onClick={() => gen.guardarInsumos({ quitarArchivo: a.id }).catch((err) => toast.error((err as Error).message))} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-[#D32222]"><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        {subiendo.map((n) => <p key={n} className="flex items-center gap-2 px-2.5 py-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{n}</p>)}
        <button
          type="button"
          disabled={ocupado}
          onClick={() => input.current?.click()}
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors disabled:pointer-events-none disabled:opacity-50 ${encima ? 'border-[#0F3D4D] bg-[#0F3D4D]/[0.05]' : 'border-[#0F3D4D]/25 bg-white hover:border-[#0F3D4D]/50 hover:bg-[#0F3D4D]/[0.02]'}`}
        >
          <Upload className="h-5 w-5" style={{ color: TEAL }} />
          <span className="text-sm font-medium" style={{ color: TEAL }}>{encima ? 'Suelta el archivo aquí' : 'Arrastra el archivo aquí o haz clic para elegirlo'}</span>
          <span className="text-[11px] text-muted-foreground">{origen === 'word' ? 'Word o PDF' : 'PDF, PowerPoint o Word'} · hasta 25 MB</span>
        </button>
      </section>

      {origen !== 'word' && (
        <section className="space-y-1.5">
          <Etiqueta>Reuniones de Notetaker</Etiqueta>
          {reuniones === null && <p className="text-xs text-muted-foreground">Buscando reuniones…</p>}
          {reuniones?.length === 0 && <p className="text-xs text-muted-foreground">Este proyecto no tiene reuniones con transcripción. Si el kick-off no se grabó en Notetaker, pega lo importante en las notas.</p>}
          <ul className="space-y-1">
            {reuniones?.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-sm hover:bg-[#0F3D4D]/[0.02]">
                  <input type="checkbox" checked={elegidas.has(r.id) || reunionesMuestra.has(r.id)} disabled={ocupado || (reunionesMuestra.has(r.id) && !elegidas.has(r.id))} title={reunionesMuestra.has(r.id) && !elegidas.has(r.id) ? 'Viene de la Muestra' : undefined} onChange={() => alternarReunion(r)} className="h-4 w-4 accent-[#0F3D4D]" />
                  <Mic className="h-4 w-4 flex-shrink-0" style={{ color: INFO }} />
                  <span className="min-w-0 flex-1 truncate">{r.titulo}</span>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{[r.tipo, fecha(r.fecha)].filter(Boolean).join(' · ')}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gen.llamada.corriendo
        ? <AvanceIA pasos={gen.llamada.pasos} segundos={gen.llamada.segundos} onDetener={gen.detener} />
        : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={botonTeal} disabled={!listo || ocupado} onClick={proponer}>
              <MarcaIA />{origen === 'word' ? 'Convertir el screener' : origen === 'filtro' ? 'Adaptar con la IA' : 'Proponer la estructura'}
            </button>
            {origen === 'filtro' && <button type="button" className={botonSecundario} disabled={ocupado} onClick={() => gen.usarTalCual().catch((err) => toast.error((err as Error).message))}>Usarlo tal cual</button>}
            <span className="text-[11px] text-muted-foreground">Tarda uno o dos minutos. Primero verás la estructura para revisarla.</span>
          </div>
        )}
    </div>
  );
}
