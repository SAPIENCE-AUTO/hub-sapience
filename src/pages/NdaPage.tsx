import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Download, Loader2, XCircle } from 'lucide-react';
import { ApiError, getNDAPublic, rejectNDA, signNDA } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { SignaturePad, type SignaturePadHandle } from '@/components/nda/SignaturePad';
import { fechaMx } from '@/lib/nda';

interface Texto {
  version: string;
  titulo: string;
  aperturaAntes: string;
  aperturaDespues: string;
  secciones: { titulo: string; parrafos: string[] }[];
}
interface Datos {
  estado: 'pendiente' | 'firmado' | 'rechazado';
  nombre: string;
  /** El renglón «Sesión: …» que va arriba del acuerdo (sin el rótulo), si el envío la trae. */
  sesion?: string;
  texto: Texto;
  firmadoAt?: string;
  rechazadoAt?: string;
  pdfUrl?: string;
}
type Fase =
  | { tipo: 'cargando' }
  | { tipo: 'invalido' }
  | { tipo: 'error' }
  | { tipo: 'listo'; datos: Datos }
  | { tipo: 'firmado'; firmadoAt: string }
  | { tipo: 'rechazado' };

/**
 * Página pública `/nda/:token` — hermana de <Layout> en App.tsx, nunca pasa por useAuth(). La persona llega desde la liga personal de su correo,
 * lee el acuerdo, confirma su nombre, firma con el dedo y lo envía (o dice que no acepta). Qué pasa con lo firmado: docs/nda.md.
 */
