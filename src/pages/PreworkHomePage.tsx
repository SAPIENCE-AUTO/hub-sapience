import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { preworkGetMisiones } from 'zite-endpoints-sdk';
import { PREWORK_TOKEN_KEY, PREWORK_NOMBRE_KEY } from './PreworkLoginPage';
import { useRealtimePreworkParticipante } from '@/hooks/useRealtimePrework';

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

interface Mision {
  id: string;
  titulo: string;
  descripcion?: string;
  tipo: string;
  fechaLanzamiento?: string;
}
interface Seguimiento {
  id: string;
  mensaje: string;
  leido: boolean;
  createdAt: string;
}

type Tab = 'pendientes' | 'completadas' | 'seguimientos';

/**
 * Home del participante — pública, hermana de <Layout> (nunca pasa por
 * useAuth()). Misiones ya vienen filtradas por fecha de lanzamiento desde
 * preworkGetMisiones.ts (desbloqueo perezoso, sin cron).
 */
export default function PreworkHomePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nombre, setNombre] = useState('');
  const [pendientes, setPendientes] = useState<Mision[]>([]);
  const [completadas, setCompletadas] = useState<Mision[]>([]);
  const [seguimientos, setSeguimientos] = useState<Seguimiento[]>([]);
  const [tab, setTab] = useState<Tab>('pendientes');
  const [token] = useState(() => localStorage.getItem(PREWORK_TOKEN_KEY));

  const cargar = () => {
    if (!token) { navigate('/prework/login'); return; }

    preworkGetMisiones({ token }).then((res) => {
      setNombre(res.participanteNombre ?? localStorage.getItem(PREWORK_NOMBRE_KEY) ?? '');
      setPendientes(res.pendientes ?? []);
      setCompletadas(res.completadas ?? []);
      setSeguimientos(res.seguimientos ?? []);
      setLoading(false);
    }).catch((err) => {
      setError((err as Error)?.message || 'No se pudo cargar tus actividades.');
      setLoading(false);
      if ((err as { code?: string }).code === 'UNAUTHORIZED') {
        localStorage.removeItem(PREWORK_TOKEN_KEY);
        setTimeout(() => navigate('/prework/login'), 1500);
      }
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, []);

  useRealtimePreworkParticipante({ token, onMisionNueva: cargar, onSeguimientoNuevo: cargar });

  const handleLogout = () => {
    localStorage.removeItem(PREWORK_TOKEN_KEY);
    localStorage.removeItem(PREWORK_NOMBRE_KEY);
    navigate('/prework/login');
  };

  return (
    <div className="min-h-dvh bg-[#F2F7F8]">
      <div className="bg-[#0F3D4C] px-6 pb-6 pt-8 text-white">
        <div className="flex items-center justify-between">
          <img src={LOGO_URL} alt="Sapience" className="h-6 w-auto" />
          <button onClick={handleLogout} className="text-xs text-[#8FB6C0] hover:text-white">Salir</button>
        </div>
        <h1 className="mt-4 text-xl font-bold">Hola{nombre ? `, ${nombre}` : ''}</h1>
        <p className="text-[13px] text-[#8FB6C0]">Aquí están tus actividades.</p>
      </div>

      <div className="flex gap-1 px-6 pt-4">
        {([
          { id: 'pendientes', label: `Pendientes (${pendientes.length})` },
          { id: 'completadas', label: `Completadas (${completadas.length})` },
          { id: 'seguimientos', label: `Follow-ups (${seguimientos.length})` },
        ] as { id: Tab; label: string }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              tab === t.id ? 'bg-[#027495] text-white' : 'bg-white text-[#4B5D63]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-4 space-y-2.5">
        {loading && <p className="text-sm text-[#6E8388]">Cargando…</p>}
        {error && !loading && <p className="text-sm text-red-600">{error}</p>}

        {!loading && tab === 'pendientes' && (
          pendientes.length === 0
            ? <p className="text-sm text-[#6E8388]">No tienes actividades pendientes por ahora.</p>
            : pendientes.map(m => (
              <button
                key={m.id}
                onClick={() => navigate(`/prework/mision/${m.id}`)}
                className="block w-full rounded-xl bg-white p-4 text-left shadow-sm"
              >
                <p className="text-[15px] font-semibold text-[#0F3D4C]">{m.titulo}</p>
                {m.descripcion && <p className="mt-1 text-[13px] text-[#6E8388]">{m.descripcion}</p>}
              </button>
            ))
        )}

        {!loading && tab === 'completadas' && (
          completadas.length === 0
            ? <p className="text-sm text-[#6E8388]">Todavía no completas ninguna actividad.</p>
            : completadas.map(m => (
              <div key={m.id} className="rounded-xl bg-white/60 p-4">
                <p className="text-[15px] font-semibold text-[#4B5D63]">{m.titulo}</p>
              </div>
            ))
        )}

        {!loading && tab === 'seguimientos' && (
          seguimientos.length === 0
            ? <p className="text-sm text-[#6E8388]">No tienes follow-ups.</p>
            : seguimientos.map(s => (
              <div key={s.id} className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-[14px] text-[#0F3D4C]">{s.mensaje}</p>
                <p className="mt-1 text-[11px] text-[#9CB0B5]">{new Date(s.createdAt).toLocaleString('es-MX')}</p>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
