import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getEjesSesiones, createEjesSesion, deleteEjesSesion, getEjesSesionDetail, createEjesTablero,
  setEjesTableroEstado, getEjesResultadosTablero, getEjesResultadosSesion,
} from 'zite-endpoints-sdk';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Plus, Trash2, Maximize2, Check, Play, Pause } from 'lucide-react';
import { TEAL, EstadoPill } from '@/lib/toolColors';
import EjesTableroEditor from '@/components/ejes/EjesTableroEditor';
import EjesQuadrantChart, { type EjesIdeaResultado } from '@/components/ejes/EjesQuadrantChart';
import EjesResultsProjection, { type ResultadoTablero } from '@/components/ejes/EjesResultsProjection';
import { useRealtimeEjes } from '@/hooks/useRealtimeEjes';

interface SesionRow { id: string; codigo: string; nombre: string; cliente?: string; estado: string; tablerosCount: number }
interface TableroRow {
  id: string; nombre: string; descripcion?: string; orden: number; estado: string;
  ejeXLabel: string; ejeYLabel: string; ideasCount: number; ideaThumbnails: string[]; evaluacionesCount: number;
}
interface Detalle { id: string; codigo: string; nombre: string; cliente?: string; estado: string; participantesCount: number; tableros: TableroRow[] }
interface ResultadosTablero {
  ejeXLabel: string; ejeXMin: number; ejeXMax: number;
  ejeYLabel: string; ejeYMin: number; ejeYMax: number;
  totalParticipantesEvaluaron: number;
  ideas: EjesIdeaResultado[];
  sinEvaluar: { id: string; titulo: string }[];
}

/**
 * Dashboard del facilitador para el módulo Ejes: crear sesiones y
 * tableros (cada uno con su propia configuración de 2 ejes), editor de
 * ideas (EjesTableroEditor), y el mapa de cuadrantes en vivo — a
 * diferencia de Swipe, este SÍ se actualiza solo (useRealtimeEjes vía
 * Ably) mientras el tablero está abierto, sin necesitar polling.
 */
