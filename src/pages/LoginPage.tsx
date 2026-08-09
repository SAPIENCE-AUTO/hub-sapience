import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAuth } from 'zite-auth-sdk';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const { error } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const redirectTarget = params.get('redirect') || window.location.origin;

  async function sendMagicLink() {
    if (!email) return;
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
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Hub Sapience</CardTitle>
          <CardDescription>Inicia sesión para continuar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {sendError && <p className="text-sm text-destructive">{sendError}</p>}

          {sent ? (
            <p className="text-sm text-muted-foreground">
              Revisa tu correo — te enviamos un enlace de acceso.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="tu@sapience.com.mx"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendMagicLink(); }}
                />
              </div>
              <Button className="w-full" disabled={busy || !email} onClick={sendMagicLink}>
                Enviar enlace mágico
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
