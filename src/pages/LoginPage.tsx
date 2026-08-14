import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { supabase } from '@/lib/supabaseClient';

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

export default function LoginPage() {
  const { error } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const redirectTarget = params.get('redirect') || window.location.origin;
  const displayError = sendError ?? error ?? null;

  async function sendMagicLink() {
    if (!email || busy) return;
    setBusy(true);
    setSendError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      // Sin esto, signInWithOtp crea una cuenta nueva en auth.users para
      // cualquier correo así no exista en la tabla `users` — el toggle de
      // "disable signup" de Supabase no cubre el flujo de magic link.
      // Los usuarios reales ya se aprovisionaron de antemano (ver server/auth.ts).
      options: { emailRedirectTo: redirectTarget, shouldCreateUser: false },
    });
    setBusy(false);
    if (err) { setSendError(err.message); return; }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      {/* ── Mitad izquierda: la marca ─────────────────────────────────── */}
      <div className="relative flex flex-none flex-col justify-between gap-5 overflow-hidden bg-[linear-gradient(160deg,#14495A_0%,#0F3D4C_55%,#0A2F3B_100%)] px-[26px] pb-[34px] pt-[30px] md:w-[42%] md:gap-0 md:px-[52px] md:py-14">
        {/* Marca de agua decorativa — oculta en móvil */}
        <div className="pointer-events-none absolute -bottom-28 -right-24 hidden h-[380px] w-[380px] rounded-full border-[44px] border-[rgba(2,116,149,.16)] md:block" />

        <img src={LOGO_URL} alt="Sapience" className="relative z-10 h-auto w-[130px] md:w-[168px]" />

        <div className="relative z-10 max-w-none text-[19px] font-semibold leading-snug tracking-tight text-white md:max-w-[15ch] md:text-[27px]">
          Toda nuestra operación, <span className="text-[#6FC2DA]">en un solo lugar</span>.
        </div>
      </div>

      {/* ── Mitad derecha: el formulario ──────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-[26px] pb-14 pt-9 md:px-10 md:py-12">
        <div className="w-full max-w-[380px]">
          {sent ? (
            <div className="rounded-xl bg-[#F2F7F8] px-6 py-6 text-left">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#027495] text-xl text-white">
                ✓
              </div>
              <h2 className="mb-2 text-lg font-bold text-[#0F3D4C]">Revisa tu correo</h2>
              <p className="text-sm leading-relaxed text-[#383838]">
                Mandamos tu enlace de acceso a<br />
                <span className="font-semibold text-[#0F3D4C]">{email}</span>
              </p>
              <p className="mt-3.5 text-[13px] text-[#6E8388]">
                Vence pronto y sirve una sola vez. Si no lo ves, revisa correo no deseado.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setSendError(null); }}
                className="mt-4 text-[13px] font-semibold text-[#027495] underline underline-offset-2 hover:text-[#0F3D4C]"
              >
                Usar otro correo
              </button>
            </div>
          ) : (
            <>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#027495]">
                Hub Sapience
              </span>
              <h1 className="mb-2 mt-2.5 text-[28px] font-bold leading-tight tracking-tight text-[#0F3D4C]">
                Inicia sesión
              </h1>
              <p className="mb-7 text-[15px] leading-relaxed text-[#6E8388]">
                Te mandamos un enlace por correo. No necesitas contraseña.
              </p>

              <label
                htmlFor="email"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-[#6E8388]"
              >
                Tu correo
              </label>
              <input
                id="email"
                type="email"
                placeholder="nombre@sapience.com.mx"
                autoComplete="email"
                inputMode="email"
                autoFocus
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendMagicLink(); }}
                className={`w-full rounded-[10px] border-[1.5px] px-4 py-3.5 text-[15px] text-[#383838] outline-none transition-colors placeholder:text-[#A9BAC0] focus:border-[#027495] focus:ring-[3px] focus:ring-[#027495]/[.13] disabled:opacity-70 ${
                  displayError ? 'border-[#C4302B]' : 'border-[#DDE5E8]'
                }`}
              />

              {displayError && (
                <div className="mt-2.5 flex items-start gap-1.5 text-[13px] leading-snug text-[#C4302B]">
                  <span>⚠</span>
                  <span>{displayError}</span>
                </div>
              )}

              <button
                type="button"
                disabled={busy || !email}
                onClick={sendMagicLink}
                className="mt-[18px] w-full rounded-[10px] bg-[#0F3D4C] px-5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:enabled:bg-[#0A2F3B] active:enabled:translate-y-px disabled:cursor-default disabled:bg-[#93A9B0]"
              >
                {busy ? 'Enviando…' : 'Enviar enlace de acceso'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
