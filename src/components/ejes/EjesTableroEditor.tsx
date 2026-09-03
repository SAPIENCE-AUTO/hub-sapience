import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getEjesIdeas, createEjesIdea, createEjesIdeasBulk, updateEjesIdea, moveEjesIdea, getEjesEvaluacionesDeIdea,
  setEjesIdeaEstado,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronUp, ChevronDown, Pencil, Users, Plus, Lock, Play, Pause } from 'lucide-react';
import { TEAL, EstadoPill } from '@/lib/toolColors';

interface IdeaRow { id: string; titulo: string; descripcion?: string; imagenUrl?: string; orden: number; estado: string; tieneEvaluaciones: boolean }
interface EvaluacionRow { alias: string; valorX: number; valorY: number }

/**
 * Editor de tablero — calca 1:1 el patrón de SwipeChapterEditor.tsx (lista
 * reordenable + alta rápida a la izquierda, preview + formulario a la
 * derecha), solo cambia el vocabulario (evaluaciones en vez de votos) y el
 * candado de edición mira `ejes_evaluaciones` en vez de `swipe_votos`. La
 * configuración de los 2 ejes vive en el tablero, no aquí — se define al
 * crear el tablero (ver EjesDashboardPage.tsx).
 */
export default function EjesTableroEditor({ tableroId, onIdeasChanged }: { tableroId: string; onIdeasChanged?: () => void }) {
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imagenUrl, setImagenUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const [quickAdd, setQuickAdd] = useState('');
  const [addingBulk, setAddingBulk] = useState(false);

  const [evaluacionesOpenId, setEvaluacionesOpenId] = useState<string | null>(null);
  const [evaluacionesByIdea, setEvaluacionesByIdea] = useState<Record<string, EvaluacionRow[]>>({});
  const shownFirstLoad = useRef(false);

  const selected = ideas.find((i) => i.id === selectedId) ?? null;
  const isNueva = selectedId === null;

  const load = async () => {
    setLoading(true);
    try {
      const res = await getEjesIdeas({ tableroId });
      setIdeas(res.ideas ?? []);
      if (!shownFirstLoad.current && (res.ideas ?? []).length > 0) {
        shownFirstLoad.current = true;
        selectIdea(res.ideas[0]);
      }
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [tableroId]);

  const selectIdea = (idea: IdeaRow) => {
    setSelectedId(idea.id);
    setTitulo(idea.titulo);
    setDescripcion(idea.descripcion ?? '');
    setImagenUrl(idea.imagenUrl ?? '');
  };

  const startNueva = () => {
    setSelectedId(null);
    setTitulo('');
    setDescripcion('');
    setImagenUrl('');
  };

  const handleGuardar = async () => {
    if (!titulo.trim()) return;
    setSaving(true);
    try {
      if (isNueva) {
        await createEjesIdea({ tableroId, titulo: titulo.trim(), descripcion: descripcion.trim() || undefined, imagenUrl: imagenUrl.trim() || undefined });
        toast.success('Idea agregada');
      } else {
        await updateEjesIdea({ ideaId: selected!.id, titulo: titulo.trim(), descripcion: descripcion.trim() || undefined, imagenUrl: imagenUrl.trim() || undefined });
      }
      await load();
      onIdeasChanged?.();
      if (isNueva) startNueva();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo guardar la idea.');
    }
    setSaving(false);
  };

  const handleQuickAdd = async () => {
    const lineas = quickAdd.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lineas.length === 0) return;
    const nuevasIdeas = lineas.map((linea) => {
      const [tituloPart, ...resto] = linea.split('|');
      return { titulo: tituloPart.trim().slice(0, 60), descripcion: resto.join('|').trim().slice(0, 180) || undefined };
    }).filter((i) => i.titulo);
    if (nuevasIdeas.length === 0) return;
    setAddingBulk(true);
    try {
      await createEjesIdeasBulk({ tableroId, ideas: nuevasIdeas });
      setQuickAdd('');
      await load();
      onIdeasChanged?.();
      toast.success(`${nuevasIdeas.length} idea${nuevasIdeas.length !== 1 ? 's' : ''} agregada${nuevasIdeas.length !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudieron agregar las ideas.');
    }
    setAddingBulk(false);
  };

  const handleMove = async (ideaId: string, direccion: 'arriba' | 'abajo') => {
    try {
      await moveEjesIdea({ ideaId, direccion });
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo mover la idea.');
    }
  };

  const handleToggleIdeaEstado = async (idea: IdeaRow) => {
    const nuevoEstado = idea.estado === 'abierto' ? 'cerrado' : 'abierto';
    try {
      await setEjesIdeaEstado({ ideaId: idea.id, estado: nuevoEstado });
      await load();
      onIdeasChanged?.();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo cambiar el estado de la idea.');
    }
  };

  const toggleEvaluaciones = async (ideaId: string) => {
    if (evaluacionesOpenId === ideaId) { setEvaluacionesOpenId(null); return; }
    setEvaluacionesOpenId(ideaId);
    if (!evaluacionesByIdea[ideaId]) {
      const res = await getEjesEvaluacionesDeIdea({ ideaId });
      setEvaluacionesByIdea((prev) => ({ ...prev, [ideaId]: res.evaluaciones ?? [] }));
    }
  };

  const lineasDetectadas = quickAdd.split('\n').map((l) => l.trim()).filter(Boolean).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-3">
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
          <Textarea
            placeholder={'Alta rápida: pega varias ideas, una por línea — Título | Descripción opcional'}
            value={quickAdd}
            onChange={(e) => setQuickAdd(e.target.value)}
            rows={3}
            className="resize-y text-xs"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {lineasDetectadas > 0 ? `${lineasDetectadas} línea${lineasDetectadas !== 1 ? 's' : ''} detectada${lineasDetectadas !== 1 ? 's' : ''}` : ' '}
            </span>
            <Button size="sm" variant="outline" onClick={handleQuickAdd} disabled={addingBulk || lineasDetectadas === 0}>
              {addingBulk ? 'Agregando…' : `Agregar ${lineasDetectadas || ''} idea${lineasDetectadas !== 1 ? 's' : ''}`.trim()}
            </Button>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!loading && ideas.length === 0 && <p className="text-sm text-muted-foreground">Sin ideas todavía.</p>}

        <div className="space-y-1.5">
          {ideas.map((idea, i) => (
            <div key={idea.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => selectIdea(idea)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectIdea(idea); }}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${selectedId === idea.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent'}`}
              >
                {idea.imagenUrl ? (
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                    <img src={idea.imagenUrl} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                ) : (
                  <div className="h-9 w-9 flex-shrink-0 rounded-md bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-foreground">{idea.titulo}</p>
                    <EstadoPill estado={idea.estado} />
                  </div>
                  {idea.descripcion && <p className="truncate text-xs text-muted-foreground">{idea.descripcion}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); handleMove(idea.id, 'arriba'); }}
                    disabled={i === 0}
                    aria-label="Mover arriba"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); handleMove(idea.id, 'abajo'); }}
                    disabled={i === ideas.length - 1}
                    aria-label="Mover abajo"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); toggleEvaluaciones(idea.id); }}
                    aria-label="Ver evaluaciones"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                  {idea.tieneEvaluaciones ? (
                    <span className="ml-0.5 flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
                      <Lock className="h-2.5 w-2.5" /> con evaluaciones
                    </span>
                  ) : (
                    <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={(e) => { e.stopPropagation(); selectIdea(idea); }} aria-label="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    className="ml-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white hover:opacity-90"
                    style={{ backgroundColor: TEAL }}
                    onClick={(e) => { e.stopPropagation(); handleToggleIdeaEstado(idea); }}
                    aria-label={idea.estado === 'abierto' ? 'Cerrar idea' : 'Abrir idea'}
                  >
                    {idea.estado === 'abierto' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </button>
                </div>
              </div>
              {evaluacionesOpenId === idea.id && (
                <div className="ml-2 mt-1 space-y-0.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                  {evaluacionesByIdea[idea.id] === undefined && <p className="text-xs text-muted-foreground">Cargando…</p>}
                  {evaluacionesByIdea[idea.id]?.length === 0 && <p className="text-xs text-muted-foreground">Nadie ha evaluado esta idea todavía.</p>}
                  {(evaluacionesByIdea[idea.id] ?? []).map((ev, vi) => (
                    <div key={vi} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{ev.alias}</span>
                      <span className="text-muted-foreground">({Math.round(ev.valorX)}, {Math.round(ev.valorY)})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <Button size="sm" variant="outline" onClick={startNueva} className={isNueva ? 'border-primary text-primary' : ''}>
          <Plus className="h-3.5 w-3.5" /> Nueva idea
        </Button>
      </div>

      <div className="lg:sticky lg:top-4">
        <p className="mb-2 text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Así se ve para el participante</p>
        <div className="mb-3 rounded-2xl bg-[linear-gradient(160deg,#14495A_0%,#0F3D4D_55%,#0A2F3B_100%)] p-3">
          <div className="overflow-hidden rounded-2xl shadow-lg">
            {imagenUrl ? (
              <div className="bg-white">
                <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[#eef1f2]">
                  <img src={imagenUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
                  <img src={imagenUrl} alt="" className="relative max-h-full max-w-full object-contain p-3" />
                </div>
                <div className="px-4 pb-4 pt-3.5">
                  <p className="text-[17px] font-bold leading-tight text-[#0F3D4D]">{titulo || 'Título de la idea'}</p>
                  {descripcion && <p className="mt-1 text-[12.5px] leading-snug text-[#6b7280]">{descripcion}</p>}
                </div>
              </div>
            ) : (
              // Sin imagen: la idea es la protagonista — no se reserva un
              // hueco vacío donde iría la foto, el texto llena todo el bloque
              // (mismo criterio que EjesEvaluacionSliders.tsx, la card real).
              <div className="flex min-h-[220px] flex-col items-center justify-center bg-[linear-gradient(160deg,#14495A_0%,#0F3D4D_55%,#0A2F3B_100%)] px-6 py-8 text-center">
                <p className="text-[22px] font-bold leading-tight text-white">{titulo || 'Título de la idea'}</p>
                {descripcion && <p className="mt-2 text-[14px] leading-snug text-[#8FB6C0]">{descripcion}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-3">
          {selected?.tieneEvaluaciones && (
            <p className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground">
              <Lock className="h-3.5 w-3.5" /> Esta idea ya tiene evaluaciones — no se puede editar.
            </p>
          )}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Título (máx. 60)</label>
            <Input value={titulo} maxLength={60} disabled={!!selected?.tieneEvaluaciones} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Descripción (máx. 180)</label>
            <Textarea value={descripcion} maxLength={180} rows={2} disabled={!!selected?.tieneEvaluaciones} onChange={(e) => setDescripcion(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Imagen (URL)</label>
            <Input value={imagenUrl} disabled={!!selected?.tieneEvaluaciones} onChange={(e) => setImagenUrl(e.target.value)} placeholder="Pega una URL" />
          </div>
          <Button className="w-full" onClick={handleGuardar} disabled={saving || !titulo.trim() || !!selected?.tieneEvaluaciones}>
            {saving ? 'Guardando…' : isNueva ? 'Agregar idea' : 'Guardar cambios'}
          </Button>
        </div>
      </div>
    </div>
  );
}
