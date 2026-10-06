import { useMemo, useState } from 'react';
import { assignArchivedFolderProject } from 'zite-endpoints-sdk';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useProject } from '@/context/ProjectContext';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "Asignar a proyecto" para una carpeta raíz del archivo que no casó sola con
// un proyecto del Hub (p. ej. DOS DOS). Liga todos sus archivos de una vez.
export default function AssignProjectPopover({ projectFolder, label, onAssigned }: {
  projectFolder: string;
  label: React.ReactNode;
  onAssigned: () => void;
}) {
  const { projects } = useProject();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const q = norm(search.trim());
    return projects
      .filter(p => !q || norm(`${p.projectCode} ${p.fullName ?? ''} ${p.client ?? ''}`).includes(q))
      .slice(0, 50);
  }, [projects, search]);

  const handleSelect = async (projectId: string, code: string) => {
    setSaving(true);
    try {
      const res = await assignArchivedFolderProject({ projectFolder, projectId });
      toast.success(`${res.updated} archivos ligados a ${code}`);
      setOpen(false);
      onAssigned();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo asignar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={e => e.stopPropagation()}>{label}</PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" onClick={e => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Proyecto para ${projectFolder}…`} value={search} onValueChange={setSearch} />
          <CommandList onWheel={e => e.stopPropagation()}>
            {saving && <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Asignando…</div>}
            {!saving && options.length === 0 && <CommandEmpty>Sin resultados</CommandEmpty>}
            {!saving && (
              <CommandGroup>
                {options.map(p => (
                  <CommandItem key={p.id} value={p.id} onSelect={() => handleSelect(p.id, p.projectCode)}>
                    <span className="truncate">{p.projectCode}</span>
                    {p.fullName && p.fullName !== p.projectCode && <span className="ml-1.5 text-xs text-muted-foreground truncate">{p.fullName}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
