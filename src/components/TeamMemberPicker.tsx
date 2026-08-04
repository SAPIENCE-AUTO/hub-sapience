import { useState, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, X, Users } from 'lucide-react';
type User = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profilePhoto?: string;
  role?: string;
};

interface TeamMemberPickerProps {
  users: User[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  multiple?: boolean;
  placeholder?: string;
}

function userName(u: User) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return name || u.email;
}

export default function TeamMemberPicker({
  users,
  selected,
  onChange,
  label,
  multiple = true,
  placeholder = 'Seleccionar...',
}: TeamMemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(u =>
      (userName(u) ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const selectedUsers = users.filter(u => selected.includes(u.id));

  const toggle = (id: string) => {
    if (!multiple) {
      onChange(selected.includes(id) ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const remove = (id: string) => onChange(selected.filter(x => x !== id));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>

      {/* Selected badges */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedUsers.map(u => (
            <Badge key={u.id} variant="secondary" className="gap-1 text-xs pr-1 h-6">
              <span className="truncate max-w-[100px]">{userName(u)}</span>
              <button
                onClick={() => remove(u.id)}
                className="text-muted-foreground hover:text-foreground flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Picker popover */}
      <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(''); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5 w-full justify-between"
          >
            <span className="text-muted-foreground">{placeholder}</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <Input
            className="h-7 text-xs mb-2"
            placeholder="Buscar usuario..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">Sin resultados</p>
            ) : filtered.map(u => (
              <label
                key={u.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.includes(u.id)}
                  onCheckedChange={() => toggle(u.id)}
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{userName(u)}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {[u.email, u.role].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
