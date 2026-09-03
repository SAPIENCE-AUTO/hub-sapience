import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSwipeSesiones, createSwipeSesion, deleteSwipeSesion, getSwipeSesionDetail, createSwipeCapitulo,
  setSwipeCapituloEstado, getSwipeResultados, getSwipeResultadosSesion,
} from 'zite-endpoints-sdk';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Plus, Star, Trash2, Maximize2 } from 'lucide-react';
import SwipeResultsProjection, { QUADRANTE_META, type SwipeQuadrante } from '@/components/swipe/SwipeResultsProjection';
import SwipeChapterEditor from '@/components/swipe/SwipeChapterEditor';

interface SesionRow { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulosCount: number }
interface CapituloRow { id: string; nombre: string; descripcion?: string; orden: number; estado: string; ideasCount: number }
interface ResultadoIdea { id: string; titulo: string; imagenUrl?: string; totalVotos: number; potencial: number; descarte: number; superLikes: number; pctPotencial: number; score: number; avgMsDecision?: number; quadrante?: SwipeQuadrante }
interface ResultadoCapitulo { capituloId: string; capituloNombre: string; totalParticipantesVotaron: number; ideas: ResultadoIdea[] }
interface Detalle { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulos: CapituloRow[] }

// Pills de estado — mismo patrón del moodboard de look & feel del Hub (dot +
// pastilla de color sólido). "Éxito"/gris reusan el enfoque de las pills
// existentes; verde y azul son aproximaciones cercanas a los swatches del
// moodboard (info/éxito) porque todavía no existen como tokens globales de
// Tailwind — no se tocó tailwind.config.ts/index.css desde este módulo.
const ESTADO_PILL: Record<string, string> = {
  activa: 'bg-[#16A34A] text-white',
  abierto: 'bg-[#16A34A] text-white',
  borrador: 'bg-secondary text-secondary-foreground',
  bloqueado: 'bg-secondary text-secondary-foreground',
  cerrada: 'bg-muted text-muted-foreground',
  cerrado: 'bg-muted text-muted-foreground',
};

function EstadoPill({ estado }: { estado: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ESTADO_PILL[estado] ?? 'bg-muted text-muted-foreground'}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {estado}
    </span>
  );
}

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
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>{detalle.nombre}</CardTitle>
                    <p className="text-xs text-muted-foreground">/swipe/{detalle.codigo}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyLink(detalle.codigo)}>
                      <Copy className="h-3.5 w-3.5" /> Copiar link
                    </Button>
                    {detalle.capitulos.length > 0 && (
                      <Button size="sm" onClick={handleVerResultadosTotales} disabled={loadingResultadosSesion}>
                        <Maximize2 className="h-3.5 w-3.5" /> {loadingResultadosSesion ? 'Cargando…' : 'Resultados totales'}
                      </Button>
                    )}
                  </div>
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
                      <button className="text-left" onClick={() => setSelectedCapituloId(selectedCapituloId === cap.id ? null : cap.id)}>
                        <p className="font-medium text-foreground">{cap.nombre}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <EstadoPill estado={cap.estado} />
                          <span className="text-xs text-muted-foreground">{cap.ideasCount} idea{cap.ideasCount !== 1 ? 's' : ''}</span>
                        </div>
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
                      <CardContent className="space-y-5 pt-0">
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
