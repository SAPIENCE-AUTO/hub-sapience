import { useEffect, useState } from 'react';
import { getProjects, getDeals, linkMeetingRecording } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList, CommandInput, CommandEmpty } from '@/components/ui/command';
import { Link2, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

// Cotizaciones/deals son información comercial — visibilidad acotada a
// quienes ya ven esa parte del negocio hoy (mismo criterio y mismas dos
// personas que TOOLS_ALLOWED_EMAILS en ProjectHubPage.tsx, pero es un gate
// distinto por una razón distinta — no se reusa esa constante a propósito).
export const DEAL_LINK_ALLOWED_EMAILS = ['sergio@sapience.com.mx', 'luis@sapience.com.mx'];

interface Option {
  key: string;
  label: string;
  sublabel: string;
  projectId?: string;
  dealId?: string;
}

// Minutas / notetaker (sep 2026): "que diga si ya está vinculada a un
// proyecto/deal, a cuál está vinculada, o desde ahí mismo poder vincular"
// (Sergio) — a diferencia de la primera versión, esto ya sabe mostrar el
// vínculo ACTUAL (no solo el que se acaba de hacer en esta sesión) y permite
// cambiarlo, no solo fijarlo una vez. allowDeals oculta los deals para quien
// no sea Sergio o Luis, tanto la opción como el resultado si ya estaba
// vinculada a uno (mejor no mostrar el nombre del deal a quien no debería
// verlo, aunque ya esté vinculado).
export default function LinkMeetingRecordingPopover({ recordingId, projectId, dealId, allowDeals, onLinked }: {
  recordingId: string;
  projectId?: string;
  dealId?: string;
  allowDeals: boolean;
  onLinked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [search, setSearch] = useState('');

  const loadOptions = async () => {
    if (options) return;
    setLoading(true);
    try {
      const [{ projects }, dealsResult] = await Promise.all([
        getProjects({}),
        allowDeals ? getDeals({}) : Promise.resolve({ deals: [] }),
      ]);
      const projectOptions: Option[] = projects.map((p: any) => ({
        key: `p-${p.id}`,
        label: p.fullName || p.projectCode || 'Sin nombre',
        sublabel: 'Proyecto',
        projectId: p.id,
      }));
      const dealOptions: Option[] = dealsResult.deals.map((d: any) => ({
        key: `d-${d.id}`,
        label: d.dealName || 'Sin nombre',
        sublabel: 'Deal',
        dealId: d.id,
      }));
      setOptions([...projectOptions, ...dealOptions]);
    } catch {
      toast.error('No se pudieron cargar proyectos y deals');
    } finally {
      setLoading(false);
    }
  };

  // Carga eager (no solo al abrir el popover) para poder mostrar la
  // etiqueta del vínculo actual sin que el usuario tenga que abrir nada.
  useEffect(() => {
    if (projectId || dealId) loadOptions();
  }, [projectId, dealId]);

  const handleSelect = async (opt: Option) => {
    setLinking(true);
    try {
      await linkMeetingRecording({ meetingRecordingId: recordingId, projectId: opt.projectId ?? null, dealId: opt.dealId ?? null });
      toast.success(`Vinculada a ${opt.label}`);
      setOpen(false);
      onLinked?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo vincular la minuta');
    } finally {
      setLinking(false);
    }
  };

  const currentOption = options?.find(o =>
    (projectId && o.projectId === projectId) || (dealId && o.dealId === dealId),
  );
  // Ya está vinculada a un deal, pero este usuario no puede ver deals —
  // no se le enseña ni el botón de "vincular" (cambiar algo que no puede
  // ver sería más confuso que útil) ni el nombre.
  if (dealId && !allowDeals) {
    return <span className="text-xs text-muted-foreground">Vinculada</span>;
  }

  const filtered = (options ?? []).filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const isLinked = !!(projectId || dealId);

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) loadOptions(); }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={isLinked ? 'ghost' : 'outline'} className="h-7 text-xs gap-1.5" disabled={linking}>
          {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isLinked ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
          {isLinked ? (currentOption?.label ?? 'Vinculada') : 'Vincular a proyecto/deal'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar proyecto o deal..." value={search} onValueChange={setSearch} />
          <CommandList onWheel={e => e.stopPropagation()}>
            {loading && <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</div>}
            {!loading && filtered.length === 0 && <CommandEmpty>Sin resultados</CommandEmpty>}
            <CommandGroup>
              {filtered.map(opt => (
                <CommandItem key={opt.key} value={opt.key} onSelect={() => handleSelect(opt)}>
                  {currentOption?.key === opt.key && <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />}
                  <span className="truncate">{opt.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{opt.sublabel}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
