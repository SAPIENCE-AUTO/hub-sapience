import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getSwipeSesiones, createSwipeSesion, getSwipeSesionDetail, createSwipeCapitulo,
  getSwipeIdeas, createSwipeIdea, setSwipeCapituloEstado, getSwipeResultados,
} from 'zite-endpoints-sdk';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Plus } from 'lucide-react';

interface SesionRow { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulosCount: number }
interface CapituloRow { id: string; nombre: string; descripcion?: string; orden: number; estado: string; ideasCount: number }
interface IdeaRow { id: string; titulo: string; descripcion?: string; imagenUrl?: string; orden: number }
interface ResultadoIdea { id: string; titulo: string; imagenUrl?: string; totalVotos: number; potencial: number; descarte: number; pctPotencial: number }
interface Detalle { id: string; codigo: string; nombre: string; cliente?: string; estado: string; capitulos: CapituloRow[] }

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

  const [newCapOpen, setNewCapOpen] = useState(false);
  const [newCapNombre, setNewCapNombre] = useState('');
  const [newCapDescripcion, setNewCapDescripcion] = useState('');
  const [creatingCap, setCreatingCap] = useState(false);

  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const [newIdeaTitulo, setNewIdeaTitulo] = useState('');
  const [newIdeaDescripcion, setNewIdeaDescripcion] = useState('');
  const [newIdeaImagenUrl, setNewIdeaImagenUrl] = useState('');
  const [creatingIdea, setCreatingIdea] = useState(false);

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
    if (selectedCapituloId) { loadIdeas(selectedCapituloId); setResultados(null); }
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
            <button
              key={s.id}
              onClick={() => { setSelectedSesionId(s.id); setSelectedCapituloId(null); }}
              className={`block w-full rounded-lg border p-3 text-left transition-colors ${selectedSesionId === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}
            >
              <p className="font-semibold text-foreground">{s.nombre}</p>
              {s.cliente && <p className="text-xs text-muted-foreground">{s.cliente}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{s.capitulosCount} capítulo{s.capitulosCount !== 1 ? 's' : ''} · {s.estado}</p>
            </button>
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
                        <p className="text-xs text-muted-foreground">{cap.ideasCount} idea{cap.ideasCount !== 1 ? 's' : ''} · {cap.estado}</p>
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
                              <p className="font-medium text-foreground">{idea.titulo}</p>
                              {idea.descripcion && <p className="text-xs text-muted-foreground">{idea.descripcion}</p>}
                            </li>
                          ))}
                          {(ideasByCapitulo[cap.id] ?? []).length === 0 && (
                            <p className="text-sm text-muted-foreground">Sin ideas todavía.</p>
                          )}
                        </ul>

                        {resultados && (
                          <div className="space-y-2 border-t border-border pt-3">
                            <h3 className="text-sm font-semibold text-foreground">
                              Resultados · {resultados.totalParticipantesVotaron} participante{resultados.totalParticipantesVotaron !== 1 ? 's' : ''} {resultados.totalParticipantesVotaron !== 1 ? 'votaron' : 'votó'}
                            </h3>
                            {resultados.ideas.map((idea) => (
                              <div key={idea.id} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium text-foreground">{idea.titulo}</span>
                                  <span className="text-muted-foreground">{idea.pctPotencial}% · {idea.totalVotos} votos</span>
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
    </div>
  );
}
