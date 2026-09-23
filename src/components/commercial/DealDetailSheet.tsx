import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { saveDeal, approveSelectedCotizaciones, getProjectForDeal, linkProjectDeal, GetDealsOutputType } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { CheckCircle2, Link2 } from 'lucide-react';
import { PHASES, PHASE_COLOR_MAP } from './dealUtils';
import DealGeneralTab from './DealGeneralTab';
import CotizacionesTab from './CotizacionesTab';
import DocumentosTab from './DocumentosTab';
import ResumenTab from './ResumenTab';
import BriefEditor from './BriefEditor';
import ApprovalReviewDialog from './ApprovalReviewDialog';

type Deal = GetDealsOutputType['deals'][0];

const PHASE_KEYS = PHASES.map(p => p.key);

interface Props {
  deal: Deal;
  isOpen: boolean;
  onClose: () => void;
  onDealUpdated: (deal: Deal) => void;
  onDeleted: () => void;
  existingClients?: string[];
}

export default function DealDetailSheet({ deal, isOpen, onClose, onDealUpdated, onDeleted, existingClients }: Props) {
  const [localDeal, setLocalDeal] = useState<Deal>(deal);
  const [approvalReviewOpen, setApprovalReviewOpen] = useState(false);
  const [phaseSelectOpen, setPhaseSelectOpen] = useState(false);
  // Al pasar a "Ganado" por aquí (dropdown del header, ej. arrastrando en el
  // kanban o eligiéndolo directo) — a diferencia del botón "Aprobar Deal" de
  // arriba, que ya crea el proyecto — se ofrece aprobar de una vez las
  // cotizaciones marcadas "Incluida", igual que hacía este mismo diálogo
  // cuando vivía dentro de DealGeneralTab.
  const [pendingApprove, setPendingApprove] = useState<{ dealId: string } | null>(null);
  const [approvingCotizaciones, setApprovingCotizaciones] = useState(false);
  const isNew = !deal.id;
  const phaseColor = PHASE_COLOR_MAP[localDeal.phase ?? ''] ?? 'hsl(var(--muted-foreground))';

  // "¿Ya tiene proyecto?" — vive aquí (no en DealGeneralTab) para que el
  // botón "Aprobar Deal" quede en el header, visible sin importar en qué tab
  // estés (mismo razonamiento que ya llevó el badge de fase para acá). Deals
  // no tiene columna de vuelta hacia Projects, así que hay que preguntarle a
  // Projects directamente (ver getProjectForDeal.ts). checkingProject evita
  // mostrar el botón de más mientras se resuelve — mostrarlo de más, aunque
  // sea un instante, es el hueco que antes generaba proyectos duplicados.
  const [linkedProject, setLinkedProject] = useState<{ id: string; projectCode?: string } | null>(null);
  // 'linked' = vínculo formal (Projects.dealVinculado, ver linkProjectDeal.ts).
  // 'candidate' = encontramos un proyecto con el mismo nombre pero SIN
  // vincular todavía — pasa cuando el proyecto ya existía de antes (creado a
  // mano, sin pasar por "Aprobar Deal"). undefined = sin ningún match.
  const [matchType, setMatchType] = useState<'linked' | 'candidate' | undefined>(undefined);
  const [checkingProject, setCheckingProject] = useState(true);
  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false);
  // Si dicen "no, es otro proyecto" no hay que seguir insistiendo con la
  // misma sugerencia en esta sesión — se resetea al abrir un deal distinto.
  const [candidateDismissed, setCandidateDismissed] = useState(false);
  const [linkingCandidate, setLinkingCandidate] = useState(false);
  // El botón "Aprobar Deal" (crea un proyecto nuevo) cubre los dos casos que
  // antes eran dos flujos separados (el banner "Listo para aprobar" antes de
  // Ganado, y el fallback "Crear Proyecto" para cuando ya estaba Ganado pero
  // sin proyecto) — pero solo tiene sentido mostrarlo cuando de verdad no hay
  // ya un proyecto correspondiente: ni vinculado, ni un candidato sin
  // resolver (mientras esté sin resolver, se fuerza a decidir esa sugerencia
  // primero, para no terminar creando un duplicado por accidente).
  const canApprove = !!localDeal.id && !checkingProject && (!linkedProject || (matchType === 'candidate' && candidateDismissed));

  // Sync when parent deal changes (e.g. new deal opened)
  useEffect(() => { setLocalDeal(deal); }, [deal]);

  useEffect(() => {
    setCandidateDismissed(false);
    if (!localDeal.id) { setLinkedProject(null); setMatchType(undefined); setCheckingProject(false); return; }
    setCheckingProject(true);
    getProjectForDeal({ dealId: localDeal.id })
      .then(d => { setLinkedProject(d.project); setMatchType(d.matchType); })
      .catch(() => { setLinkedProject(null); setMatchType(undefined); })
      .finally(() => setCheckingProject(false));
  }, [localDeal.id]);

  const handleLinkCandidate = async () => {
    if (!linkedProject || !localDeal.id) return;
    setLinkingCandidate(true);
    try {
      await linkProjectDeal({ projectId: linkedProject.id, dealId: localDeal.id });
      setMatchType('linked');
      toast.success(`Deal vinculado al proyecto "${linkedProject.projectCode ?? linkedProject.id}"`);
      setCandidateDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo vincular el proyecto');
    } finally {
      setLinkingCandidate(false);
    }
  };

  const handleDealSaved = (updated: Deal) => {
    setLocalDeal(updated);
    onDealUpdated(updated);
  };

  const handleDealFieldUpdated = (fields: { clientPrice?: number; quotedCost?: number; taxesPct?: number; retencionesPct?: number; currency?: string }) => {
    setLocalDeal(prev => ({ ...prev, ...fields }));
    onDealUpdated({ ...localDeal, ...fields });
  };

  const handlePhaseChange = async (newPhase: string) => {
    if (!localDeal.id || newPhase === localDeal.phase) return;
    const prevPhase = localDeal.phase;
    const updated = { ...localDeal, phase: newPhase };
    setLocalDeal(updated);
    onDealUpdated(updated);
    try {
      await saveDeal({ id: localDeal.id, phase: newPhase });
      if (newPhase === 'Ganado' && prevPhase !== 'Ganado') {
        setPendingApprove({ dealId: localDeal.id });
        // Justo al pasar a Ganado es cuando más importa no dejar pasar un
        // posible duplicado — si ya se había visto la sugerencia y se
        // descartó, no se vuelve a interrumpir con lo mismo.
        if (matchType === 'candidate' && !candidateDismissed) setCandidateDialogOpen(true);
      }
    } catch {
      toast.error('Error al actualizar la fase');
      setLocalDeal(prev => ({ ...prev, phase: prevPhase }));
      onDealUpdated({ ...updated, phase: prevPhase });
    }
  };

  const handleApprovalSuccess = (res: { projectCode: string; projectId: string; quotedCost: number }) => {
    const today = new Date().toISOString().split('T')[0];
    const updated: Deal = { ...localDeal, phase: 'Ganado', approvalDate: today, quotedCost: res.quotedCost };
    (updated as any).projects = [res.projectId];
    setLocalDeal(updated);
    onDealUpdated(updated);
    setLinkedProject({ id: res.projectId, projectCode: res.projectCode });
    setMatchType('linked');
    setApprovalReviewOpen(false);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[85vh] min-h-[420px] flex flex-col gap-0 p-0 overflow-hidden [&>button]:text-white/80 [&>button]:opacity-100 [&>button]:hover:text-white [&>button]:hover:bg-white/10">
          {/* Header — navy/teal de marca (mismo look que LoginPage.tsx y el
              portal de proveedores), en vez del header genérico blanco/gris.
              El selector [&>button] de arriba es la única forma de recolorear
              la X de cerrar (viene hardcodeada dentro de DialogContent en
              ui/dialog.tsx, sin prop para su className) — es el único <button>
              hijo directo, ya que DialogHeader y el contenido de abajo no lo son. */}
          <DialogHeader className="px-6 py-5 flex-shrink-0 bg-[#0F3D4C]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-xl leading-tight text-white font-bold">
                  {isNew ? 'Nuevo Deal' : (localDeal.dealName || 'Deal sin nombre')}
                </DialogTitle>
                {!isNew && localDeal.client && (
                  <p className="text-sm text-white/60 mt-0.5">{localDeal.client}</p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Estado del vínculo con un proyecto — visible siempre que
                    se abra el deal, sin importar la pestaña, para que se
                    sepa de entrada si ya está vinculado o si hay que
                    resolver una sugerencia antes de poder aprobar. */}
                {!checkingProject && matchType === 'linked' && linkedProject && (
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-white/80"
                    title={`Proyecto vinculado: ${linkedProject.projectCode ?? linkedProject.id}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {linkedProject.projectCode ?? 'Vinculado'}
                  </span>
                )}
                {!checkingProject && matchType === 'candidate' && !candidateDismissed && linkedProject && (
                  // Popover, no AlertDialog — es una decisión chica (sí/no)
                  // y un modal con su propio overlay oscuro encima del sheet
                  // (que ya tiene su header oscuro) se sentía como que la
                  // pantalla se apagaba dos veces. Sigue siendo controlado
                  // (open/onOpenChange) para poder abrirse solo al pasar a
                  // Ganado, no solo con el click del botón.
                  <Popover open={candidateDialogOpen} onOpenChange={setCandidateDialogOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCandidateDialogOpen(true)}
                        className="h-7 gap-1.5 text-xs bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        ¿Vincular a "{linkedProject.projectCode}"?
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 text-foreground">
                      <p className="text-sm font-semibold">¿Vincular este deal al proyecto "{linkedProject.projectCode}"?</p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Ya existe un proyecto con el mismo nombre que este deal. Vincularlo evita crear un proyecto duplicado al aprobar.
                      </p>
                      <div className="flex justify-end gap-2 mt-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setCandidateDismissed(true); setCandidateDialogOpen(false); }}
                        >
                          No, es otro
                        </Button>
                        <Button size="sm" disabled={linkingCandidate} onClick={handleLinkCandidate}>
                          {linkingCandidate ? 'Vinculando...' : 'Sí, vincular'}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {/* "Aprobar Deal" — vive en el header, no en la pestaña
                    General, para que se pueda aprobar y crear el proyecto
                    estando en cualquier pestaña (p.ej. Cotizaciones). Cubre
                    tanto "todavía no está Ganado" como "ya está Ganado pero
                    sin proyecto" — antes eran dos botones/flujos distintos. */}
                {canApprove && (
                  <Button
                    size="sm"
                    onClick={() => setApprovalReviewOpen(true)}
                    className="h-7 gap-1.5 text-xs bg-white text-[#0F3D4C] hover:bg-white/90"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aprobar Deal
                  </Button>
                )}

                {/* Fase — visible siempre, editable independiente de en qué tab
                    estés (antes vivía como un <Select> más dentro de "General",
                    mezclado con los datos de creación). Mismo patrón de badge
                    clickeable que InlineStatus en ProjectsPage.tsx. Pastilla
                    blanca (en vez del tinte del color sobre fondo claro) para
                    que se lea bien sobre el header navy. */}
                {!isNew && (
                  <Select
                    value={localDeal.phase ?? 'Prospecto'}
                    onValueChange={handlePhaseChange}
                    open={phaseSelectOpen}
                    onOpenChange={setPhaseSelectOpen}
                  >
                    <SelectTrigger className="h-auto border-none shadow-none p-0 gap-0 focus:ring-0 bg-transparent w-auto flex-shrink-0">
                      <button
                        onClick={() => setPhaseSelectOpen(true)}
                        className="hover:opacity-90 transition-opacity px-2.5 py-1 rounded-full text-xs font-semibold bg-white"
                        style={{ color: phaseColor }}
                        title="Click para cambiar de fase"
                      >
                        {localDeal.phase ?? 'Prospecto'}
                      </button>
                    </SelectTrigger>
                    <SelectContent>
                      {PHASE_KEYS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </DialogHeader>

          {isNew ? (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <DealGeneralTab deal={localDeal} onSaved={handleDealSaved} onDeleted={onDeleted} existingClients={existingClients} linkedProject={matchType === 'linked' ? linkedProject : null} checkingProject={checkingProject} />
            </div>
          ) : (
            <Tabs defaultValue="general" className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-3 mb-0 flex-shrink-0 grid grid-cols-5">
                <TabsTrigger value="general" className="data-[state=active]:text-[#027495]">General</TabsTrigger>
                <TabsTrigger value="cotizaciones" className="data-[state=active]:text-[#027495]">Cotizaciones</TabsTrigger>
                <TabsTrigger value="documentos" className="data-[state=active]:text-[#027495]">Documentos</TabsTrigger>
                <TabsTrigger value="brief" className="data-[state=active]:text-[#027495]">Brief</TabsTrigger>
                <TabsTrigger value="resumen" className="data-[state=active]:text-[#027495]">Resumen</TabsTrigger>
              </TabsList>
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
                <TabsContent value="general" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <DealGeneralTab deal={localDeal} onSaved={handleDealSaved} onDeleted={onDeleted} existingClients={existingClients} linkedProject={matchType === 'linked' ? linkedProject : null} checkingProject={checkingProject} />
                </TabsContent>
                <TabsContent value="cotizaciones" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <CotizacionesTab
                    dealId={localDeal.id}
                    dealCurrency={localDeal.currency}
                    dealClientPrice={localDeal.clientPrice}
                    dealQuotedCost={localDeal.quotedCost}
                    dealTaxesPct={localDeal.taxesPct}
                    dealRetencionesPct={localDeal.retencionesPct}
                    onDealFieldUpdated={handleDealFieldUpdated}
                  />
                </TabsContent>
                <TabsContent value="documentos" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <DocumentosTab dealId={localDeal.id} />
                </TabsContent>
                <TabsContent value="brief" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <BriefEditor dealId={localDeal.id} />
                </TabsContent>
                <TabsContent value="resumen" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <ResumenTab deal={localDeal} />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <ApprovalReviewDialog
        open={approvalReviewOpen}
        onClose={() => setApprovalReviewOpen(false)}
        deal={localDeal}
        onApproved={handleApprovalSuccess}
      />

      {/* Al mover la fase a "Ganado" desde el badge del header (o arrastrando
          en el kanban) — no desde el botón "Aprobar Deal", que ya crea el
          proyecto — se ofrece aprobar de una vez las cotizaciones marcadas
          "Incluida". Mismo diálogo que antes vivía dentro de DealGeneralTab. */}
      <AlertDialog open={!!pendingApprove} onOpenChange={o => !o && setPendingApprove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar cotizaciones incluidas?</AlertDialogTitle>
            <AlertDialogDescription>
              Las cotizaciones marcadas como "Incluida" se marcarán como <strong>Aprobadas</strong> y el costo cotizado del deal se actualizará automáticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingApprove(null)}>No por ahora</AlertDialogCancel>
            <AlertDialogAction
              disabled={approvingCotizaciones}
              onClick={async () => {
                if (!pendingApprove) return;
                setApprovingCotizaciones(true);
                try {
                  const res = await approveSelectedCotizaciones({ dealId: pendingApprove.dealId });
                  toast.success(`${res.approvedCount} cotización${res.approvedCount !== 1 ? 'es' : ''} aprobada${res.approvedCount !== 1 ? 's' : ''}`);
                  handleDealFieldUpdated({ quotedCost: res.totalCost });
                } catch { toast.error('Error al aprobar cotizaciones'); }
                setApprovingCotizaciones(false);
                setPendingApprove(null);
              }}
            >
              {approvingCotizaciones ? 'Aprobando...' : 'Sí, aprobar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
