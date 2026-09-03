import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { preworkLogin } from 'zite-endpoints-sdk';

// Mismo logo/paleta que SwipePage.tsx/ObservationRoomPage.tsx/LoginPage.tsx —
// identidad real de Sapience. Página pública, hermana de <Layout>, nunca
// pasa por useAuth() (esa es la sesión del equipo interno vía Supabase).
const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

export const PREWORK_TOKEN_KEY = 'prework_token';
export const PREWORK_NOMBRE_KEY = 'prework_nombre';

/**
 * Login del portal de participante de Prework (misiones/diario). Email +
 * contraseña real contra `prework_participantes` — ver src/api/preworkLogin.ts
 * y server/preworkAuth.ts. El token de sesión se guarda en localStorage
 * (igual que el device token de Swipe) y lo consumen el resto de páginas
 * públicas de Prework (`/prework`, `/prework/mision/:id`, fases siguientes).
 */
export default function PreworkLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await preworkLogin({ email: email.trim(), password });
      if (!res.success || !res.token) {
        setError('Correo o contraseña incorrectos.');
        setLoading(false);
        return;
      }
      localStorage.setItem(PREWORK_TOKEN_KEY, res.token);
      localStorage.setItem(PREWORK_NOMBRE_KEY, res.participante?.nombre ?? '');
      navigate('/prework');
    } catch (err) {
      setError((err as Error)?.message || 'No se pudo iniciar sesión.');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[#0F3D4C] px-6 pb-10 pt-14 text-white">
      <img src={LOGO_URL} alt="Sapience" className="h-7 w-auto self-start" />
      <div className="flex flex-1 flex-col justify-center">
        <p className="mb-1 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#6FC2DA]">Sapience</p>
        <h1 className="mb-2 text-[26px] font-bold leading-tight">Tus actividades</h1>
        <p className="mb-8 text-[15px] text-[#8FB6C0]">Entra con el correo y la contraseña que te compartimos.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            required autoFocus type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo"
            className="w-full rounded-[10px] border-[1.5px] border-white/15 bg-white/5 px-4 py-3.5 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-[#3FA9C4]"
          />
          <input
            required type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="w-full rounded-[10px] border-[1.5px] border-white/15 bg-white/5 px-4 py-3.5 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-[#3FA9C4]"
          />
          {error && <p className="text-[13px] text-[#F2A19B]">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-[10px] bg-[#027495] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:enabled:bg-[#025F7A] disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
