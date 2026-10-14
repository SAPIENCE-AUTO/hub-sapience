import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getSwipeIdeas, createSwipeIdea, createSwipeIdeasBulk, updateSwipeIdea, moveSwipeIdea, getSwipeVotosDeIdea,
  deleteSwipeIdea, duplicateSwipeIdea, updateSwipeVoto, setSwipeCapituloAleatorio,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChevronUp, ChevronDown, Pencil, Users, Plus, Lock, Play, Copy, Trash2, ImagePlus, Loader2, Shuffle } from 'lucide-react';
import SwipePreviewModal from './SwipePreviewModal';
import { CardBody } from './SwipeCardStack';
import ZonaImagenes from './ZonaImagenes';
import { avisoDeConcepto } from '@/lib/swipe/concepto';
import { enCola } from '@/lib/swipe/cola';
import {
  esCampoDeTexto, imagenesDe, prepararConcepto, subirIlustracion, traeArchivos, traeTexto,
} from '@/lib/swipe/imagenes';

interface IdeaRow { id: string; titulo: string; descripcion?: string; imagenUrl?: string; orden: number; tieneVotos: boolean }
interface VotoRow { id: string; alias: string; valor: string }

const VALOR_LABEL: Record<string, string> = { potencial: 'Potencial', descarte: 'Descarte', super: 'Super like' };
const VALOR_OPCIONES: Array<'potencial' | 'descarte' | 'super'> = ['potencial', 'descarte', 'super'];

/**
 * Editor de capítulo: lista reordenable + alta rápida a la izquierda,
 * preview real de la card (como la ve el participante) + formulario a la
 * derecha. Reemplaza el <ul> plano + diálogo modal por idea que había
 * antes — el facilitador arma 5-10 ideas por capítulo antes de cada
 * workshop y abrir un modal por cada una era el cuello de botella.
 *
 * Reordenar es con flechas arriba/abajo (swap de `orden` con el vecino),
 * no drag-and-drop — no hay librería de DnD en el repo y para una lista
 * de este tamaño no hace falta traer una.
 *
 * Imágenes: se pueden arrastrar o pegar (⌘V). En el formulario de una idea ponen su ilustración tal cual; en cualquier
 * otra parte del editor son conceptos (láminas) y la IA lee nombre, descripción e ilustración para crear una idea por imagen.
 */
