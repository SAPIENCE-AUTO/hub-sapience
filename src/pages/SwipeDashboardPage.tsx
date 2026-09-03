import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSwipeSesiones, createSwipeSesion, deleteSwipeSesion, getSwipeSesionDetail, createSwipeCapitulo,
  setSwipeCapituloEstado, getSwipeResultados, getSwipeResultadosSesion,
  deleteSwipeCapitulo, duplicateSwipeCapitulo,
} from 'zite-endpoints-sdk';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Copy, Plus, Star, Trash2, Maximize2, Check, Play, Pause } from 'lucide-react';
import SwipeResultsProjection, { QUADRANTE_META, type SwipeQuadrante } from '@/components/swipe/SwipeResultsProjection';
import SwipeChapterEditor from '@/components/swipe/SwipeChapterEditor';
import { TEAL, EstadoPill } from '@/lib/toolColors';

interface SesionRow { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulosCount: number }
interface CapituloRow { id: string; nombre: string; descripcion?: string; orden: number; estado: string; ideasCount: number; ideaThumbnails: string[]; pctAprobacion?: number }
interface ResultadoIdea { id: string; titulo: string; imagenUrl?: string; totalVotos: number; potencial: number; descarte: number; superLikes: number; pctPotencial: number; score: number; avgMsDecision?: number; quadrante?: SwipeQuadrante }
interface ResultadoCapitulo { capituloId: string; capituloNombre: string; totalParticipantesVotaron: number; ideas: ResultadoIdea[] }
interface Detalle { id: string; codigo: string; nombre: string; cliente?: string; estado: string; participantesCount: number; capitulos: CapituloRow[] }

/**
 * Dashboard del facilitador para el módulo Swipe: crear sesiones y
 * capítulos, y dentro de cada capítulo el editor de ideas
 * (SwipeChapterEditor) — reordenar, alta rápida, preview en vivo. Ver
 * resultados por capítulo o de la sesión completa, y proyectarlos.
 */