export default function EjesDashboardPage({ proyectoId }: { proyectoId?: string } = {}) {
  const [sesiones, setSesiones] = useState<SesionRow[]>([]);
  const [loadingSesiones, setLoadingSesiones] = useState(true);
  const [selectedSesionId, setSelectedSesionId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [selectedTableroId, setSelectedTableroId] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadosTablero | null>(null);

  const [newSesionOpen, setNewSesionOpen] = useState(false);
  const [newSesionNombre, setNewSesionNombre] = useState('');
  const [newSesionCliente, setNewSesionCliente] = useState('');
  const [creatingSesion, setCreatingSesion] = useState(false);

  const [sesionToDelete, setSesionToDelete] = useState<SesionRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingSesion, setDeletingSesion] = useState(false);

  const [projectionTableros, setProjectionTableros] = useState<ResultadoTablero[] | null>(null);
  const [loadingResultadosSesion, setLoadingResultadosSesion] = useState(false);

  const [newTabOpen, setNewTabOpen] = useState(false);
  const [newTabNombre, setNewTabNombre] = useState('');
  const [newTabEjeXLabel, setNewTabEjeXLabel] = useState('Factibilidad');
  const [newTabEjeXMax, setNewTabEjeXMax] = useState('100');
  const [newTabEjeYLabel, setNewTabEjeYLabel] = useState('Impacto');
  const [newTabEjeYMax, setNewTabEjeYMax] = useState('100');
  const [newTabCuadAA, setNewTabCuadAA] = useState('');
  const [newTabCuadBA, setNewTabCuadBA] = useState('');
  const [newTabCuadBB, setNewTabCuadBB] = useState('');
  const [newTabCuadAB, setNewTabCuadAB] = useState('');
  const [creatingTab, setCreatingTab] = useState(false);

  const loadSesiones = async () => {
    setLoadingSesiones(true);
    try {
      const res = await getEjesSesiones({ proyectoId });
      setSesiones(res.sesiones ?? []);
    } finally {
      setLoadingSesiones(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSesiones(); }, [proyectoId]);

  const loadDetalle = async (sesionId: string) => {
    const res = await getEjesSesionDetail({ sesionId });
    if (res.found) {
      setDetalle({
        id: res.id, codigo: res.codigo, nombre: res.nombre, cliente: res.cliente, estado: res.estado,
        participantesCount: res.participantesCount ?? 0, tableros: res.tableros ?? [],
      });
    }
  };

  useEffect(() => {
    if (selectedSesionId) loadDetalle(selectedSesionId);
    else setDetalle(null);
  }, [selectedSesionId]);

  useEffect(() => { setResultados(null); }, [selectedTableroId]);

  const loadResultados = async (tableroId: string) => {
    const res = await getEjesResultadosTablero({ tableroId });
    setResultados(res);
  };

  useEffect(() => {
    if (selectedTableroId) loadResultados(selectedTableroId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableroId]);

  const tableroSeleccionado = detalle?.tableros.find((t) => t.id === selectedTableroId);

  // Mapa en vivo — a diferencia de Swipe (polling), aquí sí es push real
  // vía Ably: se refresca solo cuando llega una evaluación nueva.
  useRealtimeEjes({
    tableroId: selectedTableroId ?? undefined,
    enabled: tableroSeleccionado?.estado === 'abierto',
    onEvaluacionNueva: () => { if (selectedTableroId) loadResultados(selectedTableroId); },
  });

  const handleCreateSesion = async () => {
    if (!newSesionNombre.trim()) return;
    setCreatingSesion(true);
    try {
      await createEjesSesion({ nombre: newSesionNombre.trim(), cliente: newSesionCliente.trim() || undefined, proyectoId });
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
      await deleteEjesSesion({ sesionId: sesionToDelete.id });
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

  const resetNewTabForm = () => {
    setNewTabNombre('');
    setNewTabEjeXLabel('Factibilidad'); setNewTabEjeXMax('100');
    setNewTabEjeYLabel('Impacto'); setNewTabEjeYMax('100');
    setNewTabCuadAA(''); setNewTabCuadBA(''); setNewTabCuadBB(''); setNewTabCuadAB('');
  };

  const handleCreateTablero = async () => {
    if (!newTabNombre.trim() || !selectedSesionId) return;
    setCreatingTab(true);
    try {
      await createEjesTablero({
        sesionId: selectedSesionId,
        nombre: newTabNombre.trim(),
        ejeXLabel: newTabEjeXLabel.trim() || 'Eje X',
        ejeXMin: 0, ejeXMax: Number(newTabEjeXMax) || 100,
        ejeYLabel: newTabEjeYLabel.trim() || 'Eje Y',
        ejeYMin: 0, ejeYMax: Number(newTabEjeYMax) || 100,
        cuadranteAltoAltoLabel: newTabCuadAA.trim() || undefined,
        cuadranteBajoAltoLabel: newTabCuadBA.trim() || undefined,
        cuadranteBajoBajoLabel: newTabCuadBB.trim() || undefined,
        cuadranteAltoBajoLabel: newTabCuadAB.trim() || undefined,
      });
      setNewTabOpen(false);
      resetNewTabForm();
      await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo crear el tablero.');
    }
    setCreatingTab(false);
  };

  const handleToggleTableroEstado = async (tab: TableroRow) => {
    const nuevoEstado = tab.estado === 'abierto' ? 'cerrado' : 'abierto';
    try {
      await setEjesTableroEstado({ tableroId: tab.id, estado: nuevoEstado });
      if (selectedSesionId) await loadDetalle(selectedSesionId);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudo cambiar el estado del tablero.');
    }
  };

  const copyLink = (codigo: string) => {
    const url = `${window.location.origin}/ejes/${codigo}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Link copiado'));
  };

  const handleVerResultadosTotales = async () => {
    if (!detalle) return;
    setLoadingResultadosSesion(true);
    try {
      const res = await getEjesResultadosSesion({ sesionId: detalle.id });
      setProjectionTableros(res.tableros ?? []);
    } catch (err) {
      toast.error((err as Error)?.message || 'No se pudieron cargar los resultados.');
    }
    setLoadingResultadosSesion(false);
  };

  const ideasTotales = detalle?.tableros.reduce((sum, t) => sum + t.ideasCount, 0) ?? 0;

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ejes</h1>
          <p className="text-sm text-muted-foreground">Mapeo de ideas en 2 ejes, con mapa de cuadrantes en vivo.</p>
        </div>
        <Dialog open={newSesionOpen} onOpenChange={setNewSesionOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Nueva sesión</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nueva sesión de Ejes</DialogTitle></DialogHeader>
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
              onClick={() => { setSelectedSesionId(s.id); setSelectedTableroId(null); }}
              className={`group flex cursor-pointer items-start justify-between gap-2 rounded-lg border p-3 transition-colors ${selectedSesionId === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{s.nombre}</p>
                {s.cliente && <p className="truncate text-xs text-muted-foreground">{s.cliente}</p>}
                <div className="mt-1.5 flex items-center gap-2">
                  <EstadoPill estado={s.estado} />
                  <span className="text-xs text-muted-foreground">{s.tablerosCount} tablero{s.tablerosCount !== 1 ? 's' : ''}</span>
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
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] opacity-75" style={{ color: TEAL }}>Sapience · Ejes</p>
                      <h2 className="truncate text-xl font-bold" style={{ color: TEAL }}>{detalle.nombre}</h2>
                      {detalle.cliente && <p className="truncate text-[13px]" style={{ color: '#4d6a72' }}>{detalle.cliente}</p>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyLink(detalle.codigo)}>
                      <Copy className="h-3.5 w-3.5" /> Copiar link
                    </Button>
                    {detalle.tableros.length > 0 && (
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
                  /ejes/{detalle.codigo}
                </span>
              </div>

              <div className="flex gap-6 px-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold" style={{ color: TEAL }}>{detalle.tableros.length}</span>
                  <span className="text-xs text-muted-foreground">tablero{detalle.tableros.length !== 1 ? 's' : ''}</span>
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
                <h2 className="font-semibold text-foreground">Tableros</h2>
                <Dialog open={newTabOpen} onOpenChange={(open) => { setNewTabOpen(open); if (!open) resetNewTabForm(); }}>
                  <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> Tablero</Button></DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader><DialogTitle>Nuevo tablero</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <Input placeholder="Nombre del tablero" value={newTabNombre} onChange={(e) => setNewTabNombre(e.target.value)} />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Eje X (0 a...)</label>
                          <Input placeholder="Label, ej. Factibilidad" value={newTabEjeXLabel} onChange={(e) => setNewTabEjeXLabel(e.target.value)} />
                          <Input type="number" placeholder="Máximo" value={newTabEjeXMax} onChange={(e) => setNewTabEjeXMax(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-muted-foreground">Eje Y (0 a...)</label>
                          <Input placeholder="Label, ej. Impacto" value={newTabEjeYLabel} onChange={(e) => setNewTabEjeYLabel(e.target.value)} />
                          <Input type="number" placeholder="Máximo" value={newTabEjeYMax} onChange={(e) => setNewTabEjeYMax(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Nombres de cuadrante (opcional)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <Input placeholder="↖ X bajo, Y alto" value={newTabCuadBA} onChange={(e) => setNewTabCuadBA(e.target.value)} />
                          <Input placeholder="↗ X alto, Y alto" value={newTabCuadAA} onChange={(e) => setNewTabCuadAA(e.target.value)} />
                          <Input placeholder="↙ X bajo, Y bajo" value={newTabCuadBB} onChange={(e) => setNewTabCuadBB(e.target.value)} />
                          <Input placeholder="↘ X alto, Y bajo" value={newTabCuadAB} onChange={(e) => setNewTabCuadAB(e.target.value)} />
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleCreateTablero} disabled={creatingTab || !newTabNombre.trim()}>
                        {creatingTab ? 'Creando…' : 'Crear'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2">
                {detalle.tableros.length === 0 && <p className="text-sm text-muted-foreground">Sin tableros todavía.</p>}
                {detalle.tableros.map((tab) => (
                  <Card key={tab.id} className={selectedTableroId === tab.id ? 'border-primary' : ''}>
                    <div className="flex items-center gap-3 p-3.5">
                      <div className="flex flex-shrink-0">
                        {tab.ideaThumbnails.length > 0 ? (
                          tab.ideaThumbnails.map((url, i) => (
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
                      <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedTableroId(selectedTableroId === tab.id ? null : tab.id)}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{tab.nombre}</span>
                          <EstadoPill estado={tab.estado} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tab.ideasCount} idea{tab.ideasCount !== 1 ? 's' : ''} · {tab.ejeXLabel} × {tab.ejeYLabel} · {tab.evaluacionesCount} evaluación{tab.evaluacionesCount !== 1 ? 'es' : ''}
                        </p>
                      </button>
                      <Button
                        size="sm"
                        className="flex-shrink-0 hover:opacity-90"
                        style={{ backgroundColor: TEAL, color: '#fff' }}
                        onClick={() => handleToggleTableroEstado(tab)}
                      >
                        {tab.estado === 'abierto' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {tab.estado === 'abierto' ? 'Cerrar' : 'Abrir'}
                      </Button>
                    </div>

                    {selectedTableroId === tab.id && (
                      <CardContent className="space-y-5 border-t border-border pt-4">
                        <EjesTableroEditor
                          tableroId={tab.id}
                          onIdeasChanged={() => selectedSesionId && loadDetalle(selectedSesionId)}
                        />

                        {resultados && (
                          <div className="space-y-3 border-t border-border pt-4">
                            <div className="flex items-center justify-between">
                              <h3 className="text-sm font-semibold text-foreground">
                                Mapa de cuadrantes · {resultados.totalParticipantesEvaluaron} participante{resultados.totalParticipantesEvaluaron !== 1 ? 's' : ''} evaluó{resultados.totalParticipantesEvaluaron !== 1 ? 'aron' : ''}
                              </h3>
                              <Button
                                size="sm" variant="outline"
                                onClick={() => setProjectionTableros([{
                                  tableroId: tab.id,
                                  tableroNombre: tab.nombre,
                                  ejeXLabel: resultados.ejeXLabel, ejeXMin: resultados.ejeXMin, ejeXMax: resultados.ejeXMax,
                                  ejeYLabel: resultados.ejeYLabel, ejeYMin: resultados.ejeYMin, ejeYMax: resultados.ejeYMax,
                                  totalParticipantesEvaluaron: resultados.totalParticipantesEvaluaron,
                                  ideas: resultados.ideas,
                                }])}
                              >
                                <Maximize2 className="h-3.5 w-3.5" /> Proyectar
                              </Button>
                            </div>
                            {resultados.ideas.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Todavía no hay evaluaciones.</p>
                            ) : (
                              <EjesQuadrantChart
                                ejeXLabel={resultados.ejeXLabel} ejeXMin={resultados.ejeXMin} ejeXMax={resultados.ejeXMax}
                                ejeYLabel={resultados.ejeYLabel} ejeYMin={resultados.ejeYMin} ejeYMax={resultados.ejeYMax}
                                ideas={resultados.ideas}
                                dotColor={TEAL}
                              />
                            )}
                            {resultados.sinEvaluar.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Sin evaluar todavía: {resultados.sinEvaluar.map((i) => i.titulo).join(', ')}
                              </p>
                            )}
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
            Esto borra la sesión completa: sus tableros, ideas, participantes y evaluaciones. No se puede deshacer.
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

      {projectionTableros && detalle && (
        <EjesResultsProjection
          sesionNombre={detalle.nombre}
          cliente={detalle.cliente}
          tableros={projectionTableros}
          onClose={() => setProjectionTableros(null)}
        />
      )}
    </div>
  );
}