export default function SwipeChapterEditor({ capituloId, onIdeasChanged }: { capituloId: string; onIdeasChanged?: () => void }) {
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imagenUrl, setImagenUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const [quickAdd, setQuickAdd] = useState('');
  const [addingBulk, setAddingBulk] = useState(false);

  const [votosOpenId, setVotosOpenId] = useState<string | null>(null);
  const [votosByIdea, setVotosByIdea] = useState<Record<string, VotoRow[]>>({});
  const [updatingVotoId, setUpdatingVotoId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ideaToDelete, setIdeaToDelete] = useState<IdeaRow | null>(null);
  const [deletingIdea, setDeletingIdea] = useState(false);
  const [duplicatingIdeaId, setDuplicatingIdeaId] = useState<string | null>(null);
  const shownFirstLoad = useRef(false);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [aleatorio, setAleatorio] = useState(false);
  const [leyendo, setLeyendo] = useState<{ hechas: number; total: number } | null>(null);
  const leyendoRef = useRef(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const selected = ideas.find((i) => i.id === selectedId) ?? null;
  const isNueva = selectedId === null;

  const load = async (): Promise<IdeaRow[]> => {
    setLoading(true);
    try {
      const res = await getSwipeIdeas({ capituloId });
      const lista: IdeaRow[] = res.ideas ?? [];
      setIdeas(lista);
      setAleatorio(!!res.aleatorio);
      if (!shownFirstLoad.current && lista.length > 0) {
        shownFirstLoad.current = true;
        selectIdea(lista[0]);
      }
      return lista;
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [capituloId]);

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
        await createSwipeIdea({ capituloId, titulo: titulo.trim(), descripcion: descripcion.trim() || undefined, imagenUrl: imagenUrl.trim() || undefined });
        toast.success('Idea agregada');
      } else {
        await updateSwipeIdea({ ideaId: selected!.id, titulo: titulo.trim(), descripcion: descripcion.trim() || undefined, imagenUrl: imagenUrl.trim() || undefined });
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
      await createSwipeIdeasBulk({ capituloId, ideas: nuevasIdeas });
      setQuickAdd('');
      await load();
      onIdeasChanged?.();
      toast.success(`${nuevasIdeas.length} idea${nuevasIdeas.length !== 1 ? 's' : ''} agregada${nuevasIdeas.length !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudieron agregar las ideas.');
    }
    setAddingBulk(false);
  };

  // Se guarda al momento (no espera a ningún botón); si falla, la casilla vuelve a como estaba.
  const handleAleatorio = async (valor: boolean) => {
    setAleatorio(valor);
    try {
      await setSwipeCapituloAleatorio({ capituloId, aleatorio: valor });
    } catch (err) {
      setAleatorio(!valor);
      toast.error((err as Error)?.message || 'No se pudo cambiar el orden.');
    }
  };

  // Vía manual: la imagen es la ilustración de la idea que se está editando. No se guarda hasta pulsar «Guardar».
  const ponerIlustracion = async (archivos: File[]) => {
    if (selected?.tieneVotos) { toast.error('Esta idea ya tiene votos — no se puede editar.'); return; }
    setSubiendoImagen(true);
    try {
      setImagenUrl(await subirIlustracion(archivos[0]));
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo subir la imagen.');
    }
    setSubiendoImagen(false);
  };

  // Vía con IA: cada imagen es un concepto (una lámina). Se leen de a 3, en el orden que se soltaron, y las ideas se crean
  // juntas al final. Cada imagen tiene 15 s en total; si la IA no alcanza, la idea sale con la imagen y el texto lo pones tú.
  const crearDesdeImagenes = async (archivos: File[]) => {
    if (leyendoRef.current) { toast.info('Espera a que termine la tanda anterior.'); return; }
    const lote = archivos.slice(0, 50);
    if (archivos.length > lote.length) toast.warning(`Van las primeras ${lote.length}; el resto, en otra tanda.`);
    leyendoRef.current = true;
    setLeyendo({ hechas: 0, total: lote.length });
    try {
      const resultados = await Promise.all(enCola(lote.map((archivo) => async () => {
        try {
          return { ok: true as const, concepto: await prepararConcepto(archivo, true) };
        } catch (err) {
          return { ok: false as const, error: (err as Error)?.message || `No se pudo procesar «${archivo.name}».` };
        } finally {
          setLeyendo((previo) => (previo ? { ...previo, hechas: previo.hechas + 1 } : previo));
        }
      }), 3));

      const buenas = resultados.flatMap((r) => (r.ok ? [r.concepto] : []));
      const fallidas = resultados.flatMap((r) => (r.ok ? [] : [r.error]));
      if (buenas.length > 0) {
        const { ids } = await createSwipeIdeasBulk({
          capituloId,
          ideas: buenas.map((c) => ({ titulo: c.titulo, descripcion: c.descripcion || undefined, imagenUrl: c.imagenUrl })),
        });
        const lista = await load();
        onIdeasChanged?.();
        // Se abre la primera que pide revisión; si todas salieron limpias, la primera.
        const porRevisar = buenas.map((c, i) => ({ id: ids[i] as string, titulo: c.titulo, aviso: avisoDeConcepto(c.ia) })).filter((x) => x.aviso);
        const abrir = lista.find((i) => i.id === (porRevisar[0]?.id ?? ids[0]));
        if (abrir) selectIdea(abrir);
        const mensaje = `${buenas.length} idea${buenas.length !== 1 ? 's' : ''} creada${buenas.length !== 1 ? 's' : ''}${porRevisar.length ? ` · ${porRevisar.length} para revisar` : ''}`;
        const detalle = porRevisar.slice(0, 3).map((x) => `«${x.titulo}»: ${x.aviso}`).join('\n') || undefined;
        if (porRevisar.length) toast.warning(mensaje, { description: detalle }); else toast.success(mensaje);
      }
      if (fallidas.length > 0) {
        toast.error(`No se pudo abrir ${fallidas.length} imagen${fallidas.length !== 1 ? 'es' : ''}`, { description: fallidas.slice(0, 3).join('\n') });
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudieron crear las ideas.');
    }
    leyendoRef.current = false;
    setLeyendo(null);
  };

  // Pegar (⌘V): dentro del formulario es la ilustración de esa idea; en el resto del editor (o sin cursor en ningún campo),
  // conceptos con IA. Pegar texto en un campo se deja como siempre.
  const manejadores = useRef({ ponerIlustracion, crearDesdeImagenes });
  manejadores.current = { ponerIlustracion, crearDesdeImagenes };
  useEffect(() => {
    const alPegar = (e: ClipboardEvent) => {
      const archivos = imagenesDe(e.clipboardData);
      if (archivos.length === 0) return;
      const destino = e.target;
      const dentro = destino instanceof Node && !!raizRef.current?.contains(destino);
      const sinCampo = destino === document.body || destino === document.documentElement;
      if (!dentro && !sinCampo) return;
      if (esCampoDeTexto(destino) && traeTexto(e.clipboardData)) return;
      e.preventDefault();
      if (destino instanceof Node && formRef.current?.contains(destino)) void manejadores.current.ponerIlustracion(archivos);
      else void manejadores.current.crearDesdeImagenes(archivos);
    };
    document.addEventListener('paste', alPegar);
    return () => document.removeEventListener('paste', alPegar);
  }, []);

  const handleMove = async (ideaId: string, direccion: 'arriba' | 'abajo') => {
    try {
      await moveSwipeIdea({ ideaId, direccion });
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo mover la idea.');
    }
  };

  const handleDuplicateIdea = async (ideaId: string) => {
    setDuplicatingIdeaId(ideaId);
    try {
      await duplicateSwipeIdea({ ideaId });
      await load();
      onIdeasChanged?.();
      toast.success('Idea duplicada');
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo duplicar la idea.');
    }
    setDuplicatingIdeaId(null);
  };

  const handleDeleteIdea = async () => {
    if (!ideaToDelete) return;
    setDeletingIdea(true);
    try {
      await deleteSwipeIdea({ ideaId: ideaToDelete.id });
      if (selectedId === ideaToDelete.id) startNueva();
      setIdeaToDelete(null);
      await load();
      onIdeasChanged?.();
      toast.success('Idea eliminada');
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo eliminar la idea.');
    }
    setDeletingIdea(false);
  };

  const toggleVotos = async (ideaId: string) => {
    if (votosOpenId === ideaId) { setVotosOpenId(null); return; }
    setVotosOpenId(ideaId);
    if (!votosByIdea[ideaId]) {
      const res = await getSwipeVotosDeIdea({ ideaId });
      setVotosByIdea((prev) => ({ ...prev, [ideaId]: res.votos ?? [] }));
    }
  };

  // Corrección manual de un voto puntual — mandatorio (ver el pedido del
  // usuario). Los resultados agregados leen swipe_votos en vivo, así que
  // no hace falta invalidar nada más que esta lista local de votos.
  const handleUpdateVoto = async (ideaId: string, votoId: string, valor: 'potencial' | 'descarte' | 'super') => {
    setUpdatingVotoId(votoId);
    try {
      await updateSwipeVoto({ votoId, valor });
      setVotosByIdea((prev) => ({
        ...prev,
        [ideaId]: (prev[ideaId] ?? []).map((v) => (v.id === votoId ? { ...v, valor } : v)),
      }));
      onIdeasChanged?.();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo corregir el voto.');
    }
    setUpdatingVotoId(null);
  };

  const lineasDetectadas = quickAdd.split('\n').map((l) => l.trim()).filter(Boolean).length;

  return (
    <div
      ref={raizRef}
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
      // Una imagen soltada fuera de una zona no debe abrirse en la pestaña: cuenta como concepto.
      onDragOver={(e) => { if (traeArchivos(e.dataTransfer)) e.preventDefault(); }}
      onDrop={(e) => {
        if (!traeArchivos(e.dataTransfer)) return;
        e.preventDefault();
        const archivos = imagenesDe(e.dataTransfer);
        if (archivos.length > 0) void crearDesdeImagenes(archivos);
      }}
    >
      <div className="min-w-0 space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <Shuffle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">Orden aleatorio</span>
              <span className="block text-[11px] text-muted-foreground">Cada participante ve las ideas en un orden distinto</span>
            </span>
          </span>
          <Switch checked={aleatorio} onCheckedChange={handleAleatorio} aria-label="Orden aleatorio" />
        </label>

        <ZonaImagenes multiple onImagenes={crearDesdeImagenes} disabled={!!leyendo}>
          {leyendo ? (
            <>
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
              <p className="text-xs font-semibold text-foreground">Leyendo {Math.min(leyendo.hechas + 1, leyendo.total)} de {leyendo.total}…</p>
            </>
          ) : (
            <>
              <ImagePlus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">Arrastra o pega conceptos en imagen</p>
                <p className="text-[11px] text-muted-foreground">La IA pone nombre y descripción y recorta la ilustración</p>
              </div>
            </>
          )}
        </ZonaImagenes>

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
                  <p className="truncate text-sm font-medium text-foreground">{idea.titulo}</p>
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
                    onClick={(e) => { e.stopPropagation(); toggleVotos(idea.id); }}
                    aria-label="Ver votos"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                    onClick={(e) => { e.stopPropagation(); handleDuplicateIdea(idea.id); }}
                    disabled={duplicatingIdeaId === idea.id}
                    aria-label="Duplicar idea"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {idea.tieneVotos ? (
                    <span className="ml-0.5 flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-secondary-foreground">
                      <Lock className="h-2.5 w-2.5" /> con votos
                    </span>
                  ) : (
                    <>
                      <button className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={(e) => { e.stopPropagation(); selectIdea(idea); }} aria-label="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setIdeaToDelete(idea); }}
                        aria-label="Eliminar idea"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {votosOpenId === idea.id && (
                <div className="ml-2 mt-1 space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                  {votosByIdea[idea.id] === undefined && <p className="text-xs text-muted-foreground">Cargando…</p>}
                  {votosByIdea[idea.id]?.length === 0 && <p className="text-xs text-muted-foreground">Nadie ha votado esta idea todavía.</p>}
                  {(votosByIdea[idea.id] ?? []).map((voto) => (
                    <div key={voto.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-foreground">{voto.alias}</span>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        {VALOR_OPCIONES.map((opcion) => (
                          <button
                            key={opcion}
                            onClick={() => handleUpdateVoto(idea.id, voto.id, opcion)}
                            disabled={updatingVotoId === voto.id}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50 ${
                              voto.valor === opcion
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-transparent text-muted-foreground hover:bg-accent'
                            }`}
                          >
                            {VALOR_LABEL[opcion]}
                          </button>
                        ))}
                      </div>
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

      <div className="lg:sticky lg:top-4 lg:w-[320px]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Así se ve para el participante</p>
          <button
            onClick={() => setPreviewOpen(true)}
            disabled={ideas.length === 0}
            className="flex flex-shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-3 w-3" /> Preview
          </button>
        </div>
        <div className="mb-3 rounded-2xl bg-[linear-gradient(160deg,#14495A_0%,#0F3D4C_55%,#0A2F3B_100%)] p-3">
          <div className="aspect-[3/4] overflow-hidden rounded-2xl shadow-lg">
            <CardBody idea={{ id: 'preview', titulo: titulo || 'Título de la idea', descripcion, imagenUrl }} />
          </div>
        </div>

        <div ref={formRef} className="space-y-3 rounded-lg border border-border p-3">
          {selected?.tieneVotos && (
            <p className="flex items-center gap-1.5 rounded-md bg-secondary/40 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground">
              <Lock className="h-3.5 w-3.5" /> Esta idea ya tiene votos — no se puede editar.
            </p>
          )}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Título (máx. 60)</label>
            <Input value={titulo} maxLength={60} disabled={!!selected?.tieneVotos} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Descripción (máx. 180)</label>
            <Textarea value={descripcion} maxLength={180} rows={2} disabled={!!selected?.tieneVotos} onChange={(e) => setDescripcion(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Imagen</label>
            <ZonaImagenes onImagenes={ponerIlustracion} disabled={!!selected?.tieneVotos || subiendoImagen}>
              {subiendoImagen ? (
                <>
                  <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Subiendo…</p>
                </>
              ) : (
                <>
                  <ImagePlus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{imagenUrl ? 'Arrastra o pega otra para cambiarla' : 'Arrastra o pega la ilustración'}</p>
                </>
              )}
            </ZonaImagenes>
            <Input className="mt-1.5" value={imagenUrl} disabled={!!selected?.tieneVotos} onChange={(e) => setImagenUrl(e.target.value)} placeholder="…o pega una URL" />
          </div>
          <Button className="w-full" onClick={handleGuardar} disabled={saving || subiendoImagen || !titulo.trim() || !!selected?.tieneVotos}>
            {saving ? 'Guardando…' : isNueva ? 'Agregar idea' : 'Guardar cambios'}
          </Button>
        </div>
      </div>

      {previewOpen && (
        <SwipePreviewModal
          ideas={ideas.map((i) => ({ id: i.id, titulo: i.titulo, descripcion: i.descripcion, imagenUrl: i.imagenUrl }))}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      <AlertDialog open={!!ideaToDelete} onOpenChange={(open) => { if (!open) setIdeaToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{ideaToDelete?.titulo}"?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingIdea}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteIdea}
              disabled={deletingIdea}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingIdea ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
