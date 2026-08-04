import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import TeamMemberPicker from '../TeamMemberPicker';

interface TeamUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

interface TeamEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamUsers: TeamUser[];
  teamLider: string[];
  setTeamLider: (ids: string[]) => void;
  teamAnalistas: string[];
  setTeamAnalistas: (ids: string[]) => void;
  teamModeradores: string[];
  setTeamModeradores: (ids: string[]) => void;
  teamAsistentes: string[];
  setTeamAsistentes: (ids: string[]) => void;
  saving: boolean;
  onSave: () => void;
}

export function TeamEditDialog({
  open, onOpenChange,
  teamUsers,
  teamLider, setTeamLider,
  teamAnalistas, setTeamAnalistas,
  teamModeradores, setTeamModeradores,
  teamAsistentes, setTeamAsistentes,
  saving, onSave,
}: TeamEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onOpenChange(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Equipo del proyecto</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1 max-h-[60vh] overflow-y-auto pr-1">
          <TeamMemberPicker
            users={teamUsers}
            selected={teamLider}
            onChange={ids => setTeamLider(ids.slice(0, 1))}
            label="Líder"
            multiple={false}
            placeholder="Seleccionar líder..."
          />
          <TeamMemberPicker
            users={teamUsers}
            selected={teamAnalistas}
            onChange={setTeamAnalistas}
            label="Analistas"
            placeholder="Agregar analistas..."
          />
          <TeamMemberPicker
            users={teamUsers}
            selected={teamModeradores}
            onChange={setTeamModeradores}
            label="Moderadores"
            placeholder="Agregar moderadores..."
          />
          <TeamMemberPicker
            users={teamUsers}
            selected={teamAsistentes}
            onChange={setTeamAsistentes}
            label="Asistentes"
            placeholder="Agregar asistentes..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar equipo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
