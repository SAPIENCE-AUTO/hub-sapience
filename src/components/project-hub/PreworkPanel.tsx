import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { getPreworkEstudios, createPreworkEstudio, updatePreworkEstudio } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus } from 'lucide-react';
import { PreworkParticipantesTab } from './PreworkParticipantesTab';
import { PreworkMisionesTab } from './PreworkMisionesTab';
import { PreworkRespuestasTab } from './PreworkRespuestasTab';

type InnerTab = 'misiones' | 'participantes' | 'respuestas';

// Orden a propósito: primero se programan las misiones, luego se invita
// (para no invitar a nadie a un estudio todavía sin actividades), y al
// final el análisis de lo que ya entregaron. "Participación" ya no es una
// pestaña aparte — se fusionó dentro de Participantes (ver
// PreworkParticipantesTab.tsx): status, progreso, respuestas y follow-ups
// de cada quien en un solo lugar.
const INNER_TABS: { id: InnerTab; label: string }[] = [
  { id: 'misiones', label: 'Misiones' },
  { id: 'participantes', label: 'Participantes' },
  { id: 'respuestas', label: 'Análisis' },
];

interface Estudio {
  id: string;
  nombre: string;
  activo: boolean;
  totalParticipantes: number;
  totalMisiones: number;
}

/**
 * Contenedor de Prework dentro de Tools. Un proyecto puede tener varios
 * "Prework" (estudios) — cada uno con su propio nombre, participantes y
 * misiones, independientes entre sí (p.ej. "Oleada 1" y "Oleada 2" del mismo
 * proyecto). Esta pantalla primero lista los estudios existentes; al elegir
 * uno entra a sus sub-pestañas Misiones/Participantes/Análisis.
 */
export function PreworkPanel({ proyectoId }: { proyectoId?: string }) {
  const [estudios, setEstudios] = useState<Estudio[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Estudio | null>(null);
  const [innerTab, setInnerTab] = useState<InnerTab>('misiones');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [creando, setCreando] = useState(false);

  const load = async () => {
    if (!proyectoId) return;
    setLoading(true);
    try {
      const res = await getPreworkEstudios({ proyectoId });
      const nuevos: Estudio[] = res.estudios ?? [];
      setEstudios(nuevos);
      if (selected) setSelected(nuevos.find(e => e.id === selected.id) ?? null);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [proyectoId]);

  const handleCrear = async (e: FormEvent) => {
    e.preventDefault();
    if (!proyectoId || !nuevoNombre.trim()) return;
    setCreando(true);
    try {
      await createPreworkEstudio({ proyectoId, nombre: nuevoNombre.trim() });
      setNuevoNombre('');
      toast.success('Prework creado');
      load();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo crear el estudio');
    } finally {
      setCreando(false);
    }
  };

  const handleToggleActivo = async (estudio: Estudio) => {
    try {
      await updatePreworkEstudio({ id: estudio.id, activo: !estudio.activo });
      load();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo actualizar');
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando…</div>;
  }

  if (selected) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3 py-2 flex-shrink-0">
          <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{selected.nombre}</span>
          <Badge variant={selected.activo ? 'default' : 'secondary'}>{selected.activo ? 'activo' : 'inactivo'}</Badge>
        </div>
        <div className="flex items-center gap-1 border-b px-3 py-1.5 flex-shrink-0">
          {INNER_TABS.map(tab => {
            const active = innerTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setInnerTab(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  active ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {innerTab === 'misiones' && <PreworkMisionesTab estudioId={selected.id} />}
          {innerTab === 'participantes' && <PreworkParticipantesTab estudioId={selected.id} />}
          {innerTab === 'respuestas' && <PreworkRespuestasTab estudioId={selected.id} />}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Prework</h3>
        <p className="text-xs text-muted-foreground">
          Un proyecto puede tener varios — cada uno con sus propios participantes y misiones.
        </p>
      </div>

      {estudios.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay ningún Prework en este proyecto.</p>}

      <div className="rounded-md border divide-y">
        {estudios.map(e => (
          <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
            <button onClick={() => setSelected(e)} className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate">{e.nombre}</p>
              <p className="text-xs text-muted-foreground">{e.totalParticipantes} participante(s) · {e.totalMisiones} misión(es)</p>
            </button>
            <Badge
              variant={e.activo ? 'default' : 'secondary'}
              className="cursor-pointer"
              onClick={() => handleToggleActivo(e)}
            >
              {e.activo ? 'activo' : 'inactivo'}
            </Badge>
          </div>
        ))}
      </div>

      <form onSubmit={handleCrear} className="flex items-center gap-2">
        <input
          value={nuevoNombre}
          onChange={(ev) => setNuevoNombre(ev.target.value)}
          placeholder="Nombre del nuevo Prework (ej. Oleada 1)"
          className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus:border-primary"
        />
        <Button type="submit" disabled={creando || !nuevoNombre.trim()}>
          <Plus className="h-4 w-4 mr-1.5" />{creando ? 'Creando…' : 'Nuevo Prework'}
        </Button>
      </form>
    </div>
  );
}