export default function NdaPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [fase, setFase] = useState<Fase>({ tipo: 'cargando' });
  const [pdfUrl, setPdfUrl] = useState<string | undefined>();

  useEffect(() => { document.title = 'Acuerdo de confidencialidad'; }, []);

  useEffect(() => {
    let vivo = true;
    getNDAPublic({ token })
      .then((d: Datos) => { if (vivo) { setFase({ tipo: 'listo', datos: d }); setPdfUrl(d.pdfUrl); } })
      .catch((e: unknown) => { if (vivo) setFase(e instanceof ApiError && e.status === 404 ? { tipo: 'invalido' } : { tipo: 'error' }); });
    return () => { vivo = false; };
  }, [token]);

  // Recién firmado, el PDF tarda unos segundos en estar listo: se pregunta cada pocos segundos (y si no sale, le llega por correo).
  useEffect(() => {
    if (fase.tipo !== 'firmado' || pdfUrl) return;
    let intentos = 0;
    const id = setInterval(() => {
      intentos++;
      getNDAPublic({ token }).then((d: Datos) => { if (d.pdfUrl) setPdfUrl(d.pdfUrl); }).catch(() => undefined);
      if (intentos >= 8) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [fase.tipo, pdfUrl, token]);

  return (
    <div className="min-h-screen bg-[#eef1f5] px-3 py-5 sm:py-10">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-[#E4E9F0] bg-white shadow-sm">
        <div className="bg-[#0e4b5a] px-6 py-5 text-white">
          <h1 className="text-lg font-bold leading-snug">Acuerdo de confidencialidad</h1>
        </div>
        <div className="px-5 py-6 sm:px-6">
          {fase.tipo === 'cargando' && <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" aria-label="Cargando" /></div>}
          {fase.tipo === 'invalido' && (
            <Mensaje icono={<XCircle className="h-10 w-10 text-slate-400" />} titulo="Este enlace no es válido">
              Revisa que lo hayas copiado completo. Si el problema sigue, pídele a quien te lo mandó que te envíe uno nuevo.
            </Mensaje>
          )}
          {fase.tipo === 'error' && (
            <Mensaje icono={<XCircle className="h-10 w-10 text-slate-400" />} titulo="No pudimos abrir el acuerdo">
              Revisa tu conexión y vuelve a abrir el enlace en un momento.
            </Mensaje>
          )}
          {fase.tipo === 'listo' && fase.datos.estado === 'firmado' && <Firmado firmadoAt={fase.datos.firmadoAt} pdfUrl={pdfUrl} ya />}
          {fase.tipo === 'firmado' && <Firmado firmadoAt={fase.firmadoAt} pdfUrl={pdfUrl} />}
          {fase.tipo === 'listo' && fase.datos.estado === 'rechazado' && (
            <Mensaje icono={<XCircle className="h-10 w-10 text-slate-400" />} titulo="Registramos que no aceptaste el acuerdo">
              {fase.datos.rechazadoAt ? `Fue el ${fechaMx(fase.datos.rechazadoAt)}. ` : ''}Si fue un error, avísale a quien te lo mandó para que te envíe un enlace nuevo.
            </Mensaje>
          )}
          {fase.tipo === 'rechazado' && (
            <Mensaje icono={<XCircle className="h-10 w-10 text-slate-400" />} titulo="Registramos tu respuesta">
              Gracias por avisarnos. Si cambias de opinión, pídele a quien te lo mandó que te envíe un enlace nuevo.
            </Mensaje>
          )}
          {fase.tipo === 'listo' && fase.datos.estado === 'pendiente' && (
            <Formulario token={token} datos={fase.datos} onFirmado={(firmadoAt) => setFase({ tipo: 'firmado', firmadoAt })} onRechazado={() => setFase({ tipo: 'rechazado' })} onYaResuelto={() => window.location.reload()} />
          )}
        </div>
      </div>
    </div>
  );
}

/** El párrafo que cita el aviso de privacidad trae su dirección (sharpli.mx/f/aviso): se vuelve liga, para leerlo antes de aceptar. */
function ConLigaDelAviso({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(sharpli\.mx\/f\/aviso)/).map((trozo, i) => trozo === 'sharpli.mx/f/aviso'
        ? <a key={i} href="/f/aviso" target="_blank" rel="noreferrer" className="font-medium text-[#0e4b5a] underline underline-offset-2">{trozo}</a>
        : trozo)}
    </>
  );
}

function Mensaje({ icono, titulo, children }: { icono: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      {icono}
      <p className="text-base font-semibold text-slate-900">{titulo}</p>
      {children && <p className="max-w-sm text-sm leading-relaxed text-slate-600">{children}</p>}
    </div>
  );
}

function Firmado({ firmadoAt, pdfUrl, ya }: { firmadoAt?: string; pdfUrl?: string; ya?: boolean }) {
  return (
    <Mensaje icono={<CheckCircle2 className="h-12 w-12 text-[#257E55]" />} titulo={ya ? 'Ya firmaste este acuerdo' : 'Listo, quedó firmado'}>
      {firmadoAt ? `Firmado el ${fechaMx(firmadoAt)}. ` : ''}{ya ? '' : 'Te mandamos una copia a tu correo. '}
      {pdfUrl ? '' : 'Tu copia en PDF estará lista en unos segundos.'}
      {pdfUrl && (
        <a href={pdfUrl} target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
          <Download className="h-4 w-4" /> Descargar mi copia (PDF)
        </a>
      )}
    </Mensaje>
  );
}

interface Errores { nombre?: string; firma?: string; acepta?: string; general?: string }

function Formulario({ token, datos, onFirmado, onRechazado, onYaResuelto }: {
  token: string; datos: Datos; onFirmado: (firmadoAt: string) => void; onRechazado: () => void; onYaResuelto: () => void;
}) {
  const pad = useRef<SignaturePadHandle>(null);
  const [nombre, setNombre] = useState(datos.nombre);
  const [acepta, setAcepta] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [enviando, setEnviando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviandoRechazo, setEnviandoRechazo] = useState(false);
  const limpio = nombre.replace(/\s+/g, ' ').trim();
  const { texto } = datos;

  const firmar = async () => {
    const e: Errores = {};
    if (limpio.length < 5 || limpio.split(' ').length < 2) e.nombre = 'Escribe tu nombre completo.';
    if (!pad.current || pad.current.isEmpty()) e.firma = 'Dibuja tu firma en el recuadro.';
    if (!acepta) e.acepta = 'Marca que leíste y aceptas el acuerdo.';
    setErrores(e);
    if (Object.keys(e).length) return;
    setEnviando(true);
    try {
      const r = await signNDA({ token, nombre: limpio, firma: pad.current!.toDataURL(), acepta: true });
      onFirmado(r.firmadoAt);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { onYaResuelto(); return; }
      setErrores({ general: err instanceof ApiError && err.status < 500 ? err.message : 'No se pudo enviar tu firma. Revisa tu conexión e inténtalo de nuevo.' });
    } finally {
      setEnviando(false);
    }
  };

  const rechazar = async () => {
    setEnviandoRechazo(true);
    try {
      await rejectNDA({ token, motivo: motivo.trim() || undefined });
      onRechazado();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { onYaResuelto(); return; }
      setRechazando(false);
      setErrores({ general: 'No se pudo registrar tu respuesta. Inténtalo de nuevo.' });
    } finally {
      setEnviandoRechazo(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-slate-600">Lee el acuerdo, confirma tu nombre y firma al final. Toma menos de dos minutos.</p>

      <div>
        <label htmlFor="nda-nombre" className="mb-1.5 block text-sm font-medium text-slate-800">Tu nombre completo</label>
        <Input id="nda-nombre" value={nombre} onChange={(ev) => setNombre(ev.target.value)} autoComplete="name" maxLength={120} className="h-11 text-base" aria-invalid={!!errores.nombre} />
        {errores.nombre && <p className="mt-1.5 text-sm text-red-600">{errores.nombre}</p>}
      </div>

      <article className="rounded-xl border border-[#E4E9F0] bg-[#F9FAFB] px-4 py-5 text-[14px] leading-relaxed text-slate-700 sm:px-5">
        {datos.sesion && <p className="mb-4 rounded-lg bg-[#EAF0F3] px-3 py-2 text-[13px] leading-snug text-slate-800"><b>Sesión:</b> {datos.sesion}</p>}
        <h2 className="mb-3 text-[13px] font-bold leading-snug text-slate-900">{texto.titulo}</h2>
        <p>{texto.aperturaAntes}<b className="text-slate-900">{limpio || '____________'}</b>{texto.aperturaDespues}</p>
        {texto.secciones.map((s) => (
          <section key={s.titulo}>
            <h3 className="mb-1 mt-4 font-bold text-slate-900">{s.titulo}</h3>
            {s.parrafos.map((p) => <p key={p} className="mb-2"><ConLigaDelAviso texto={p} /></p>)}
          </section>
        ))}
      </article>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-800">Tu firma</span>
          <button type="button" onClick={() => { pad.current?.clear(); }} className="text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">Borrar</button>
        </div>
        <SignaturePad ref={pad} onChange={() => setErrores((x) => ({ ...x, firma: undefined }))} />
        {errores.firma && <p className="mt-1.5 text-sm text-red-600">{errores.firma}</p>}
      </div>

      <div>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-800">
          <input type="checkbox" checked={acepta} onChange={(ev) => setAcepta(ev.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-[#0e4b5a]" />
          <span>Leí y acepto el acuerdo.</span>
        </label>
        {errores.acepta && <p className="mt-1.5 text-sm text-red-600">{errores.acepta}</p>}
      </div>

      {errores.general && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errores.general}</p>}

      <div className="space-y-3">
        <Button onClick={firmar} disabled={enviando} className="h-12 w-full bg-[#0e4b5a] text-base font-semibold text-white hover:bg-[#0a3d4a]">
          {enviando ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : 'Firmar y enviar'}
        </Button>
        <button type="button" onClick={() => setRechazando(true)} className="block w-full py-1.5 text-center text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">No acepto</button>
        <p className="text-center text-xs leading-relaxed text-slate-400">Al firmar quedan registrados tu nombre, la fecha y hora, tu dispositivo y tu dirección IP.</p>
      </div>

      <AlertDialog open={rechazando} onOpenChange={(o) => { if (!o && !enviandoRechazo) setRechazando(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿No aceptas el acuerdo?</AlertDialogTitle>
            <AlertDialogDescription>Sin aceptarlo no podrás participar en la sesión. Si quieres, cuéntanos por qué.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={500} rows={3} placeholder="Motivo (opcional)" className="text-base" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviandoRechazo}>Volver al acuerdo</AlertDialogCancel>
            <Button onClick={rechazar} disabled={enviandoRechazo} variant="destructive">{enviandoRechazo ? 'Enviando…' : 'No acepto'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
