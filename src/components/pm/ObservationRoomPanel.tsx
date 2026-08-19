import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Radio, Copy, Eye, EyeOff, ExternalLink, Trash2, Download, Circle } from 'lucide-react';
import { toast } from 'sonner';
import {
  createObservationStream, getObservationSessionDetail, getAblyToken,
  postProducerChatMessage, deleteObservationChatMessage, exportObservationAttendance,
} from 'zite-endpoints-sdk';
import { useObservationChat, type ObservationChatMessage } from '@/hooks/useObservationChat';

interface ObservationSession {
  id: string;
  slug: string;
  estado: 'borrador' | 'esperando' | 'vivo' | 'terminada';
  muxStreamKey?: string;
  muxServerUrl: string;
  muxPlaybackId?: string;
  muxAssetId?: string;
  observationUrl: string;
}

interface ConnectedObserver {
  observerId: string;
  nombre?: string;
  apellido?: string;
  email?: string;
  firstSeenAt: string;
  isOnline: boolean;
}

// Mismo patrón vanilla (Blob + <a download>) que exportRecruitmentCsv en
// RecruitmentPage.tsx — no se agrega una librería nueva para esto.
function escapeCsvCell(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const estadoBadge: Record<string, string> = {
  borrador: 'bg-muted text-muted-foreground',
  esperando: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  vivo: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  terminada: 'bg-muted text-muted-foreground',
};
const estadoLabel: Record<string, string> = {
  borrador: 'Sin iniciar', esperando: 'Esperando', vivo: 'En vivo', terminada: 'Terminada',
};

function copy(value: string, label: string) {
  navigator.clipboard.writeText(value);
  toast.success(`${label} copiado`);
}

export function ObservationRoomPanel({ calendarEventId }: { calendarEventId: string }) {
  const [session, setSession] = useState<ObservationSession | null | undefined>(undefined); // undefined = cargando
  const [messages, setMessages] = useState<ObservationChatMessage[]>([]);
  const [connected, setConnected] = useState<ConnectedObserver[]>([]);
  const [creating, setCreating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await getObservationSessionDetail({ calendarEventId });
      setSession(res.session ?? null);
      setMessages(res.chat ?? []);
      setConnected(res.connected ?? []);
    } catch {
      setSession(null);
      toast.error('No se pudo cargar la Sala de observación');
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [calendarEventId]);

  // Refresca conectados/first-seen cada 30s — el "conectado ahorita" depende
  // de heartbeats que llegan solos, sin evento propio que lo dispare aquí.
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useObservationChat({
    enabled: !!session,
    dependencyKey: session?.id ?? '',
    getToken: async () => {
      if (!session) return null;
      const channel = `observation:${session.id}`;
      const res = await getAblyToken({ channels: [channel] });
      return res.token ? { token: res.token, expires: res.expires, channel } : null;
    },
    onMessage: (msg) => setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])),
    onDeleted: (id) => setMessages((prev) => prev.filter((m) => m.id !== id)),
    onSessionState: (estado) => setSession((prev) => (prev ? { ...prev, estado: estado as ObservationSession['estado'] } : prev)),
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createObservationStream({ calendarEventId });
      await load();
      toast.success('Stream creado ✓');
    } catch {
      toast.error('Error al crear el stream');
    }
    setCreating(false);
  };

  const handleSend = async () => {
    const body = chatInput.trim();
    if (!body) return;
    setChatInput('');
    try {
      await postProducerChatMessage({ calendarEventId, body });
    } catch {
      toast.error('No se pudo enviar el mensaje');
    }
  };

  const handleDelete = async (messageId: string) => {
    try {
      await deleteObservationChatMessage({ calendarEventId, messageId });
    } catch {
      toast.error('No se pudo borrar el mensaje');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await exportObservationAttendance({ calendarEventId });
      const headers = ['Nombre', 'Apellido', 'Email', 'Tramos', 'Horarios', 'Minutos totales'];
      const dataRows = (res.rows ?? []).map((r: any) => [
        r.nombre, r.apellido, r.email, String(r.tramos), r.rangos, String(r.minutosTotales),
      ]);
      const csvContent = [
        headers.map(escapeCsvCell).join(','),
        ...dataRows.map((r: string[]) => r.map(escapeCsvCell).join(',')),
      ].join('\n');
      const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asistencia-sala-observacion-${session?.slug ?? calendarEventId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo exportar la asistencia');
    }
    setExporting(false);
  };

  return (
    <div className="border-t border-border/40 pt-3 mt-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Radio className="w-3.5 h-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold">Sala de observación</Label>
        {session && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${estadoBadge[session.estado]}`}>
            {estadoLabel[session.estado]}
          </span>
        )}
      </div>

      {session === undefined ? (
        <div className="text-xs text-muted-foreground/60 italic">Cargando...</div>
      ) : session === null ? (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleCreate} disabled={creating}>
          {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
          Crear stream
        </Button>
      ) : (
        <>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground w-24 flex-shrink-0">Server URL</span>
              <code className="flex-1 truncate bg-muted px-1.5 py-0.5 rounded text-[11px]">{session.muxServerUrl}</code>
              <button onClick={() => copy(session.muxServerUrl, 'Server URL')} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground w-24 flex-shrink-0">Stream key</span>
              <code className="flex-1 truncate bg-muted px-1.5 py-0.5 rounded text-[11px]">
                {showKey ? session.muxStreamKey : '••••••••••••••••••••••'}
              </code>
              <button onClick={() => setShowKey((v) => !v)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
              <button onClick={() => session.muxStreamKey && copy(session.muxStreamKey, 'Stream key')} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground w-24 flex-shrink-0">Link de observación</span>
              <code className="flex-1 truncate bg-muted px-1.5 py-0.5 rounded text-[11px]">{session.observationUrl}</code>
              <button onClick={() => copy(session.observationUrl, 'Link')} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <Copy className="w-3 h-3" />
              </button>
              <a href={session.observationUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground flex-shrink-0">
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="border-t border-border/30 pt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] text-muted-foreground">Conectados ({connected.filter((c) => c.isOnline).length}/{connected.length})</Label>
              <button
                onClick={handleExport}
                disabled={exporting || connected.length === 0}
                className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-40 disabled:no-underline"
              >
                {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Exportar asistencia
              </button>
            </div>
            {connected.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/50 italic">Nadie se ha registrado aún.</p>
            ) : (
              <div className="max-h-28 overflow-y-auto space-y-1">
                {connected.map((c) => (
                  <div key={c.observerId} className="flex items-center gap-1.5 text-[11px]">
                    <Circle className={`w-2 h-2 flex-shrink-0 ${c.isOnline ? 'fill-green-500 text-green-500' : 'fill-muted-foreground/30 text-muted-foreground/30'}`} />
                    <span className="truncate">{c.nombre} {c.apellido}</span>
                    <span className="text-muted-foreground truncate">{c.email}</span>
                    <span className="text-muted-foreground/60 ml-auto flex-shrink-0">
                      {new Date(c.firstSeenAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border/30 pt-2 space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Chat</Label>
            <div ref={listRef} className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {messages.length === 0 && <p className="text-[11px] text-muted-foreground/50 italic">Sin mensajes aún.</p>}
              {messages.map((m) => (
                <div key={m.id} className="group flex items-start gap-1.5 text-[11px]">
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${m.esProductor ? 'text-amber-600 dark:text-amber-400' : ''}`}>{m.nombre || 'Observador'}</span>
                    <span className="text-muted-foreground ml-1">
                      {new Date(m.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <p className="break-words">{m.body}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive flex-shrink-0"
                    title="Borrar mensaje"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
                placeholder="Escribir como productor..."
                className="flex-1 h-7 px-2 rounded border border-border/50 bg-background text-[11px] outline-none focus:border-primary/50"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
