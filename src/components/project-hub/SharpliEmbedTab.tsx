import { useEffect, useRef, useState } from 'react';
import { getSharpliProjectToken } from 'zite-endpoints-sdk';

// Mismo origen real y mismo criterio de seguridad que SharpliPage.tsx
// (nivel 1, app completa) — nunca responder el handshake a otro origen.
const SHARPLI_ORIGIN = 'https://sharpli.ai';

interface Props {
  projectName: string;
  brandName: string;
}

export default function SharpliEmbedTab({ projectName, brandName }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== SHARPLI_ORIGIN) return;
      if (e.data?.type !== 'SHARPLI_REQUEST_TOKEN') return;
      // projectName/brandName ya los sabe este componente (son los mismos
      // con los que se armó el src del iframe) — no hace falta confiar en
      // los que venga en el mensaje, solo en que el origen sea el correcto.
      getSharpliProjectToken({ projectName, brandName })
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
  }, [projectName, brandName]);

  const src = `${SHARPLI_ORIGIN}/embed/project?projectName=${encodeURIComponent(projectName)}&brandName=${encodeURIComponent(brandName)}`;

  return (
    <div className="h-full flex flex-col">
      {error && (
        <p className="flex-shrink-0 px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20">
          {error}
        </p>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        title="Sharpli"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
