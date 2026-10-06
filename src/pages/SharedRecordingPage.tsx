import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSharedArchivedFile } from 'zite-endpoints-sdk';
import { Download, Loader2 } from 'lucide-react';
import { mediaKind } from '@/components/archivo/utils';

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

interface SharedFile {
  fileName: string;
  contentType?: string;
  url: string;
  downloadUrl?: string;
  expiresAt: string;
}

// /grabacion/:token — página pública para clientes (link generado con
// "Compartir con cliente" en el Hub). Sin login: el token es la autorización.
export default function SharedRecordingPage() {
  const { token } = useParams();
  const [file, setFile] = useState<SharedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSharedArchivedFile({ token })
      .then(setFile)
      .catch(err => setError(err instanceof Error ? err.message : 'Este link no está disponible.'));
  }, [token]);

  const kind = file ? mediaKind(file) : 'other';

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="px-4 sm:px-8 py-4 border-b border-white/10">
        <img src={LOGO_URL} alt="Sapience" className="h-7" />
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-6 space-y-4">
        {error && <p className="text-sm text-white/70 py-16 text-center">{error}</p>}
        {!error && !file && (
          <div className="flex items-center justify-center gap-2 text-sm text-white/60 py-16">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {file && (
          <>
            <h1 className="text-base sm:text-lg font-semibold break-words">{file.fileName}</h1>
            {kind === 'video' && <video src={file.url} controls className="w-full max-h-[75vh] rounded-md bg-black" />}
            {kind === 'audio' && <audio src={file.url} controls className="w-full" />}
            {kind === 'other' && !file.downloadUrl && (
              <p className="text-sm text-white/70">Este archivo no se puede previsualizar en el navegador.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/50">
              <span>
                Disponible hasta el {new Date(file.expiresAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              {file.downloadUrl && (
                <a href={file.downloadUrl} className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-1.5 text-white hover:bg-white/10">
                  <Download className="h-3.5 w-3.5" /> Descargar
                </a>
              )}
            </div>
          </>
        )}
      </main>
      <footer className="px-4 py-4 text-center text-[11px] text-white/40">
        Material confidencial compartido por Sapience. No lo reenvíes.
      </footer>
    </div>
  );
}
