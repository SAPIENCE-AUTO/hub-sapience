import { useEffect, useRef, useState } from 'react';
import { getSharpliAppToken } from 'zite-endpoints-sdk';

// Origen real de Sharpli — nunca se responde el handshake a otro origen
// (única defensa real contra filtrar el token a un iframe que no sea este).
// Sharpli ya tiene ZITE_EMBED_ALLOWED_ORIGIN apuntando a localhost:5173
// (valor de desarrollo) — por eso esto ya se puede probar en local.
const SHARPLI_ORIGIN = 'https://sharpli.ai';

export default function SharpliPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== SHARPLI_ORIGIN) return;
      if (e.data?.type !== 'SHARPLI_REQUEST_TOKEN') return;
      getSharpliAppToken({})
        .then(res => {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'SHARPLI_TOKEN', token: res.token },
            SHARPLI_ORIGIN,
          );
        })
        .catch(() => setError('No se pudo generar el token de acceso a Sharpli'));
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {error && (
        <p className="flex-shrink-0 px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20">
          {error}
        </p>
      )}
      <iframe
        ref={iframeRef}
        src={`${SHARPLI_ORIGIN}/embed/app`}
        title="Sharpli"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
