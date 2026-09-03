import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSwipeSesiones, createSwipeSesion, deleteSwipeSesion, getSwipeSesionDetail, createSwipeCapitulo,
  getSwipeIdeas, createSwipeIdea, updateSwipeIdea, getSwipeVotosDeIdea, setSwipeCapituloEstado, getSwipeResultados,
} from 'zite-endpoints-sdk';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Plus, Star, Heart, X, Trash2, Pencil, Users, Maximize2 } from 'lucide-react';
import SwipeResultsProjection from '@/components/swipe/SwipeResultsProjection';

interface SesionRow { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulosCount: number }
interface CapituloRow { id: string; nombre: string; descripcion?: string; orden: number; estado: string; ideasCount: number }
interface IdeaRow { id: string; titulo: string; descripcion?: string; imagenUrl?: string; orden: number; tieneVotos: boolean }
interface ResultadoIdea { id: string; titulo: string; imagenUrl?: string; totalVotos: number; potencial: number; descarte: number; superLikes: number; pctPotencial: number; score: number }
interface Detalle { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulos: CapituloRow[] }
interface VotoRow { alias: string; valor: string; msDecision?: number; createdAt: string }

const VALOR_ICON: Record<string, React.ComponentType<{ className?: string }>> = { potencial: Heart, descarte: X, super: Star };
const VALOR_COLOR: Record<string, string> = { potencial: '#1F9D6F', descarte: '#C4302B', super: '#D4A017' };
const ESTADO_DOT: Record<string, string> = {
  activa: '#1F9D6F', abierto: '#1F9D6F',
  borrador: '#8FA0A6', bloqueado: '#8FA0A6',
  cerrada: '#6E8388', cerrado: '#6E8388',
};

/**
 * Dashboard del facilitador para el módulo Swipe — Fase 1: crear sesiones y
 * capítulos, dar de alta ideas una por una, abrir/cerrar capítulos y ver un
 * ranking simple. Sin CSV bulk, sin export XLSX, sin Realtime — eso queda
 * para fases posteriores (ver plan del módulo).
 */
