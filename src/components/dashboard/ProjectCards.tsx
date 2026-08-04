import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import { GetDashboardDataOutputType } from 'zite-endpoints-sdk';
import { Search, FolderOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';

type Project = GetDashboardDataOutputType['myProjects'][0];

type Tab = 'active' | 'all';

function statusDot(status: string) {
  if (status === 'En curso') return 'bg-emerald-500';
  if (status === 'En pausa') return 'bg-amber-400';
  return 'bg-muted-foreground/30';
}

export default function ProjectCards({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const { setSelectedProject } = useProject();
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');

  const filtered = projects.filter(p => {
    if (tab === 'active' && p.status !== 'En curso') return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.projectCode?.toLowerCase().includes(q) ||
        p.fullName?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar proyecto..."
            className="h-8 pl-8 text-xs bg-muted/40 border-border focus-visible:ring-1"
          />
        </div>
        <div className="flex items-center bg-muted rounded-lg p-0.5 shrink-0">
          {(['active', 'all'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${
                tab === t
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'active' ? 'Mis activos' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex items-center gap-2 py-4 px-3 text-sm text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
          <FolderOpen className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
          {search ? 'Sin resultados' : tab === 'active' ? 'No tienes proyectos activos' : 'No hay proyectos'}
        </div>
      ) : (
        <div className="max-h-[200px] overflow-y-auto pr-0.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => { if (p.projectCode) { setSelectedProject(p.projectCode); navigate(`/operacion/proyectos/${p.projectCode}`); } }}
                title={p.fullName ?? p.projectCode ?? ''}
                className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:border-primary/50 hover:bg-muted/30 transition-all text-left group w-full min-w-0"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(p.status ?? '')}`} />
                <span className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                  {p.projectCode}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
