import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSharedArchivedFile, getSharedArchivedFileUrl } from 'zite-endpoints-sdk';
import { Download, FileAudio, FileVideo, File, Loader2 } from 'lucide-react';
import { formatBytes, groupBy, mediaKind } from '@/components/archivo/utils';

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';
const ICONS = { video: FileVideo, audio: FileAudio, other: File };

interface SharedItem {
  id: string;
  fileName: string;
  folder: string;
  sizeBytes: number;
  contentType?: string;
}

interface SharedContent {
  scope: string;
  title: string;
  allowDownload: boolean;
  expiresAt: string;
  files: SharedItem[];
}

// /grabacion/:token — página pública para clientes (link generado con
// "Compartir con cliente" en el Hub). Sin login: el token es la autorización.
// Un video se reproduce directo; una carpeta o proyecto muestra la lista con
// el reproductor arriba.
export default function SharedRecordingPage() {
  const { token } = useParams();
  const [content, setContent] = useState<SharedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SharedItem | null>(null);
  const [media, setMedia] = useState<{ url: string; downloadUrl?: string } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    getSharedArchivedFile({ token })
      .then((res: SharedContent) => {
        setContent(res);
        if (res.files.length === 1) setSelected(res.files[0]);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Este link no está disponible.'));
  }, [token]);

  useEffect(() => {
    setMedia(null);
    setMediaError(null);
    if (!selected) return;
    getSharedArchivedFileUrl({ token, fileId: selected.id })
      .then(setMedia)
      .catch(err => setMediaError(err instanceof Error ? err.message : 'No se pudo abrir el archivo.'));
  }, [selected, token]);

  const kind = selected ? mediaKind(selected) : 'other';
  const groups = content ? groupBy(content.files, f => f.folder) : [];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="px-4 sm:px-8 py-4 border-b border-white/10">
        <img src={LOGO_URL} alt="Sapience" className="h-7" />
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-6 space-y-4">
        {error && <p className="text-sm text-white/70 py-16 text-center">{error}</p>}
        {!error && !content && (
          <div className="flex items-center justify-center gap-2 text-sm text-white/60 py-16">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {content && (
          <>
            <div>
              <h1 className="text-base sm:text-lg font-semibold break-words">{content.title}</h1>
              <p className="text-xs text-white/50">
                {content.files.length > 1 && `${content.files.length} archivos · `}
                Disponible hasta el {new Date(content.expiresAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>

            {selected && (
              <div className="space-y-2">
                {content.files.length > 1 && <p className="text-sm font-medium break-words">{selected.fileName}</p>}
                {mediaError && <p className="text-sm text-white/70">{mediaError}</p>}
                {!media && !mediaError && (
                  <div className="flex items-center justify-center gap-2 text-sm text-white/60 py-10">
                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                  </div>
                )}
                {media && kind === 'video' && <video key={media.url} src={media.url} controls autoPlay={content.files.length > 1} className="w-full max-h-[70vh] rounded-md bg-black" />}
                {media && kind === 'audio' && <audio key={media.url} src={media.url} controls className="w-full" />}
                {media && kind === 'other' && !media.downloadUrl && (
                  <p className="text-sm text-white/70">Este archivo no se puede previsualizar en el navegador.</p>
                )}
                {media?.downloadUrl && (
                  <a href={media.downloadUrl} className="inline-flex items-center gap-1.5 rounded-md border border-white/20 px-3 py-1.5 text-xs text-white hover:bg-white/10">
                    <Download className="h-3.5 w-3.5" /> Descargar
                  </a>
                )}
              </div>
            )}

            {content.files.length > 1 && (
              <div className="space-y-4 pt-2">
                {groups.map(([folder, items]) => (
                  <div key={folder} className="space-y-1">
                    {folder && <p className="text-[11px] uppercase tracking-widest text-white/50">{folder}</p>}
                    {items.map(f => {
                      const Icon = ICONS[mediaKind(f)];
                      const active = selected?.id === f.id;
                      return (
                        <button
                          key={f.id}
                          onClick={() => { setSelected(f); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          className={`w-full flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                            active ? 'border-white/60 bg-white/10' : 'border-white/10 hover:border-white/30'}`}
                        >
                          <Icon className="h-4 w-4 text-white/60 shrink-0" />
                          <span className="flex-1 min-w-0 break-words">{f.fileName}</span>
                          <span className="text-xs text-white/40 shrink-0">{formatBytes(f.sizeBytes)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <footer className="px-4 py-4 text-center text-[11px] text-white/40">
        Material confidencial compartido por Sapience. No lo reenvíes.
      </footer>
    </div>
  );
}
