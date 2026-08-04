import React from 'react';
import { Users, Pencil, ChevronUp, ChevronDown } from 'lucide-react';

interface TeamUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface SavedTeam {
  lider: string[];
  analistas: string[];
  moderadores: string[];
  asistentes: string[];
}

interface TeamSectionProps {
  teamUsers: TeamUser[];
  savedTeam: SavedTeam;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  onEditOpen: () => void;
}

function getUserName(users: TeamUser[], id: string): string {
  const u = users.find(x => x.id === id);
  if (!u) return id;
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || id;
}

export function TeamSection({ teamUsers, savedTeam, expanded, setExpanded, onEditOpen }: TeamSectionProps) {
  const allIds = [...savedTeam.lider, ...savedTeam.analistas, ...savedTeam.moderadores, ...savedTeam.asistentes];
  const hasTeam = allIds.length > 0;

  const roles = [
    { label: 'Líder',       ids: savedTeam.lider,       color: 'bg-primary/10 text-primary' },
    { label: 'Analistas',   ids: savedTeam.analistas,   color: 'bg-chart-2/10 text-chart-2' },
    { label: 'Moderadores', ids: savedTeam.moderadores, color: 'bg-chart-3/10 text-chart-3' },
    { label: 'Asistentes',  ids: savedTeam.asistentes,  color: 'bg-muted text-muted-foreground' },
  ].filter(r => r.ids.length > 0);

  return (
    <>
      {/* Header buttons */}
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
        >
          <Users className="w-3.5 h-3.5" />
          {hasTeam ? (
            <span className="hidden sm:inline">{allIds.length} miembro{allIds.length !== 1 ? 's' : ''}</span>
          ) : (
            <span className="hidden sm:inline">Asignar equipo</span>
          )}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <button
          onClick={onEditOpen}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Editar equipo"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expandable strip */}
      {expanded && (
        <div className="px-4 py-2 border-b border-border/40 bg-muted/30 flex flex-wrap gap-4 flex-shrink-0">
          {roles.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Sin equipo asignado.</p>
          ) : roles.map(role => (
            <div key={role.label} className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">{role.label}:</span>
              <div className="flex flex-wrap gap-1">
                {role.ids.map(id => (
                  <span key={id} className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${role.color}`}>
                    {getUserName(teamUsers, id)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