export default function SwipeDashboardPage({ proyectoId }: { proyectoId?: string } = {}) {
  const [sesiones, setSesiones] = useState<SesionRow[]>([]);
  const [loadingSesiones, setLoadingSesiones] = useState(true);
  const [selectedSesionId, setSelectedSesionId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [selectedCapituloId, setSelectedCapituloId] = useState<string | null>(null);
  const [resultados, setResultados] = useState<{ totalParticipantesVotaron: number; ideas: ResultadoIdea[] } | null>(null);

  const [newSesionOpen, setNewSesionOpen] = useState(false);
  const [newSesionNombre, setNewSesionNombre] = useState('');
  const [newSesionCliente, setNewSesionCliente] = useState('');
  const [creatingSesion, setCreatingSesion] = useState(false);

  const [sesionToDelete, setSesionToDelete] = useState<SesionRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingSesion, setDeletingSesion] = useState(false);

  const [projectionCapitulos, setProjectionCapitulos] = useState<ResultadoCapitulo[] | null>(null);
  const [loadingResultadosSesion, setLoadingResultadosSesion] = useState(false);

  const [newCapOpen, setNewCapOpen] = useState(false);
  const [newCapNombre, setNewCapNombre] = useState('');
  const [newCapDescripcion, setNewCapDescripcion] = useState('');
  const [creatingCap, setCreatingCap] = useState(false);

  const [capituloToDelete, setCapituloToDelete] = useState<CapituloRow | null>(null);
  const [deletingCapitulo, setDeletingCapitulo] = useState(false);
  const [duplicatingCapituloId, setDuplicatingCapituloId] = useState<string | null>(null);

  const loadSesiones = async () => {
    setLoadingSesiones(true);
    try {
      const res = await getSwipeSesiones({ proyectoId });
      setSesiones(res.sesiones ?? []);
    } finally {
      setLoadingSesiones(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSesiones(); }, [proyectoId]);

  const loadDetalle = async (sesionId: string) => {
    const res = await getSwipeSesionDetail({ sesionId });
    if (res.found) {
      setDetalle({
        id: res.id, codigo: res.codigo, nombre: res.nombre, cliente: res.cliente, estado: res.estado,
        participantesCount: res.participantesCount ?? 0, capitulos: res.capitulos ?? [],
      });
    }
  };

  useEffect(() => {
    if (selectedSesionId) loadDetalle(selectedSesionId);
    else setDetalle(null);
  }, [selectedSesionId]);

  useEffect(() => {
    setResultados(null);
  }, [selectedCapituloId]);

  // Refresca resultados mientras el capítulo seleccionado siga abierto —
  // simple polling, no Realtime (ver plan: no hay hook genérico reusable
  // para una tabla nueva sin construir uno de cero).
  useEffect(() => {
    if (!selectedCapituloId) return;
    const cap = detalle?.capitulos.find((c) => c.id === selectedCapituloId);
    const load = () => getSwipeResultados({ capituloId: selectedCapituloId }).then(setResultados);
    load();
    if (cap?.estado !== 'abierto') return;
    const interval = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5000);
    return () => clearInterval(interval);
  }, [selectedCapituloId, detalle]);

  const handleCreateSesion = async () => {
    if (!newSesionNombre.trim()) return;
    setCreatingSesion(true);
    try {
      await createSwipeSesion({ nombre: newSesionNombre.trim(), cliente: newSesionCliente.trim() || undefined, proyectoId });
      setNewSesionOpen(false);
      setNewSesionNombre('');
      setNewSesionCliente('');
      await loadSesiones();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo crear la sesión.');
    }
    setCreatingSesion(false);
  };

  const handleDeleteSesion = async () => {
    if (!sesionToDelete || deleteConfirmText !== 'BORRAR') return;
    setDeletingSesion(true);
    try {
      await deleteSwipeSesion({ sesionId: sesionToDelete.id });
      if (selectedSesionId === sesionToDelete.id) setSelectedSesionId(null);
      setSesionToDelete(null);
      setDeleteConfirmText('');
      toast.success('Sesión eliminada');
      await loadSesiones();
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo eliminar la sesión.');
    }
    setDeletingSesion(false);
  };

  const handleCreateCapitulo = async () => {
    if (!newCapNombre.trim() || !selectedSesionId) return;
    setCreatingCap(true);
    try {
      await createSwipeCapitulo({ sesionId: selectedSesionId, nombre: newCapNombre.trim(), descripcion: newCapDescripcion.trim() || undefined });
      setNewCapOpen(false);
      setNewCapNombre('');
      setNewCapDescripcion('');
      await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo crear el capítulo.');
    }
    setCreatingCap(false);
  };

  const handleToggleCapituloEstado = async (cap: CapituloRow) => {
    const nuevoEstado = cap.estado === 'abierto' ? 'cerrado' : 'abierto';
    try {
      await setSwipeCapituloEstado({ capituloId: cap.id, estado: nuevoEstado });
      if (selectedSesionId) await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo cambiar el estado del capítulo.');
    }
  };

  const handleDuplicateCapitulo = async (cap: CapituloRow) => {
    setDuplicatingCapituloId(cap.id);
    try {
      await duplicateSwipeCapitulo({ capituloId: cap.id });
      toast.success('Capítulo duplicado');
      if (selectedSesionId) await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo duplicar el capítulo.');
    }
    setDuplicatingCapituloId(null);
  };

  const handleDeleteCapitulo = async () => {
    if (!capituloToDelete) return;
    setDeletingCapitulo(true);
    try {
      await deleteSwipeCapitulo({ capituloId: capituloToDelete.id });
      if (selectedCapituloId === capituloToDelete.id) setSelectedCapituloId(null);
      setCapituloToDelete(null);
      toast.success('Capítulo eliminado');
      if (selectedSesionId) await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo eliminar el capítulo.');
    }
    setDeletingCapitulo(false);
  };

  const copyLink = (codigo: string) => {
    const url = `${window.location.origin}/swipe/${codigo}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado'));
  };

  const handleVerResultadosTotales = async () => {
    if (!detalle) return;
    setLoadingResultadosSesion(true);
    try {
      const res = await getSwipeResultadosSesion({ sesionId: detalle.id });
      setProjectionCapitulos(res.capitulos ?? []);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudieron cargar los resultados.');
    }
    setLoadingResultadosSesion(false);
  };

  const ideasTotales = detalle?.capitulos.reduce((sum, c) => sum + c.ideasCount, 0) ?? 0;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Swipe</h1>
          <p className="text-sm text-muted-foreground">Descarte de ideas tipo Tinder para workshops.</p>
        </div>
        <Dialog open={newSesionOpen} onOpenChange={setNewSesionOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Nueva sesión</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nueva sesión de Swipe</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Nombre del workshop" value={newSesionNombre} onChange={(e) => setNewSesionNombre(e.target.value)} />
              <Input placeholder="Cliente (opcional)" value={newSesionCliente} onChange={(e) => setNewSesionCliente(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={handleCreateSesion} disabled={creatingSesion || !newSesionNombre.trim()}>
                {creatingSesion ? 'Creando…' : 'Crear'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          {loadingSesiones && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!loadingSesiones && sesiones.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay sesiones.</p>}
          {sesiones.map((s) => (
            <div
              key={s.id}
              onClick={() => { setSelectedSesionId(s.id); setSelectedCapituloId(null); }}
              className={`group flex cursor-pointer items-start justify-between gap-2 rounded-lg border p-3 transition-colors ${selectedSesionId === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{s.nombre}</p>
                {s.cliente && <p className="truncate text-xs text-muted-foreground">{s.cliente}</p>}
                <div className="mt-1.5 flex items-center gap-2">
                  <EstadoPill estado={s.estado} />
                  <span className="text-xs text-muted-foreground">{s.capitulosCount} capítulo{s.capitulosCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 flex-shrink-0 p-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); setSesionToDelete(s); }}
                aria-label="Eliminar sesión"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div>
          {!detalle && <p className="text-sm text-muted-foreground">Selecciona o crea una sesión.</p>}
          {detalle && (
            <div className="space-y-5">
              <div
                className="relative overflow-hidden rounded-2xl border p-5"
                style={{ backgroundColor: `color-mix(in srgb, ${TEAL} 6%, white)`, borderColor: `color-mix(in srgb, ${TEAL} 18%, white)` }}
              >
                <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: TEAL }} />
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl shadow-md" style={{ backgroundColor: TEAL }}>
                      <Check className="h-5 w-5 text-white" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] opacity-75" style={{ color: TEAL }}>Sapience · Swipe</p>
                      <h2 className="truncate text-xl font-bold" style={{ color: TEAL }}>{detalle.nombre}</h2>
                      {detalle.cliente && <p className="truncate text-[13px]" style={{ color: '#4d6a72' }}>{detalle.cliente}</p>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyLink(detalle.codigo)}>
                      <Copy className="h-3.5 w-3.5" /> Copiar link
                    </Button>
                    {detalle.capitulos.length > 0 && (
                      <Button size="sm" style={{ backgroundColor: TEAL, color: '#fff' }} className="hover:opacity-90" onClick={handleVerResultadosTotales} disabled={loadingResultadosSesion}>
                        <Maximize2 className="h-3.5 w-3.5" /> {loadingResultadosSesion ? 'Cargando…' : 'Resultados totales'}
                      </Button>
                    )}
                  </div>
                </div>
                <span
                  className="relative mt-2.5 inline-block rounded px-2 py-0.5 font-mono text-[11px]"
                  style={{ color: '#4d6a72', backgroundColor: 'rgba(255,255,255,0.6)' }}
                >
                  /swipe/{detalle.codigo}
                </span>
              </div>

              <div className="flex gap-6 px-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold" style={{ color: TEAL }}>{detalle.capitulos.length}</span>
                  <span className="text-xs text-muted-foreground">capítulo{detalle.capitulos.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold" style={{ color: TEAL }}>{detalle.participantesCount}</span>
                  <span className="text-xs text-muted-foreground">participante{detalle.participantesCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold" style={{ color: TEAL }}>{ideasTotales}</span>
                  <span className="text-xs text-muted-foreground">idea{ideasTotales !== 1 ? 's' : ''} totales</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Capítulos</h2>
                <Dialog open={newCapOpen} onOpenChange={setNewCapOpen}>
                  <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Capítulo</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Nuevo capítulo</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <Input placeholder="Nombre" value={newCapNombre} onChange={(e) => setNewCapNombre(e.target.value)} />
                      <Input placeholder="Descripción (opcional)" value={newCapDescripcion} onChange={(e) => setNewCapDescripcion(e.target.value)} />
                    </div>
                    <DialogFooter>
                      <Button onClick={handleCreateCapitulo} disabled={creatingCap || !newCapNombre.trim()}>
                        {creatingCap ? 'Creando…' : 'Crear'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2">
                {detalle.capitulos.length === 0 && <p className="text-sm text-muted-foreground">Sin capítulos todavía.</p>}
                {detalle.capitulos.map((cap) => (
                  <Card key={cap.id} className={selectedCapituloId === cap.id ? 'border-primary' : ''}>
                    <div className="flex items-center gap-3 p-3.5">
                      <div className="flex flex-shrink-0">
                        {cap.ideaThumbnails.length > 0 ? (
                          cap.ideaThumbnails.map((url, i) => (
                            <div
                              key={i}
                              className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-lg border-2 border-white bg-white shadow"
                              style={{ marginLeft: i === 0 ? 0 : -13 }}
                            >
                              <img src={url} alt="" className="h-full w-full object-cover" />
                            </div>
                          ))
                        ) : (
                          <div className="h-9 w-9 flex-shrink-0 rounded-lg bg-muted" />
                        )}
                      </div>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedCapituloId(selectedCapituloId === cap.id ? null : cap.id)}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{cap.nombre}</span>
                          <EstadoPill estado={cap.estado} />
                        </div>
                        <div className="mt-1 flex items-center gap-2.5">
                          <span className="text-xs text-muted-foreground">{cap.ideasCount} idea{cap.ideasCount !== 1 ? 's' : ''}</span>
                          {cap.pctAprobacion !== undefined && (
                            <>
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full" style={{ width: `${cap.pctAprobacion}%`, backgroundColor: TEAL }} />
                              </div>
                              <span className="text-xs font-medium text-muted-foreground">{cap.pctAprobacion}% aprobación</span>
                            </>
                          )}
                        </div>
                      </button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 flex-shrink-0 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleDuplicateCapitulo(cap)}
                        disabled={duplicatingCapituloId === cap.id}
                        aria-label="Duplicar capítulo"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 flex-shrink-0 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setCapituloToDelete(cap)}
                        aria-label="Eliminar capítulo"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="flex-shrink-0 hover:opacity-90"
                        style={{ backgroundColor: TEAL, color: '#fff' }}
                        onClick={() => handleToggleCapituloEstado(cap)}
                      >
                        {cap.estado === 'abierto' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {cap.estado === 'abierto' ? 'Cerrar' : 'Abrir'}
                      </Button>
                    </div>

                    {selectedCapituloId === cap.id && (
                      <CardContent className="space-y-5 border-t border-border pt-4">
                        <SwipeChapterEditor
                          capituloId={cap.id}
                          onIdeasChanged={() => selectedSesionId && loadDetalle(selectedSesionId)}
                        />

                        {resultados && (
                          <div className="space-y-2 border-t border-border pt-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-foreground">
                                Resultados · {resultados.totalParticipantesVotaron} participante{resultados.totalParticipantesVotaron !== 1 ? 's' : ''} {resultados.totalParticipantesVotaron !== 1 ? 'votaron' : 'votó'}
                              </h3>
                              <Button
                                size="sm" variant="outline"
                                onClick={() => setProjectionCapitulos([{
                                  capituloId: cap.id,
                                  capituloNombre: cap.nombre,
                                  totalParticipantesVotaron: resultados.totalParticipantesVotaron,
                                  ideas: resultados.ideas,
                                }])}
                              >
                                <Maximize2 className="h-3.5 w-3.5" /> Proyectar
                              </Button>
                            </div>
                            {resultados.ideas.map((idea) => (
                              <div key={idea.id} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium text-foreground">{idea.titulo}</span>
                                  <span className="flex items-center gap-2 text-muted-foreground">
                                    {idea.superLikes > 0 && (
                                      <span className="flex items-center gap-0.5 text-[#D4A017]">
                                        <Star className="h-3 w-3" fill="currentColor" /> {idea.superLikes}
                                      </span>
                                    )}
                                    {idea.pctPotencial}% · {idea.totalVotos} votos
                                  </span>
                                </div>
                                <Progress value={idea.pctPotencial} />
                                {idea.quadrante && (
                                  <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: QUADRANTE_META[idea.quadrante].color }}>
                                    {(() => { const Icon = QUADRANTE_META[idea.quadrante].icon; return <Icon className="h-3 w-3" />; })()}
                                    {QUADRANTE_META[idea.quadrante].label}
                                    {idea.avgMsDecision !== undefined && ` · ${(idea.avgMsDecision / 1000).toFixed(1)}s prom.`}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!sesionToDelete} onOpenChange={(open) => { if (!open) { setSesionToDelete(null); setDeleteConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Eliminar "{sesionToDelete?.nombre}"</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esto borra la sesión completa: sus capítulos, ideas, participantes y votos. No se puede deshacer.
          </p>
          <Input
            placeholder="Escribe BORRAR para confirmar"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={handleDeleteSesion}
              disabled={deletingSesion || deleteConfirmText !== 'BORRAR'}
            >
              {deletingSesion ? 'Eliminando…' : 'Eliminar sesión'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!capituloToDelete} onOpenChange={(open) => { if (!open) setCapituloToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{capituloToDelete?.nombre}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán sus {capituloToDelete?.ideasCount ?? 0} idea{capituloToDelete?.ideasCount !== 1 ? 's' : ''} y los votos que tenga. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCapitulo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCapitulo}
              disabled={deletingCapitulo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingCapitulo ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {projectionCapitulos && detalle && (
        <SwipeResultsProjection
          sesionNombre={detalle.nombre}
          cliente={detalle.cliente}
          capitulos={projectionCapitulos}
          onClose={() => setProjectionCapitulos(null)}
        />
      )}
    </div>
  );
}