export default function SwipeDashboardPage({ proyectoId }: { proyectoId?: string } = {}) {
  const [sesiones, setSesiones] = useState<SesionRow[]>([]);
  const [loadingSesiones, setLoadingSesiones] = useState(true);
  const [selectedSesionId, setSelectedSesionId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [selectedCapituloId, setSelectedCapituloId] = useState<string | null>(null);
  const [ideasByCapitulo, setIdeasByCapitulo] = useState<Record<string, IdeaRow[]>>({});
  const [resultados, setResultados] = useState<{ totalParticipantesVotaron: number; ideas: ResultadoIdea[] } | null>(null);

  const [newSesionOpen, setNewSesionOpen] = useState(false);
  const [newSesionNombre, setNewSesionNombre] = useState('');
  const [newSesionCliente, setNewSesionCliente] = useState('');
  const [creatingSesion, setCreatingSesion] = useState(false);

  const [sesionToDelete, setSesionToDelete] = useState<SesionRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingSesion, setDeletingSesion] = useState(false);

  const [projectionOpen, setProjectionOpen] = useState(false);

  const [newCapOpen, setNewCapOpen] = useState(false);
  const [newCapNombre, setNewCapNombre] = useState('');
  const [newCapDescripcion, setNewCapDescripcion] = useState('');
  const [creatingCap, setCreatingCap] = useState(false);

  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const [newIdeaTitulo, setNewIdeaTitulo] = useState('');
  const [newIdeaDescripcion, setNewIdeaDescripcion] = useState('');
  const [newIdeaImagenUrl, setNewIdeaImagenUrl] = useState('');
  const [creatingIdea, setCreatingIdea] = useState(false);

  const [editingIdea, setEditingIdea] = useState<IdeaRow | null>(null);
  const [editTitulo, setEditTitulo] = useState('');
  const [editDescripcion, setEditDescripcion] = useState('');
  const [editImagenUrl, setEditImagenUrl] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [expandedVotosIdeaId, setExpandedVotosIdeaId] = useState<string | null>(null);
  const [votosByIdea, setVotosByIdea] = useState<Record<string, VotoRow[]>>({});
  const [loadingVotos, setLoadingVotos] = useState(false);

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
      setDetalle({ id: res.id, codigo: res.codigo, nombre: res.nombre, cliente: res.cliente, estado: res.estado, capitulos: res.capitulos ?? [] });
    }
  };

  useEffect(() => {
    if (selectedSesionId) loadDetalle(selectedSesionId);
    else setDetalle(null);
  }, [selectedSesionId]);

  const loadIdeas = async (capituloId: string) => {
    const res = await getSwipeIdeas({ capituloId });
    setIdeasByCapitulo((prev) => ({ ...prev, [capituloId]: res.ideas ?? [] }));
  };

  useEffect(() => {
    if (selectedCapituloId) { loadIdeas(selectedCapituloId); setResultados(null); setExpandedVotosIdeaId(null); }
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

  const handleCreateIdea = async () => {
    if (!newIdeaTitulo.trim() || !selectedCapituloId) return;
    setCreatingIdea(true);
    try {
      await createSwipeIdea({
        capituloId: selectedCapituloId,
        titulo: newIdeaTitulo.trim(),
        descripcion: newIdeaDescripcion.trim() || undefined,
        imagenUrl: newIdeaImagenUrl.trim() || undefined,
      });
      setNewIdeaOpen(false);
      setNewIdeaTitulo('');
      setNewIdeaDescripcion('');
      setNewIdeaImagenUrl('');
      await loadIdeas(selectedCapituloId);
      if (selectedSesionId) await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo agregar la idea.');
    }
    setCreatingIdea(false);
  };

  const openEditIdea = (idea: IdeaRow) => {
    setEditingIdea(idea);
    setEditTitulo(idea.titulo);
    setEditDescripcion(idea.descripcion ?? '');
    setEditImagenUrl(idea.imagenUrl ?? '');
  };

  const handleSaveEditIdea = async () => {
    if (!editingIdea || !editTitulo.trim() || !selectedCapituloId) return;
    setSavingEdit(true);
    try {
      await updateSwipeIdea({
        ideaId: editingIdea.id,
        titulo: editTitulo.trim(),
        descripcion: editDescripcion.trim() || undefined,
        imagenUrl: editImagenUrl.trim() || undefined,
      });
      setEditingIdea(null);
      await loadIdeas(selectedCapituloId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo editar la idea.');
    }
    setSavingEdit(false);
  };

  const toggleVotos = async (ideaId: string) => {
    if (expandedVotosIdeaId === ideaId) { setExpandedVotosIdeaId(null); return; }
    setExpandedVotosIdeaId(ideaId);
    if (!votosByIdea[ideaId]) {
      setLoadingVotos(true);
      try {
        const res = await getSwipeVotosDeIdea({ ideaId });
        setVotosByIdea((prev) => ({ ...prev, [ideaId]: res.votos ?? [] }));
      } finally {
        setLoadingVotos(false);
      }
    }
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

  const copyLink = (codigo: string) => {
    const url = `${window.location.origin}/swipe/${codigo}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado'));
  };

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
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ESTADO_DOT[s.estado] ?? '#8FA0A6' }} />
                  {s.capitulosCount} capítulo{s.capitulosCount !== 1 ? 's' : ''} · {s.estado}
                </p>
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
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>{detalle.nombre}</CardTitle>
                    <p className="text-xs text-muted-foreground">/swipe/{detalle.codigo}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copyLink(detalle.codigo)}>
                    <Copy className="h-3.5 w-3.5" /> Copiar link
                  </Button>
                </CardHeader>
              </Card>

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
                    <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
                      <button className="text-left" onClick={() => setSelectedCapituloId(cap.id)}>
                        <p className="font-medium text-foreground">{cap.nombre}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ESTADO_DOT[cap.estado] ?? '#8FA0A6' }} />
                          {cap.ideasCount} idea{cap.ideasCount !== 1 ? 's' : ''} · {cap.estado}
                        </p>
                      </button>
                      <Button
                        size="sm"
                        variant={cap.estado === 'abierto' ? 'secondary' : 'default'}
                        onClick={() => handleToggleCapituloEstado(cap)}
                      >
                        {cap.estado === 'abierto' ? 'Cerrar' : 'Abrir'}
                      </Button>
                    </CardHeader>

                    {selectedCapituloId === cap.id && (
                      <CardContent className="space-y-4 pt-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-foreground">Ideas</h3>
                          <Dialog open={newIdeaOpen} onOpenChange={setNewIdeaOpen}>
                            <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Idea</Button></DialogTrigger>
                            <DialogContent>
                              <DialogHeader><DialogTitle>Nueva idea</DialogTitle></DialogHeader>
                              <div className="space-y-3">
                                <Input placeholder="Título (máx. 60 caracteres)" maxLength={60} value={newIdeaTitulo} onChange={(e) => setNewIdeaTitulo(e.target.value)} />
                                <Input placeholder="Descripción (máx. 180 caracteres)" maxLength={180} value={newIdeaDescripcion} onChange={(e) => setNewIdeaDescripcion(e.target.value)} />
                                <Input placeholder="URL de imagen (opcional)" value={newIdeaImagenUrl} onChange={(e) => setNewIdeaImagenUrl(e.target.value)} />
                              </div>
                              <DialogFooter>
                                <Button onClick={handleCreateIdea} disabled={creatingIdea || !newIdeaTitulo.trim()}>
                                  {creatingIdea ? 'Agregando…' : 'Agregar'}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </div>

                        <ul className="space-y-1.5">
                          {(ideasByCapitulo[cap.id] ?? []).map((idea) => (
                            <li key={idea.id} className="rounded-md border border-border px-3 py-2 text-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex min-w-0 gap-2.5">
                                  {idea.imagenUrl ? (
                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                                      <img src={idea.imagenUrl} alt="" className="max-h-full max-w-full object-contain" />
                                    </div>
                                  ) : (
                                    <div className="h-10 w-10 flex-shrink-0 rounded-md bg-muted" />
                                  )}
                                  <div className="min-w-0">
                                    <p className="font-medium text-foreground">{idea.titulo}</p>
                                    {idea.descripcion && <p className="text-xs text-muted-foreground">{idea.descripcion}</p>}
                                  </div>
                                </div>
                                <div className="flex flex-shrink-0 gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggleVotos(idea.id)}>
                                    <Users className="h-3.5 w-3.5" />
                                  </Button>
                                  {!idea.tieneVotos && (
                                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEditIdea(idea)}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {expandedVotosIdeaId === idea.id && (
                                <div className="mt-2 space-y-1 border-t border-border pt-2">
                                  {loadingVotos && !votosByIdea[idea.id] && (
                                    <p className="text-xs text-muted-foreground">Cargando…</p>
                                  )}
                                  {votosByIdea[idea.id]?.length === 0 && (
                                    <p className="text-xs text-muted-foreground">Nadie ha votado esta idea todavía.</p>
                                  )}
                                  {(votosByIdea[idea.id] ?? []).map((voto, i) => {
                                    const Icon = VALOR_ICON[voto.valor] ?? Heart;
                                    return (
                                      <div key={i} className="flex items-center justify-between text-xs">
                                        <span className="text-foreground">{voto.alias}</span>
                                        <span className="flex items-center gap-1" style={{ color: VALOR_COLOR[voto.valor] }}>
                                          <Icon className="h-3 w-3" fill="currentColor" /> {voto.valor}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </li>
                          ))}
                          {(ideasByCapitulo[cap.id] ?? []).length === 0 && (
                            <p className="text-sm text-muted-foreground">Sin ideas todavía.</p>
                          )}
                        </ul>

                        {resultados && (
                          <div className="space-y-2 border-t border-border pt-3">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-foreground">
                                Resultados · {resultados.totalParticipantesVotaron} participante{resultados.totalParticipantesVotaron !== 1 ? 's' : ''} {resultados.totalParticipantesVotaron !== 1 ? 'votaron' : 'votó'}
                              </h3>
                              <Button size="sm" variant="outline" onClick={() => setProjectionOpen(true)}>
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

      <Dialog open={!!editingIdea} onOpenChange={(open) => { if (!open) setEditingIdea(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar idea</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Título (máx. 60 caracteres)" maxLength={60} value={editTitulo} onChange={(e) => setEditTitulo(e.target.value)} />
            <Input placeholder="Descripción (máx. 180 caracteres)" maxLength={180} value={editDescripcion} onChange={(e) => setEditDescripcion(e.target.value)} />
            <Input placeholder="URL de imagen (opcional)" value={editImagenUrl} onChange={(e) => setEditImagenUrl(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={handleSaveEditIdea} disabled={savingEdit || !editTitulo.trim()}>
              {savingEdit ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {projectionOpen && resultados && detalle && (
        <SwipeResultsProjection
          sesionNombre={detalle.nombre}
          cliente={detalle.cliente}
          capituloNombre={detalle.capitulos.find((c) => c.id === selectedCapituloId)?.nombre ?? ''}
          totalParticipantesVotaron={resultados.totalParticipantesVotaron}
          ideas={resultados.ideas}
          onClose={() => setProjectionOpen(false)}
        />
      )}
    </div>
  );
}
