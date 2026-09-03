import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { preworkGetMisiones, preworkSubmitRespuesta, preworkGetFeedSocial, preworkReaccionarRespuesta } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import { PREWORK_TOKEN_KEY } from './PreworkLoginPage';

interface Mision {
  id: string;
  titulo: string;
  descripcion?: string;
  tipo: string;
  visibilidad: string;
  fechaLanzamiento?: string;
}

interface EntradaFeed {
  id: string;
  alias: string;
  esMia: boolean;
  contenido: { texto?: string };
  archivos: { url: string; mimeType?: string }[];
  likes: number;
  meGusta: boolean;
  comentarios: { alias: string; comentario: string; createdAt: string }[];
}

const TIPOS_CON_UI = new Set(['texto', 'foto']);

/**
 * Pantalla de una misión — pública, hermana de <Layout>. No hay un endpoint
 * de "una sola misión": se reusa preworkGetMisiones (ya trae pendientes +
 * completadas) y se busca por id, igual de barato que un fetch dedicado
 * para el volumen de misiones de un estudio.
 */
export default function PreworkMisionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [token] = useState(() => localStorage.getItem(PREWORK_TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const [mision, setMision] = useState<Mision | null>(null);
  const [yaCompletada, setYaCompletada] = useState(false);

  const [texto, setTexto] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { navigate('/prework/login'); return; }
    preworkGetMisiones({ token }).then((res) => {
      const found = [...(res.pendientes ?? []), ...(res.completadas ?? [])].find((m: Mision) => m.id === id);
      setMision(found ?? null);
      setYaCompletada(!!(res.completadas ?? []).find((m: Mision) => m.id === id));
      setLoading(false);
    }).catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleFotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFoto(e.target.files?.[0] ?? null);
  };

  const handleSubmit = async () => {
    if (!token || !mision) return;
    setSubmitting(true);
    setError('');
    try {
      if (mision.tipo === 'texto') {
        await preworkSubmitRespuesta({ token, misionId: mision.id, contenido: { texto } });
      } else if (mision.tipo === 'foto') {
        if (!foto) { setError('Selecciona una foto.'); setSubmitting(false); return; }
        const uploaded = await uploadFile({ data: foto, filename: foto.name, folder: 'prework', preworkToken: token });
        await preworkSubmitRespuesta({
          token, misionId: mision.id,
          archivos: [{ url: uploaded.fileUrl, name: uploaded.name, size: uploaded.size, mimeType: uploaded.mimeType }],
        });
      }
      setDone(true);
    } catch (err) {
      setError((err as Error)?.message || 'No se pudo enviar tu respuesta.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <CenterMessage>Cargando…</CenterMessage>;
  if (!mision) return <CenterMessage>Esta actividad no está disponible.</CenterMessage>;

  if (done || yaCompletada) {
    if (mision.visibilidad !== 'social') {
      return (
        <CenterMessage>
          <div className="space-y-3">
            <p className="text-lg font-semibold text-[#0F3D4C]">¡Gracias!</p>
            <p>Tu respuesta quedó registrada.</p>
            <button
              onClick={() => navigate('/prework')}
              className="rounded-full bg-[#027495] px-6 py-2.5 text-[14px] font-semibold text-white"
            >
              Volver a mis actividades
            </button>
          </div>
        </CenterMessage>
      );
    }
    return (
      <div className="min-h-dvh bg-[#F2F7F8] px-6 py-8">
        <button onClick={() => navigate('/prework')} className="mb-6 text-[13px] text-[#027495]">← Mis actividades</button>
        <p className="text-[15px] font-semibold text-[#0F3D4C]">¡Gracias! Así respondieron los demás:</p>
        <FeedSocial token={token!} misionId={mision.id} />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F2F7F8] px-6 py-8">
      <button onClick={() => navigate('/prework')} className="mb-6 text-[13px] text-[#027495]">← Mis actividades</button>
      <h1 className="text-xl font-bold text-[#0F3D4C]">{mision.titulo}</h1>
      {mision.descripcion && <p className="mt-2 text-[14px] text-[#4B5D63]">{mision.descripcion}</p>}

      <div className="mt-6">
        {mision.tipo === 'texto' && (
          <textarea
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe tu respuesta…"
            rows={6}
            className="w-full rounded-[10px] border border-[#D7E3E5] bg-white p-3.5 text-[15px] text-[#0F3D4C] outline-none focus:border-[#3FA9C4]"
          />
        )}

        {mision.tipo === 'foto' && (
          <div>
            <input type="file" accept="image/*" onChange={handleFotoChange} className="text-sm" />
            {foto && <p className="mt-2 text-xs text-[#6E8388]">{foto.name}</p>}
          </div>
        )}

        {!TIPOS_CON_UI.has(mision.tipo) && (
          <p className="text-sm text-[#6E8388]">Esta actividad todavía no está disponible en el portal.</p>
        )}

        {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}

        {TIPOS_CON_UI.has(mision.tipo) && (
          <button
            onClick={handleSubmit}
            disabled={submitting || (mision.tipo === 'texto' && !texto.trim()) || (mision.tipo === 'foto' && !foto)}
            className="mt-5 w-full rounded-[10px] bg-[#027495] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:enabled:bg-[#025F7A] disabled:opacity-60"
          >
            {submitting ? 'Enviando…' : 'Enviar respuesta'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Feed de otras entregas a esta misión — solo se pide una vez que ya entregaste la tuya (ver preworkGetFeedSocial.ts). */
function FeedSocial({ token, misionId }: { token: string; misionId: string }) {
  const [entradas, setEntradas] = useState<EntradaFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [comentarioPorId, setComentarioPorId] = useState<Record<string, string>>({});

  const cargar = () => {
    preworkGetFeedSocial({ token, misionId }).then((res) => {
      setEntradas(res.entradas ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [misionId]);

  const handleLike = async (respuestaId: string) => {
    setEntradas(prev => prev.map(e => e.id === respuestaId
      ? { ...e, meGusta: !e.meGusta, likes: e.likes + (e.meGusta ? -1 : 1) }
      : e));
    try {
      await preworkReaccionarRespuesta({ token, respuestaId, tipo: 'like' });
    } catch {
      cargar();
    }
  };

  const handleComentar = async (respuestaId: string) => {
    const comentario = (comentarioPorId[respuestaId] ?? '').trim();
    if (!comentario) return;
    setComentarioPorId(prev => ({ ...prev, [respuestaId]: '' }));
    try {
      await preworkReaccionarRespuesta({ token, respuestaId, comentario });
      cargar();
    } catch { /* se pierde el intento, el usuario puede reescribirlo */ }
  };

  if (loading) return <p className="mt-4 text-sm text-[#6E8388]">Cargando…</p>;
  if (entradas.length === 0) return <p className="mt-4 text-sm text-[#6E8388]">Todavía no hay más respuestas.</p>;

  return (
    <div className="mt-4 space-y-3">
      {entradas.map(e => (
        <div key={e.id} className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-[13px] font-semibold text-[#0F3D4C]">{e.esMia ? 'Tú' : e.alias}</p>
          {e.contenido?.texto && <p className="mt-1 text-[14px] text-[#4B5D63]">{e.contenido.texto}</p>}
          {e.archivos?.map((a, i) => (
            a.mimeType?.startsWith('image/')
              ? <img key={i} src={a.url} alt="" className="mt-2 h-40 w-40 rounded-lg object-cover" />
              : null
          ))}
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => handleLike(e.id)}
              className={`text-[13px] font-medium ${e.meGusta ? 'text-[#027495]' : 'text-[#9CB0B5]'}`}
            >
              ♥ {e.likes}
            </button>
          </div>
          {e.comentarios.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-[#F0F4F5] pt-2">
              {e.comentarios.map((c, i) => (
                <p key={i} className="text-[12px] text-[#6E8388]"><b className="text-[#4B5D63]">{c.alias}:</b> {c.comentario}</p>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <input
              value={comentarioPorId[e.id] ?? ''}
              onChange={(ev) => setComentarioPorId(prev => ({ ...prev, [e.id]: ev.target.value }))}
              onKeyDown={(ev) => { if (ev.key === 'Enter') handleComentar(e.id); }}
              placeholder="Comentar…"
              className="flex-1 rounded-full border border-[#E4EDEF] px-3 py-1 text-[12px] outline-none focus:border-[#3FA9C4]"
            />
            <button onClick={() => handleComentar(e.id)} className="text-[12px] font-medium text-[#027495]">Enviar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F2F7F8] px-6 text-center text-sm text-[#6E8388]">
      {children}
    </div>
  );
}
