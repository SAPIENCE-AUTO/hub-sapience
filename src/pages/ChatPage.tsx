import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../context/ProjectContext';
import {
  getMessages, searchMessages, sendMessage, getTeamMembers, getProjectDocuments,
  toggleReaction, togglePinMessage, saveTask,
  getChatConversations, saveChatConversation,
  updatePresence, getPresence, votePoll,
  publishTyping,
  GetMessagesOutputType, GetTeamMembersOutputType, GetChatConversationsOutputType,
} from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import { useRealtimeChannel } from '../hooks/useRealtimeChannel';
import { getReferenceOptionsCached } from '../lib/referenceOptionsCache';

import { uploadFile } from 'zite-file-upload-sdk';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Hash, Send, MessageSquare, Search, X, Pin, Smile, FileText,
  Reply, Paperclip, Bold, Italic, Strikethrough, Download,
  Mic, Play, Pause, Bell, BellOff, Link as LinkIcon, Image, FolderOpen, CheckSquare, Calendar as CalendarIcon,
  Plus, Users, MessageCircle, ChevronDown, ChevronRight, BarChart3, Trash2, Star, ExternalLink, ArrowLeft,
} from 'lucide-react';
import { PollCard, parsePoll, type PollData } from '@/components/PollCard';
import { TimelinePreviewDialog } from '@/components/TimelinePreviewDialog';
import { toast } from 'sonner';
import { parseReactions, parseAttachments, serializeReactions, serializeAttachments, type Reactions, type Attachment } from '../lib/chatJson';

type Message = GetMessagesOutputType['messages'][0];
type TeamMember = GetTeamMembersOutputType['members'][0];
type DMConv = GetChatConversationsOutputType['dms'][0];
type ProjectDoc = { id: string; documentName?: string; fileUrl?: string; category?: string; };
type GroupConv = GetChatConversationsOutputType['groups'][0];

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '✅', '👀'];

const EMOJI_CATEGORIES: Record<string, string[]> = {
  'Caritas':  ['😀','😂','🥰','😎','🤩','😭','🥺','😤','🤯','🫡'],
  'Manos':    ['👍','👎','👏','🙌','💪','🤝','✌️','🫶','👋','🤙'],
  'Símbolos': ['❤️','🔥','⭐','💯','✨','🎉','🎊','💀','☠️','💩'],
  'Objetos':  ['🚀','💡','📌','📎','🎯','🏆','🎁','📣','🔔','🎵'],
};

const STICKERS = [
  '😀','🎉','🔥','👍','❤️','🤣','😎','🙌','💪','🎊',
  '👏','🥳','🤩','💯','✨','🫡','🤝','🙏','😂','🥰',
  '🚀','⭐','🏆','🎯','💡','🫶','🥺','😭','🤯','💀',
];

// ── Module-level messages cache ───────────────────────────────────────────────
// Antes crecía sin límite: una entrada por cada canal visitado en la sesión,
// nunca se liberaba. En una sesión larga navegando muchos canales/DMs esto
// acumula memoria indefinidamente. Se acota a los MAX_CACHED_CHANNELS canales
// usados más recientemente (LRU aproximado: cada set/get reinserta la key al
// final del Map, que preserva orden de inserción; se evict la primera —
// la menos recientemente usada — al pasarse del límite).
const MAX_CACHED_CHANNELS = 20;
const messagesCache = new Map<string, Message[]>();
function getCachedMessages(channel: string): Message[] | undefined {
  const cached = messagesCache.get(channel);
  if (cached) { messagesCache.delete(channel); messagesCache.set(channel, cached); }
  return cached;
}
function cacheMessages(channel: string, messages: Message[]) {
  messagesCache.delete(channel);
  messagesCache.set(channel, messages);
  if (messagesCache.size > MAX_CACHED_CHANNELS) {
    const lru = messagesCache.keys().next().value;
    if (lru !== undefined) messagesCache.delete(lru);
  }
}
let cachedDms: DMConv[] | null = null;
let cachedGroups: GroupConv[] | null = null;
let cachedTeamMembers: TeamMember[] | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function markRead(channel: string) {
  const stored: Record<string, string> = JSON.parse(localStorage.getItem('chat-last-read') ?? '{}');
  stored[channel] = new Date().toISOString();
  localStorage.setItem('chat-last-read', JSON.stringify(stored));
}

function clearUnreadForChannel(channel: string) {
  try {
    const stored = JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}');
    stored[channel] = 0;
    localStorage.setItem('chat-unread-counts', JSON.stringify(stored));
  } catch {
    localStorage.setItem('chat-unread-counts', JSON.stringify({ [channel]: 0 }));
  }
}

function clearMentionForChannel(channel: string) {
  try {
    const stored = JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]');
    const next = Array.isArray(stored) ? stored.filter((c: string) => c !== channel) : [];
    localStorage.setItem('chat-mention-channels', JSON.stringify(next));
  } catch {
    localStorage.setItem('chat-mention-channels', JSON.stringify([]));
  }
}

// ── Draft persistence helpers ─────────────────────────────────────────────────
function getDraftKey(channel: string) { return 'chat-draft-' + channel; }
function loadDraft(channel: string): string {
  try { return localStorage.getItem(getDraftKey(channel)) ?? ''; } catch { return ''; }
}
function saveDraft(channel: string, text: string) {
  try {
    if (text) localStorage.setItem(getDraftKey(channel), text);
    else localStorage.removeItem(getDraftKey(channel));
  } catch {}
}

function extractPlainUrls(text: string): string[] {
  const cleaned = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '');
  const matches = cleaned.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) ?? [];
  return [...new Set(matches)].slice(0, 2);
}

function isStickerMessage(content?: string | null): boolean {
  if (!content) return false;
  const t = content.trim();
  if (!t || t.length > 8) return false;
  try {
    return /^(\p{Extended_Pictographic}(\uFE0F)?(\u200D\p{Extended_Pictographic}(\uFE0F)?)*)+$/u.test(t);
  } catch { return false; }
}



function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`#]/g, '')
    .trim()
    .slice(0, 120);
}

// ── Message dedupe helpers ────────────────────────────────────────────────────
function getMessageDedupeKey(m: Message): string {
  return [
    m.channel ?? '',
    m.senderEmail ?? '',
    (m.content ?? '').trim(),
    m.parentMessageId ?? '',
    JSON.stringify(m.attachments ?? ''),
  ].join('|');
}

function mergeMessagesReplacingOptimistic(prev: Message[], incoming: Message[]): Message[] {
  const incomingKeys = new Set(incoming.map(getMessageDedupeKey));
  // Los optimistic-* todavía no traen el id real del servidor (normalmente sí
  // lo tienen ya, ver handleSend/handleSendAudio/handleSendSticker, que lo
  // estampan en cuanto sendMessage() responde — esto es solo la red de
  // seguridad para la carrera rara donde el evento realtime llega antes que
  // esa respuesta), así que a ellos se les hace match por contenido.
  const withoutMatchedOptimistic = prev.filter(p => {
    if (!String(p.id ?? '').startsWith('optimistic-')) return true;
    return !incomingKeys.has(getMessageDedupeKey(p));
  });
  // El dedupe de mensajes YA confirmados es solo por id. Antes también se
  // comparaba por contenido contra todo `prev` — eso descartaba en silencio
  // un segundo mensaje real con el mismo texto (ej. alguien escribe "ok" dos
  // veces), no solo duplicados legítimos.
  const existingIds = new Set(withoutMatchedOptimistic.map(m => m.id));
  const newMessages = incoming.filter(m => !existingIds.has(m.id));
  return [...withoutMatchedOptimistic, ...newMessages].sort((a, b) =>
    new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime()
  );
}

// ── Avatar gradient helpers ───────────────────────────────────────────────────
const AVATAR_GRADIENTS: [string, string][] = [
  ['hsl(220,85%,55%)', 'hsl(250,80%,65%)'],
  ['hsl(260,75%,60%)', 'hsl(290,70%,65%)'],
  ['hsl(340,80%,55%)', 'hsl(10,85%,60%)'],
  ['hsl(15,90%,55%)',  'hsl(35,90%,55%)'],
  ['hsl(160,70%,38%)', 'hsl(190,75%,45%)'],
  ['hsl(185,80%,40%)', 'hsl(215,80%,55%)'],
  ['hsl(40,90%,48%)',  'hsl(20,90%,55%)'],
  ['hsl(280,75%,58%)', 'hsl(320,75%,60%)'],
  ['hsl(320,75%,55%)', 'hsl(350,80%,60%)'],
  ['hsl(100,60%,38%)', 'hsl(145,65%,42%)'],
  ['hsl(195,85%,42%)', 'hsl(225,80%,58%)'],
  ['hsl(25,85%,50%)',  'hsl(50,90%,48%)'],
  ['hsl(350,80%,52%)', 'hsl(280,75%,60%)'],
  ['hsl(150,65%,36%)', 'hsl(175,75%,42%)'],
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function avatarGradientStyle(email?: string, name?: string): React.CSSProperties {
  const key = email ?? name ?? '?';
  const [from, to] = AVATAR_GRADIENTS[hashStr(key) % AVATAR_GRADIENTS.length];
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, email, size = 8, photoUrl }: { name?: string; email?: string; size?: number; photoUrl?: string }) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [photoUrl]);
  const initial = name?.[0]?.toUpperCase() ?? email?.[0]?.toUpperCase() ?? '?';
  const px = size * 4;
  const gradient = avatarGradientStyle(email, name);
  const fallback = (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{ width: px, height: px, fontSize: size < 8 ? '10px' : '12px', color: '#fff', ...gradient }}
    >
      {initial}
    </div>
  );
  if (photoUrl && !imgError) {
    return (
      <img src={photoUrl} alt={name ?? email ?? '?'}
        className="rounded-full object-cover flex-shrink-0 border border-border/20"
        style={{ width: px, height: px }}
        onError={() => setImgError(true)} />
    );
  }
  return fallback;
}

// ── New DM Dialog ──────────────────────────────────────────────────────────────
function NewDMDialog({ open, onClose, teamMembers, myEmail, onCreate }: {
  open: boolean; onClose: () => void;
  teamMembers: TeamMember[]; myEmail: string;
  onCreate: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const others = teamMembers.filter(m => m.email && m.email !== myEmail);

  const handleSelect = async (email: string) => {
    setCreating(true);
    try {
      const res = await saveChatConversation({ type: 'dm', targetEmail: email });
      onCreate(res.id);
      onClose();
    } catch { toast.error('Error al crear conversación'); }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="w-4 h-4 text-primary" />
            Nuevo mensaje directo
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground mb-2">Selecciona un miembro del equipo:</p>
        <ScrollArea className="max-h-72">
          <div className="space-y-1 pr-1">
            {others.map(m => {
              const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?';
              return (
                <button key={m.id} onClick={() => handleSelect(m.email!)} disabled={creating}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted transition-colors text-left disabled:opacity-50">
                  <Avatar name={name} email={m.email} size={8} photoUrl={m.profilePhoto ?? undefined} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                  </div>
                </button>
              );
            })}
            {others.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No hay otros miembros del equipo</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ── New Group Dialog ───────────────────────────────────────────────────────────
function NewGroupDialog({ open, onClose, teamMembers, myEmail, onCreate }: {
  open: boolean; onClose: () => void;
  teamMembers: TeamMember[]; myEmail: string;
  onCreate: (id: string) => void;
}) {
  const [groupName, setGroupName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const others = teamMembers.filter(m => m.email && m.email !== myEmail);

  useEffect(() => { if (!open) { setGroupName(''); setSelected(new Set()); } }, [open]);

  const toggle = (email: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(email)) next.delete(email); else next.add(email);
    return next;
  });

  const handleCreate = async () => {
    if (!groupName.trim()) return;
    setCreating(true);
    try {
      const res = await saveChatConversation({
        type: 'group',
        groupName: groupName.trim(),
        memberEmails: [...selected],
      });
      onCreate(res.id);
      onClose();
    } catch { toast.error('Error al crear grupo'); }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="w-4 h-4 text-primary" />
            Nuevo grupo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Nombre del grupo</Label>
            <Input
              value={groupName} onChange={e => setGroupName(e.target.value)}
              placeholder="Ej: Equipo diseño..." className="h-9 text-sm"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Miembros ({selected.size} seleccionados)</Label>
            <ScrollArea className="max-h-52 border border-border rounded-lg">
              <div className="p-2 space-y-0.5">
                {others.map(m => {
                  const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?';
                  const checked = selected.has(m.email!);
                  return (
                    <button key={m.id} onClick={() => toggle(m.email!)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted transition-colors text-left">
                      <Checkbox checked={checked} onCheckedChange={() => toggle(m.email!)} className="flex-shrink-0" />
                      <Avatar name={name} email={m.email} size={6} photoUrl={m.profilePhoto ?? undefined} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{name}</div>
                        <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>Cancelar</Button>
          <Button size="sm" onClick={handleCreate} disabled={creating || !groupName.trim()} className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {creating ? 'Creando...' : 'Crear grupo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Poll Dialog ────────────────────────────────────────────────────────
function CreatePollDialog({ open, onClose, onSend }: {
  open: boolean; onClose: () => void;
  onSend: (pollContent: string) => void;
}) {
  const { user } = useAuth();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) { setQuestion(''); setOptions(['', '']); setSending(false); }
  }, [open]);

  const updateOption = (i: number, val: string) => {
    setOptions(prev => prev.map((o, idx) => idx === i ? val : o));
  };

  const addOption = () => {
    if (options.length < 6) setOptions(prev => [...prev, '']);
  };

  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    setOptions(prev => prev.filter((_, idx) => idx !== i));
  };

  const canCreate = question.trim() && options.filter(o => o.trim()).length >= 2;

  const handleCreate = async () => {
    if (!canCreate) return;
    setSending(true);
    const cleanOptions = options.filter(o => o.trim());
    const poll: PollData = {
      type: 'poll',
      question: question.trim(),
      options: cleanOptions,
      votes: Object.fromEntries(cleanOptions.map(o => [o, []])),
      creatorName: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.email || '',
      creatorEmail: user?.email ?? '',
    };
    onSend(JSON.stringify(poll));
    onClose();
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4 text-primary" />
            Nueva encuesta
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Pregunta</Label>
            <Input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="¿Cuál es tu pregunta?"
              className="h-9 text-sm"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && canCreate) handleCreate(); }}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Opciones ({options.length}/6)</Label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">
                    {String.fromCharCode(65 + i)}
                  </div>
                  <Input
                    value={opt}
                    onChange={e => updateOption(i, e.target.value)}
                    placeholder={`Opción ${String.fromCharCode(65 + i)}`}
                    className="h-8 text-sm flex-1"
                  />
                  <button
                    onClick={() => removeOption(i)}
                    disabled={options.length <= 2}
                    className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {options.length < 6 && (
              <button
                onClick={addOption}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar opción
              </button>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button size="sm" onClick={handleCreate} disabled={!canCreate || sending} className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            {sending ? 'Creando...' : 'Crear encuesta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Audio Player ──────────────────────────────────────────────────────────────
function AudioPlayer({ url, isOwn = false }: { url: string; isOwn?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => { setPlaying(false); setProgress(0); setCurrentTime(0); };
    const onTime = () => { setCurrentTime(a.currentTime); if (a.duration) setProgress((a.currentTime / a.duration) * 100); };
    const onMeta = () => setDuration(a.duration || 0);
    a.addEventListener('ended', onEnded);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    return () => { a.removeEventListener('ended', onEnded); a.removeEventListener('timeupdate', onTime); a.removeEventListener('loadedmetadata', onMeta); };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const c = isOwn
    ? { btn: 'bg-primary-foreground/20 hover:bg-primary-foreground/30', icon: 'text-primary-foreground', bar: 'bg-primary-foreground', track: 'bg-primary-foreground/25', time: 'text-primary-foreground/70' }
    : { btn: 'bg-primary/15 hover:bg-primary/25', icon: 'text-primary', bar: 'bg-primary', track: 'bg-muted', time: 'text-muted-foreground' };

  return (
    <div className="flex items-center gap-2 mt-2 min-w-[175px] max-w-[210px]">
      <audio ref={audioRef} src={url} preload="metadata" />
      <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${c.btn}`}>
        {playing ? <Pause className={`w-3.5 h-3.5 ${c.icon}`} /> : <Play className={`w-3.5 h-3.5 ${c.icon} ml-0.5`} />}
      </button>
      <div className="flex-1 space-y-0.5 min-w-0">
        <div className={`h-1.5 rounded-full overflow-hidden cursor-pointer ${c.track}`} onClick={seek}>
          <div className={`h-full rounded-full transition-all ${c.bar}`} style={{ width: `${progress}%` }} />
        </div>
        <div className={`text-[10px] tabular-nums ${c.time}`}>🎙 {playing ? fmt(currentTime) : fmt(duration)}</div>
      </div>
    </div>
  );
}

// ── Link Preview ──────────────────────────────────────────────────────────────
function LinkPreview({ url }: { url: string }) {
  let domain = url;
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /**/ }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2 mt-1.5 px-3 py-2 bg-muted/30 border border-border/40 rounded-lg text-xs hover:bg-muted/50 transition-colors max-w-[280px]">
      <LinkIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold truncate">{domain}</div>
        <div className="text-muted-foreground truncate">{url}</div>
      </div>
    </a>
  );
}

// ── Attachment display ────────────────────────────────────────────────────────
function AttachmentDisplay({ attachments, isOwn = false }: { attachments: Attachment[]; isOwn?: boolean }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a, i) => {
        const isAudio = a.type.startsWith('audio/') || /\.(webm|mp3|ogg|wav|m4a)$/i.test(a.name);
        const isImage = !isAudio && (a.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(a.name));
        if (isAudio) return <AudioPlayer key={i} url={a.url} isOwn={isOwn} />;
        if (isImage) return (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
            <img src={a.url} alt={a.name} className="max-w-[220px] max-h-[160px] rounded-lg border border-border/30 object-cover hover:opacity-90 transition-opacity" />
          </a>
        );
        return (
          <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 bg-background/30 border border-border/40 rounded-lg text-xs hover:bg-background/50 transition-colors max-w-[200px]">
            <Download className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{a.name}</span>
          </a>
        );
      })}
    </div>
  );
}

// ── Reaction bar ──────────────────────────────────────────────────────────────
function ReactionBar({ reactions, myEmail, msgId, onToggle, nameMap }: {
  reactions: Reactions; myEmail: string; msgId: string;
  onToggle: (id: string, emoji: string) => void;
  nameMap: Record<string, string>;
}) {
  const entries = Object.entries(reactions).filter(([, u]) => u.length > 0);
  if (!entries.length) return null;
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-wrap gap-1 mt-1">
        {entries.map(([emoji, users]) => (
          <Tooltip key={emoji}>
            <TooltipTrigger asChild>
              <button onClick={() => onToggle(msgId, emoji)}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  users.includes(myEmail) ? 'bg-primary/15 border-primary/40 text-primary font-semibold' : 'bg-muted border-border hover:bg-muted/80'
                }`}>
                {emoji} {users.length}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-white border border-border/50 shadow-lg rounded-lg px-3 py-2">
              <div className="space-y-0.5">
                {users.map(u => (
                  <div key={u} className="text-xs text-primary flex items-center gap-1.5">
                    <span className="text-primary/40">•</span>
                    {nameMap[u] || u.split('@')[0]}
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}



// ── Create Task from Message Dialog ──────────────────────────────────────────
function CreateTaskFromMessageDialog({
  open, onClose, message, activeChannel, projectChannels, teamMembers,
}: {
  open: boolean; onClose: () => void; message: Message | null;
  activeChannel: string; projectChannels: string[]; teamMembers: TeamMember[];
}) {
  const defaultProject = projectChannels.includes(activeChannel) ? activeChannel : '';
  const [taskName, setTaskName] = useState('');
  const [project, setProject] = useState(defaultProject);
  const [assignedTo, setAssignedTo] = useState('');
  const [status, setStatus] = useState('Pendiente');
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !message) return;
    const cleaned = message.content && message.content.trim() !== ' ' ? stripMarkdown(message.content) : '';
    setTaskName(cleaned);
    setProject(projectChannels.includes(activeChannel) ? activeChannel : '');
    setAssignedTo(''); setStatus('Pendiente'); setStartDate(''); setEndDate('');
    const fecha = message.sentAt
      ? new Date(message.sentAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'fecha desconocida';
    setNotes(`Creado desde chat #${activeChannel} por ${message.senderName ?? 'desconocido'} el ${fecha}`);
    setSaving(false);
  }, [open, message, activeChannel, projectChannels]);

  const handleSave = async () => {
    if (!taskName.trim()) return;
    setSaving(true);
    try {
      await saveTask({ taskName: taskName.trim(), projectCode: project || undefined, status, assignedTo: assignedTo || undefined, startDate: startDate || undefined, endDate: endDate || undefined, notes: notes || undefined });
      toast.success(`Tarea creada: ${taskName.trim()}`);
      onClose();
    } catch { toast.error('Error al crear la tarea'); }
    setSaving(false);
  };

  const preview = message?.content && message.content.trim() !== ' '
    ? message.content.slice(0, 160) + (message.content.length > 160 ? '…' : '')
    : '📎 archivo adjunto';
  const sentTime = message?.sentAt ? new Date(message.sentAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CheckSquare className="w-4 h-4 text-primary" />
            Crear tarea desde mensaje
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="bg-muted/50 border border-border/50 rounded-lg px-3 py-2.5 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground/70">{message?.senderName}</span>
              <span>·</span><span>{sentTime}</span>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3">{preview}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Nombre de la tarea</Label>
            <input className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md outline-none focus:ring-1 focus:ring-primary/30 transition-shadow"
              value={taskName} onChange={e => setTaskName(e.target.value)} placeholder="Nombre de la tarea..." autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Proyecto</Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Sin proyecto" /></SelectTrigger>
                <SelectContent>
                  {projectChannels.map(p => <SelectItem key={p} value={p} className="text-xs">#{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pendiente" className="text-xs">Pendiente</SelectItem>
                  <SelectItem value="En progreso" className="text-xs">En progreso</SelectItem>
                  <SelectItem value="Completada" className="text-xs">Completada</SelectItem>
                  <SelectItem value="Bloqueada" className="text-xs">Bloqueada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[['Fecha inicio', startDate, setStartDate], ['Fecha fin', endDate, setEndDate]].map(([label, val, set]) => (
              <div key={label as string} className="space-y-1.5">
                <Label className="text-xs font-medium">{label as string}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="w-full flex items-center gap-2 px-3 py-2 h-9 text-xs bg-background border border-border rounded-md hover:bg-muted transition-colors text-left">
                      <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className={(val as string) ? 'text-foreground' : 'text-muted-foreground'}>
                        {(val as string) ? new Date((val as string) + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Seleccionar...'}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={(val as string) ? new Date((val as string) + 'T12:00:00') : undefined}
                      onSelect={(d) => { if (d) (set as (v: string) => void)(d.toISOString().split('T')[0]); }} />
                  </PopoverContent>
                </Popover>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Asignar a</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                {teamMembers.map(m => {
                  const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?';
                  return <SelectItem key={m.id} value={name} className="text-xs">{name}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notas</Label>
            <Textarea className="text-xs min-h-[60px] resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas opcionales..." />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !taskName.trim()} className="gap-1.5">
            <CheckSquare className="w-3.5 h-3.5" />
            {saving ? 'Creando...' : 'Crear tarea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single message ────────────────────────────────────────────────────────────
const MessageItem = memo(function MessageItem({ msg, isOwn, myEmail, onReply, onPin, onReact, onCreateTask, onVote, parentMsg, senderPhotoUrl, onDocClick, nameMap, activeChannel, isActiveActions, onActivate }: {
  msg: Message; isOwn: boolean; myEmail: string;
  onReply: (m: Message) => void; onPin: (id: string) => void;
  onReact: (id: string, emoji: string) => void; onCreateTask: (m: Message) => void;
  onVote: (msgId: string, option: string) => void; parentMsg?: Message; senderPhotoUrl?: string;
  onDocClick?: (docId: string, docName: string) => void;
  nameMap: Record<string, string>;
  activeChannel?: string;
  isActiveActions?: boolean;
  onActivate?: (id: string) => void;
}) {
  const quotedMessage = parentMsg ? { senderName: parentMsg.senderName ?? undefined, content: parentMsg.content ?? undefined } : undefined;
  const navigate = useNavigate();
  const [emojiPopoverOpen, setEmojiPopoverOpen] = useState(false);
  const time = msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
  const reactions = parseReactions(msg.reactions);
  const attachments = parseAttachments(msg.attachments);
  const poll = parsePoll(msg.content);
  const isSticker = !poll && isStickerMessage(msg.content);
  const urls = !isSticker && msg.content && msg.content.trim() !== ' ' ? extractPlainUrls(msg.content) : [];
  const isRead = msg.sentAt ? (Date.now() - new Date(msg.sentAt).getTime()) > 30000 : false;

  return (
    <div className={`group flex gap-3 px-4 py-1 hover:bg-muted/20 relative ${isOwn ? 'flex-row-reverse' : ''}`} onClick={() => onActivate?.(msg.id)}>
      {!isOwn && <Avatar name={msg.senderName ?? undefined} email={msg.senderEmail ?? undefined} photoUrl={senderPhotoUrl} />}
      <div className={`flex flex-col max-w-[85%] md:max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
        {quotedMessage && (
          <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1 max-w-full`}>
            <div className={`border-l-2 border-primary/40 rounded-lg px-2.5 py-1.5 cursor-pointer max-w-[90%] ${isOwn ? 'bg-primary-foreground/10' : 'bg-muted/50'}`}>
              <div className="text-[11px] font-semibold text-primary/80 truncate">{quotedMessage.senderName}</div>
              <div className="text-[11px] text-muted-foreground">
                {!quotedMessage.content?.trim() || quotedMessage.content.trim() === ' ' ? '📎 Archivo adjunto' : quotedMessage.content}
              </div>
            </div>
          </div>
        )}
        {!isOwn && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-xs font-semibold">{msg.senderName}</span>
            <span className="text-xs text-muted-foreground">{time}</span>
            {msg.pinned && <Pin className="w-3 h-3 text-amber-500" />}
          </div>
        )}
        {poll ? (
          <PollCard poll={poll} myEmail={myEmail} onVote={opt => onVote(msg.id, opt)} isOwn={isOwn} />
        ) : isSticker ? (
          <div className="text-5xl leading-none py-1 px-1 select-none">{msg.content?.trim()}</div>
        ) : (
          <div className={`px-3 py-2 rounded-2xl text-sm ${isOwn ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted text-foreground rounded-tl-sm'}`}>
            {msg.content && msg.content.trim() !== ' ' && (() => {
              const content = msg.content!;
              const mdClass = `prose-sm max-w-none leading-relaxed [&_p]:my-0.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ${isOwn ? 'prose-invert [&_*]:!text-primary-foreground' : ''}`;
              const taskRe = /\[✅\s*([^\]]+)\]\(task:([^)]+)\)/g;
              const mentionRe = /\[#([^\]]+)\]\(\/operacion\/proyectos\/([^)]+)\)/g;
              const docRe = /\$\[([^\]]+)\]\(doc:([^)]+)\)/g;
              const personRe = /\[@([^\]]+)\]\(mention:([^)]+)\)/g;
              const eventRe = /\[📅\s*([^\]]+)\]\(event:([^)]+)\)/g;
              const hasMentions = taskRe.test(content) || mentionRe.test(content) || docRe.test(content) || personRe.test(content) || eventRe.test(content);
              taskRe.lastIndex = 0; mentionRe.lastIndex = 0; docRe.lastIndex = 0; personRe.lastIndex = 0; eventRe.lastIndex = 0;
              if (!hasMentions) return <Markdown className={mdClass}>{content.replace(/\n/g, '\n\n')}</Markdown>;
              // Tokenize: split by task chips, project mentions and doc mentions
              const allTokenRe = /(\[✅\s*([^\]]+)\]\(task:([^)]+)\)|\[#([^\]]+)\]\(\/operacion\/proyectos\/([^)]+)\)|\$\[([^\]]+)\]\(doc:([^)]+)\)|\[@([^\]]+)\]\(mention:([^)]+)\)|\[📅\s*([^\]]+)\]\(event:([^)]+)\))/g;
              allTokenRe.lastIndex = 0;
              const parts: React.ReactNode[] = [];
              let last = 0; let m;
              while ((m = allTokenRe.exec(content)) !== null) {
                if (m.index > last) {
                  const gap = content.slice(last, m.index);
                  if (/^\s*$/.test(gap)) {
                    parts.push(<span key={`t${last}`}> </span>);
                  } else {
                    parts.push(<Markdown key={`t${last}`} className={mdClass}>{gap.replace(/\n/g, '\n\n')}</Markdown>);
                  }
                }
                if (m[0].startsWith('[✅')) {
                  const taskName = m[2].trim();
                  parts.push(
                    <button key={`task${m.index}`}
                      onClick={() => activeChannel && navigate(`/operacion/proyectos/${activeChannel}?tab=timeline`)}
                      className={`text-[11px] px-1.5 py-0.5 rounded-md font-semibold cursor-pointer inline-flex items-center gap-0.5 transition-colors ${isOwn ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30' : 'bg-chart-3/12 text-chart-3 hover:bg-chart-3/20'}`}>
                      ✅ {taskName}
                    </button>
                  );
                  last = m.index + m[0].length;
                } else if (m[0].startsWith('$[')) {
                  const docName = m[6]; const docId = m[7];
                  parts.push(
                    <button key={`doc${m.index}`}
                      onClick={() => docId && onDocClick?.(docId, docName)}
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md cursor-pointer transition-colors ${isOwn ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30' : 'bg-chart-2/10 text-chart-2 hover:bg-chart-2/20'}`}>
                      <FileText className="w-3 h-3 flex-shrink-0" />{docName}
                    </button>
                  );
                  last = m.index + m[0].length;
                } else if (m[0].startsWith('[@')) {
                  const personName = m[8];
                  parts.push(
                    <span key={`person${m.index}`}
                      className={`text-[11px] px-1.5 py-0.5 rounded-md font-semibold inline-flex items-center gap-0.5 ${isOwn ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-destructive/15 text-destructive'}`}>
                      @{personName}
                    </span>
                  );
                  last = m.index + m[0].length;
                } else if (m[0].includes('(event:')) {
                  const eventName = m[10];
                  parts.push(
                    <button key={`evt${m.index}`}
                      onClick={() => activeChannel && navigate(`/operacion/proyectos/${activeChannel}?tab=calendar`)}
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md cursor-pointer transition-colors ${isOwn ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30' : 'bg-chart-4/10 text-chart-4 hover:bg-chart-4/20'}`}>
                      <CalendarIcon className="w-3 h-3 flex-shrink-0" />{eventName}
                    </button>
                  );
                  last = m.index + m[0].length;
                } else {
                  const code = m[4]; const path = `/operacion/proyectos/${m[5]}`;
                  parts.push(
                  <button key={`p${m.index}`} onClick={() => navigate(path)}
                    className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md cursor-pointer transition-colors ${isOwn ? 'bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}>
                    <Hash className="w-3 h-3" />{code}
                  </button>
                );
                last = m.index + m[0].length;
              }
              }
              if (last < content.length) parts.push(<Markdown key={`t${last}`} className={mdClass}>{content.slice(last).replace(/\n/g, '\n\n')}</Markdown>);
              return <>{parts}</>;
            })()}
            <AttachmentDisplay attachments={attachments} isOwn={isOwn} />
          </div>
        )}
        {urls.map(url => <LinkPreview key={url} url={url} />)}
        {isOwn && (
          <div className="flex items-center gap-1 mt-0.5">
            {msg.pinned && <Pin className="w-3 h-3 text-amber-500" />}
            <span className="text-xs text-muted-foreground">{time}</span>
            <span className={`text-[11px] leading-none font-medium ${isRead ? 'text-primary' : 'text-muted-foreground/50'}`}>
              {isRead ? '✓✓' : '✓'}
            </span>
          </div>
        )}
        <ReactionBar reactions={reactions} myEmail={myEmail} msgId={msg.id} onToggle={onReact} nameMap={nameMap} />
      </div>
      <div className={`absolute top-1 ${isOwn ? 'left-4' : 'right-4'} ${emojiPopoverOpen || isActiveActions ? 'flex' : 'hidden group-hover:flex'} items-center gap-0.5 bg-card border border-border rounded-lg shadow-sm px-1 py-0.5 z-10`}>
        <Popover open={emojiPopoverOpen} onOpenChange={setEmojiPopoverOpen}>
          <PopoverTrigger asChild>
            <button className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
              <Smile className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-auto p-1 flex gap-0.5">
            {QUICK_EMOJIS.map(e => (
              <button key={e} onClick={() => onReact(msg.id, e)} className="text-base hover:scale-125 transition-transform p-1 rounded hover:bg-muted">{e}</button>
            ))}
          </PopoverContent>
        </Popover>
        <button onClick={() => onReply(msg)} title="Responder" className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground">
          <Reply className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onPin(msg.id)} title={msg.pinned ? 'Desfijar' : 'Fijar'}
          className={`p-1 hover:bg-muted rounded transition-colors ${msg.pinned ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground'}`}>
          <Pin className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-3.5 bg-border/60 mx-0.5" />
        <button onClick={() => onCreateTask(msg)} title="Crear tarea"
          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary transition-colors">
          <CheckSquare className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

// ── Chat Input helpers ────────────────────────────────────────────────────────
function resolveToMarkdown(text: string, map: Map<string, string>): string {
  if (map.size === 0) return text;
  const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  let result = text;
  for (const [display, markdown] of entries) {
    result = result.split(display).join(markdown);
  }
  return result;
}

// ── Chat Input ────────────────────────────────────────────────────────────────
interface ChatInputProps {
  value: string; onChange: (v: string) => void; onSend: (resolvedContent?: string) => void;
  onFileUpload: (f: File) => void; onSendAudio: (f: File) => void; onSendSticker: (emoji: string) => void;
  sending: boolean; uploading: boolean;
  pendingAttachments: Attachment[]; onRemoveAttachment: (i: number) => void;
  placeholder: string; teamMembers: TeamMember[]; projectChannels: string[];
  replyingTo?: Message | null; onCancelReply?: () => void;
  onCreatePoll?: () => void;
  onTyping?: () => void;
  events: { id: string; name: string; date?: string; projectCode?: string }[];
  groups: { name: string; projectCode?: string }[];
  tasks: { id: string; name: string; projectCode?: string; status?: string; boardName?: string }[];
  projectDocuments: ProjectDoc[];
  activeChannel: string;
}

function ChatInput({
  value, onChange, onSend, onFileUpload, onSendAudio, onSendSticker,
  sending, uploading, pendingAttachments, onRemoveAttachment,
  placeholder, teamMembers, projectChannels, replyingTo, onCancelReply, onCreatePoll,
  onTyping, events, groups, tasks, activeChannel, projectDocuments,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldSendRef = useRef(true);
  const lastTypingRef = useRef(0);
  const tokenMapRef = useRef<Map<string, string>>(new Map());

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [projectQuery, setProjectQuery] = useState<string | null>(null);
  const [projectQueryIdx, setProjectQueryIdx] = useState(0);
  const [eventQuery, setEventQuery] = useState<string | null>(null);
  const [eventQueryIdx, setEventQueryIdx] = useState(0);
  const [groupQuery, setGroupQuery] = useState<string | null>(null);
  const [groupQueryIdx, setGroupQueryIdx] = useState(0);
  const [taskQuery, setTaskQuery] = useState<string | null>(null);
  const [taskQueryIdx, setTaskQueryIdx] = useState(0);
  const [docQuery, setDocQuery] = useState<string | null>(null);
  const [docQueryIdx, setDocQueryIdx] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);

  useEffect(() => { if (replyingTo) textareaRef.current?.focus(); }, [replyingTo]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);
  useEffect(() => { tokenMapRef.current.clear(); }, [activeChannel]);
  useEffect(() => { if (!value) tokenMapRef.current.clear(); }, [value]);

  const handleSendResolved = () => {
    const resolved = resolveToMarkdown(value, tokenMapRef.current);
    tokenMapRef.current.clear();
    onSend(resolved);
  };

  const filteredMembers = mentionQuery !== null
    ? teamMembers.filter(m => {
        const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.toLowerCase();
        return name.includes(mentionQuery) || (m.email ?? '').toLowerCase().includes(mentionQuery);
      }).slice(0, 6)
    : [];

  const filteredProjects = projectQuery !== null
    ? projectChannels.filter(p => p.toLowerCase().includes(projectQuery)).slice(0, 6)
    : [];

  const isProjectChannel = projectChannels.includes(activeChannel);

  const filteredEvents = eventQuery !== null
    ? events
        .filter(e => !isProjectChannel || !e.projectCode || e.projectCode === activeChannel)
        .filter(e => e.name.toLowerCase().includes(eventQuery) || (e.projectCode ?? '').toLowerCase().includes(eventQuery))
        .slice(0, 6)
    : [];

  const filteredGroups = groupQuery !== null
    ? groups
        .filter(g => !isProjectChannel || !g.projectCode || g.projectCode === activeChannel)
        .filter(g => g.name.toLowerCase().includes(groupQuery) || (g.projectCode ?? '').toLowerCase().includes(groupQuery))
        .slice(0, 6)
    : [];

  const filteredDocs = docQuery !== null
    ? projectDocuments.filter(d =>
        (d.documentName ?? '').toLowerCase().includes(docQuery) ||
        (d.category ?? '').toLowerCase().includes(docQuery)
      ).slice(0, 6)
    : [];

  const filteredTasks = taskQuery !== null
    ? tasks
        .filter(t => !isProjectChannel || !t.projectCode || t.projectCode === activeChannel)
        .filter(t => t.name.toLowerCase().includes(taskQuery) || (t.projectCode ?? '').toLowerCase().includes(taskQuery))
        .slice(0, 6)
    : [];

  const insertMention = (m: TeamMember) => {
    const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || 'Usuario';
    const display = `@${name}`;
    const markdown = `[@${name}](mention:${m.email})`;
    tokenMapRef.current.set(display, markdown);
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newBefore = before.replace(/@(\w*)$/, `${display} `);
    onChange(newBefore + after);
    setMentionQuery(null);
    setTimeout(() => { textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length); textareaRef.current?.focus(); }, 0);
  };

  const insertProject = (code: string) => {
    const display = `#${code}`;
    const markdown = `[#${code}](/operacion/proyectos/${code})`;
    tokenMapRef.current.set(display, markdown);
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newBefore = before.replace(/#([\w-]*)$/, `${display} `);
    onChange(newBefore + after);
    setProjectQuery(null);
    setTimeout(() => { textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length); textareaRef.current?.focus(); }, 0);
  };

  const insertEvent = (evt: typeof events[0]) => {
    const display = `📅${evt.name}`;
    const markdown = `[📅 ${evt.name}](event:${evt.id})`;
    tokenMapRef.current.set(display, markdown);
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newBefore = before.replace(/!(\w*)$/, `${display} `);
    onChange(newBefore + after);
    setEventQuery(null);
    setTimeout(() => { textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length); textareaRef.current?.focus(); }, 0);
  };

  const insertTask = (task: typeof tasks[0]) => {
    const display = `✅${task.name}`;
    const markdown = `[✅ ${task.name}](task:${task.id})`;
    tokenMapRef.current.set(display, markdown);
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newBefore = before.replace(/\+(\w*)$/, `${display} `);
    onChange(newBefore + after);
    setTaskQuery(null);
    setTimeout(() => { textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length); textareaRef.current?.focus(); }, 0);
  };

  const insertGroup = (grp: typeof groups[0]) => {
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newBefore = before.replace(/\/(\w*)$/, '👥' + grp.name + ' ');
    onChange(newBefore + after);
    setGroupQuery(null);
    setTimeout(() => { textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length); textareaRef.current?.focus(); }, 0);
  };

  const insertDoc = (doc: ProjectDoc) => {
    const name = doc.documentName ?? 'Documento';
    const display = `${name}`;
    const markdown = `$[${name}](doc:${doc.id})`;
    tokenMapRef.current.set(display, markdown);
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const newBefore = before.replace(/\$([^\s]*)$/, `${display} `);
    onChange(newBefore + after);
    setDocQuery(null);
    setTimeout(() => { textareaRef.current?.setSelectionRange(newBefore.length, newBefore.length); textareaRef.current?.focus(); }, 0);
  };

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    onChange(next); setEmojiOpen(false);
    const pos = start + emoji.length;
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(pos, pos); }, 0);
  };

  const handleChange = (v: string) => {
    onChange(v);
    if (v.trim() && onTyping) {
      const now = Date.now();
      if (now - lastTypingRef.current > 2500) {
        lastTypingRef.current = now;
        onTyping();
      }
    }
    setTimeout(() => {
      const pos = textareaRef.current?.selectionStart ?? v.length;
      const upTo = v.slice(0, pos);
      const tm = upTo.match(/\+(\w*)$/);
      if (tm) { setTaskQuery(tm[1].toLowerCase()); setTaskQueryIdx(0); } else setTaskQuery(null);
      const m = upTo.match(/@(\w*)$/);
      if (m) { setMentionQuery(m[1].toLowerCase()); setMentionIdx(0); } else setMentionQuery(null);
      const pm = upTo.match(/#([\w-]*)$/);
      if (pm) { setProjectQuery(pm[1].toLowerCase()); setProjectQueryIdx(0); } else setProjectQuery(null);
      const em = upTo.match(/!(\w*)$/);
      if (em) { setEventQuery(em[1].toLowerCase()); setEventQueryIdx(0); } else setEventQuery(null);
      const gm = upTo.match(/\/(\w*)$/);
      if (gm) { setGroupQuery(gm[1].toLowerCase()); setGroupQueryIdx(0); } else setGroupQuery(null);
      const docm = upTo.match(/\$([^\s]*)$/);
      if (docm) { setDocQuery(docm[1].toLowerCase()); setDocQueryIdx(0); } else setDocQuery(null);
    }, 0);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }
  };

  const applyFormat = (wrap: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart; const e = ta.selectionEnd;
    onChange(value.slice(0, s) + wrap + value.slice(s, e) + wrap + value.slice(e));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + wrap.length, e + wrap.length); }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (docQuery !== null && filteredDocs.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDocQueryIdx(i => Math.min(i + 1, filteredDocs.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setDocQueryIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertDoc(filteredDocs[docQueryIdx]); return; }
      if (e.key === 'Escape') { setDocQuery(null); return; }
    }
    if (taskQuery !== null && filteredTasks.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setTaskQueryIdx(i => Math.min(i + 1, filteredTasks.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setTaskQueryIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertTask(filteredTasks[taskQueryIdx]); return; }
      if (e.key === 'Escape') { setTaskQuery(null); return; }
    }
    if (eventQuery !== null && filteredEvents.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setEventQueryIdx(i => Math.min(i + 1, filteredEvents.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setEventQueryIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertEvent(filteredEvents[eventQueryIdx]); return; }
      if (e.key === 'Escape') { setEventQuery(null); return; }
    }
    if (groupQuery !== null && filteredGroups.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setGroupQueryIdx(i => Math.min(i + 1, filteredGroups.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setGroupQueryIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertGroup(filteredGroups[groupQueryIdx]); return; }
      if (e.key === 'Escape') { setGroupQuery(null); return; }
    }
    if (mentionQuery !== null && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, filteredMembers.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filteredMembers[mentionIdx]); return; }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (projectQuery !== null && filteredProjects.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setProjectQueryIdx(i => Math.min(i + 1, filteredProjects.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setProjectQueryIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertProject(filteredProjects[projectQueryIdx]); return; }
      if (e.key === 'Escape') { setProjectQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendResolved(); }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('El micrófono requiere una conexión segura (HTTPS). Intenta desde la app publicada.'); return;
    }
    const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    const mimeType = MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
    if (!mimeType) { toast.error('Tu navegador no soporta grabación de audio'); return; }
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = ev => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (!shouldSendRef.current || chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onSendAudio(new File([blob], `voz-${Date.now()}.${ext}`, { type: mimeType }));
      };
      mr.start(1000);
      mediaRecorderRef.current = mr;
      setIsRecording(true); setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === 'NotAllowedError') toast.error('Permiso de micrófono denegado.');
      else if (name === 'NotFoundError') toast.error('No se encontró ningún micrófono.');
      else toast.error('No se pudo acceder al micrófono');
    }
  };

  const stopRecording = () => {
    shouldSendRef.current = true;
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    shouldSendRef.current = false;
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const canSend = (value.trim() || pendingAttachments.length > 0) && !sending && !uploading;

  return (
    <div className="relative">
      {docQuery !== null && filteredDocs.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <FileText className="w-3 h-3" /> Documento del proyecto
          </div>
          {filteredDocs.map((doc, idx) => (
            <button key={doc.id} onClick={() => insertDoc(doc)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${idx === docQueryIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
              <div className="w-6 h-6 rounded-full bg-chart-2/15 flex items-center justify-center flex-shrink-0">
                <FileText className="w-3.5 h-3.5 text-chart-2" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="font-medium truncate block">{doc.documentName ?? 'Sin nombre'}</span>
                {doc.category && <span className="text-xs text-muted-foreground truncate block">{doc.category}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {mentionQuery !== null && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-medium">Mencionar</div>
          {filteredMembers.map((m, idx) => {
            const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?';
            return (
              <button key={m.id} onClick={() => insertMention(m)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${idx === mentionIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                  {(m.firstName ?? m.email ?? '?')[0].toUpperCase()}
                </div>
                <span className="font-medium">{name}</span>
                <span className="text-xs text-muted-foreground ml-auto">{m.email}</span>
              </button>
            );
          })}
        </div>
      )}
      {projectQuery !== null && filteredProjects.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <Hash className="w-3 h-3" /> Proyecto
          </div>
          {filteredProjects.map((code, idx) => (
            <button key={code} onClick={() => insertProject(code)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${idx === projectQueryIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
              <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="font-semibold">#{code}</span>
            </button>
          ))}
        </div>
      )}
      {eventQuery !== null && filteredEvents.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <span>📅</span> Evento
          </div>
          {filteredEvents.map((evt, idx) => (
            <button key={evt.id} onClick={() => insertEvent(evt)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${idx === eventQueryIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
              <div className="w-6 h-6 rounded-full bg-chart-4/20 flex items-center justify-center flex-shrink-0 text-xs">📅</div>
              <div className="min-w-0 flex-1">
                <span className="font-medium truncate block">{evt.name}</span>
                <span className="text-xs text-muted-foreground truncate block">{evt.date ? new Date(evt.date).toLocaleDateString() : evt.projectCode ?? ''}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {taskQuery !== null && filteredTasks.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <span>✅</span> Tarea
          </div>
          {filteredTasks.map((task, idx) => (
            <button key={task.id} onClick={() => insertTask(task)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${idx === taskQueryIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
              <div className="w-6 h-6 rounded-full bg-chart-3/20 flex items-center justify-center flex-shrink-0 text-xs">✅</div>
              <div className="min-w-0 flex-1">
                <span className="font-medium truncate block">{task.name}</span>
                <span className="text-xs text-muted-foreground truncate block">
                  {[task.projectCode, task.boardName, task.status].filter(Boolean).join(' · ')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      {groupQuery !== null && filteredGroups.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <span>👥</span> Grupo
          </div>
          {filteredGroups.map((grp, idx) => (
            <button key={grp.name} onClick={() => insertGroup(grp)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${idx === groupQueryIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}>
              <div className="w-6 h-6 rounded-full bg-chart-5/20 flex items-center justify-center flex-shrink-0 text-xs">👥</div>
              <div className="min-w-0 flex-1">
                <span className="font-medium truncate block">{grp.name}</span>
                {grp.projectCode && <span className="text-xs text-muted-foreground truncate block">{grp.projectCode}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {replyingTo && (
        <div className="flex items-center gap-2 px-3 py-2 mb-1 bg-primary/5 border border-primary/20 rounded-xl text-xs">
          <Reply className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="text-muted-foreground">Respondiendo a</span>
          <span className="font-semibold text-foreground truncate flex-1">{replyingTo.senderName}</span>
          <span className="text-muted-foreground truncate max-w-[200px] hidden sm:block italic">
            {replyingTo.content?.trim() !== ' ' ? replyingTo.content?.slice(0, 60) : '📎 archivo'}
            {(replyingTo.content?.length ?? 0) > 60 ? '…' : ''}
          </span>
          <button onClick={onCancelReply} className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden focus-within:ring-1 focus-within:ring-primary/30 transition-shadow">
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1">
            {pendingAttachments.map((a, i) => (
              <div key={i} className="relative group/att flex items-center gap-1.5 bg-muted px-2.5 py-1 rounded-lg text-xs max-w-[180px]">
                <Paperclip className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                <span className="truncate">{a.name}</span>
                <button onClick={() => onRemoveAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition-opacity shadow-sm">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="hidden md:flex items-center gap-0.5 px-2 pt-1.5 border-b border-border/30">
          <button onClick={() => applyFormat('**')} title="Negrita" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Bold className="w-3.5 h-3.5" /></button>
          <button onClick={() => applyFormat('*')} title="Cursiva" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Italic className="w-3.5 h-3.5" /></button>
          <button onClick={() => applyFormat('~~')} title="Tachado" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Strikethrough className="w-3.5 h-3.5" /></button>
          <button onClick={() => applyFormat('`')} title="Código" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-mono text-xs">&lt;/&gt;</button>
          <div className="w-px h-4 bg-border/50 mx-0.5" />
          <Popover open={stickerOpen} onOpenChange={setStickerOpen}>
            <PopoverTrigger asChild>
              <button title="Stickers" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Image className="w-3.5 h-3.5" /></button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-52 p-2.5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Stickers</p>
              <div className="grid grid-cols-6 gap-0.5 max-h-36 overflow-y-auto">
                {STICKERS.map((s, idx) => (
                  <button key={idx} onClick={() => { setStickerOpen(false); onSendSticker(s); }}
                    className="text-2xl p-1.5 rounded hover:bg-muted transition-all hover:scale-110 text-center leading-none">{s}</button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <button onClick={onCreatePoll} title="Crear encuesta"
            className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors">
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground/40 pr-1 hidden sm:inline">Enter envía · Shift+Enter nueva línea</span>
        </div>
        {isRecording ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse flex-shrink-0" />
            <span className="text-sm text-destructive font-medium flex-1">Grabando... {fmt(recordingTime)}</span>
            <Button size="sm" variant="destructive" onClick={stopRecording} className="h-7 text-xs gap-1.5">
              <Send className="w-3 h-3" /> Enviar
            </Button>
            <button onClick={cancelRecording} className="text-muted-foreground hover:text-foreground p-1 rounded" title="Cancelar">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2 px-3 py-2">
            <textarea ref={textareaRef}
              className="flex-1 bg-transparent text-sm outline-none resize-none leading-relaxed min-h-[32px] max-h-[120px] placeholder:text-muted-foreground"
              placeholder={placeholder} value={value} rows={1}
              onChange={e => handleChange(e.target.value)} onKeyDown={handleKeyDown}
            />
            <div className="flex items-center gap-1 flex-shrink-0 pb-0.5">
              <input ref={fileInputRef} type="file" className="hidden" multiple
                onChange={e => { Array.from(e.target.files ?? []).forEach(f => onFileUpload(f)); e.target.value = ''; }} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Adjuntar"
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                <Paperclip className={`w-4 h-4 ${uploading ? 'animate-pulse text-primary' : ''}`} />
              </button>
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <button title="Emojis" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Smile className="w-4 h-4" /></button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-64 p-2.5">
                  {Object.entries(EMOJI_CATEGORIES).map(([cat, emojis]) => (
                    <div key={cat} className="mb-2 last:mb-0">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{cat}</p>
                      <div className="grid grid-cols-8 gap-0">
                        {emojis.map(e => (
                          <button key={e} onClick={() => insertEmoji(e)}
                            className="text-base p-1 rounded hover:bg-muted transition-all hover:scale-110 text-center">{e}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </PopoverContent>
              </Popover>
              <button onClick={startRecording} disabled={uploading || sending} title="Mensaje de voz"
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                <Mic className="w-4 h-4" />
              </button>
              <Button size="icon" className="h-8 w-8" onClick={handleSendResolved} disabled={!canSend}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sidebar Section ───────────────────────────────────────────────────────────
function SidebarSection({ title, icon, onAdd, addLabel, collapsed, onToggle, children, badgeCount, hasMention }: {
  title: string; icon: React.ReactNode; onAdd: () => void; addLabel: string;
  collapsed: boolean; onToggle: () => void; children: React.ReactNode; badgeCount?: number; hasMention?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center px-3 py-1.5 group/sec">
        <button onClick={onToggle} className="flex items-center gap-1.5 flex-1 text-left min-w-0">
          {collapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
          {icon}
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest truncate">{title}</span>
          {!!badgeCount && badgeCount > 0 && (
            <span className={`ml-1 min-w-[16px] h-4 rounded-full text-[9px] font-bold flex items-center justify-center px-1 flex-shrink-0 leading-none ${hasMention ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </button>
        <button onClick={onAdd} title={addLabel}
          className="opacity-0 group-hover/sec:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {!collapsed && <div className="pb-1">{children}</div>}
    </div>
  );
}

// ── Main ChatPage ─────────────────────────────────────────────────────────────
interface ChatPageProps { projectOnly?: boolean; projectChannel?: string; mode?: 'page' | 'drawer'; onClose?: () => void; }

export default function ChatPage({ projectOnly, projectChannel, mode, onClose }: ChatPageProps) {
  const navigate = useNavigate();
  const isDrawer = mode === 'drawer';
  const { selectedProject, projects } = useProject();
  const { user } = useAuth();
  const myEmail = user?.email ?? '';
  const myName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();
  const initChannel = projectOnly ? (projectChannel ?? selectedProject ?? 'general') : 'general';

  const [activeChannel, setActiveChannel] = useState(initChannel);
  const [activeConvId, setActiveConvId] = useState<string | null>(null); // id for DM/group
  const [activeConvLabel, setActiveConvLabel] = useState<string>('');
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState(() => loadDraft(initChannel));
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Antes la búsqueda era un .filter() sobre topMessages (los ~60 mensajes ya
  // cargados) — no alcanzaba el historial real. null = sin búsqueda activa,
  // usa la lista normal; array = resultado real del servidor para esta query.
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => cachedTeamMembers ?? []);
  const [projectChannelsWithStatus, setProjectChannelsWithStatus] = useState<{ code: string; status: string }[]>([]);
  const [channelSearch, setChannelSearch] = useState('');
  const [dmSearch, setDmSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [favoriteChannels, setFavoriteChannels] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('chat-favorite-channels') ?? '[]')); }
    catch { return new Set(); }
  });
  const [secFavorites, setSecFavorites] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('chat-sound-enabled') !== 'false');
  const [taskMessage, setTaskMessage] = useState<Message | null>(null);
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([]);
  const [docPreview, setDocPreview] = useState<{ open: boolean; fileUrl: string; docName: string }>({ open: false, fileUrl: '', docName: '' });
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [activeMsgId, setActiveMsgId] = useState<string | null>(null);
  const [hasExplicitSelection, setHasExplicitSelection] = useState(false);

  const [dms, setDms] = useState<DMConv[]>(() => cachedDms ?? []);
  const [groups, setGroups] = useState<GroupConv[]>(() => cachedGroups ?? []);
  const [presenceMap, setPresenceMap] = useState<Record<string, { lastSeenAt?: string; activeChannel?: string | null }>>({});
  const [presenceRefresh, setPresenceRefresh] = useState(0);
  const activeEmails = useMemo(() => {
    const now = Date.now();
    return new Set(
      Object.entries(presenceMap)
        .filter(([, p]) => p.lastSeenAt && (now - new Date(p.lastSeenAt).getTime()) < 5 * 60 * 1000)
        .map(([email]) => email)
    );
  // presenceRefresh forces re-eval of Date.now() every 30s
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceMap, presenceRefresh]);
  const [showNewDM, setShowNewDM] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showPollDialog, setShowPollDialog] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { name: string; expiresAt: number }>>({});
  const [secChannels, setSecChannels] = useState(false);
  const [secDMs, setSecDMs] = useState(false);
  const [secGroups, setSecGroups] = useState(false);
  const [mentionedChannels, setMentionedChannels] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]')); }
    catch { return new Set(); }
  });

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}'); } catch { return {}; }
  });
  const [lastMessageAt, setLastMessageAt] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('chat-last-message-at') ?? '{}'); } catch { return {}; }
  });
  const [lastMessagePreview, setLastMessagePreview] = useState<Record<string, { content: string; senderName: string }>>(() => {
    try { return JSON.parse(localStorage.getItem('chat-last-message-preview') ?? '{}'); } catch { return {}; }
  });

  const userNotifyStatusRef = useRef<string>('disconnected');
  const lastSentAtRef = useRef<string | null>(null);
  // Ref to the latest loadIncremental so signal listeners can call it without stale closures
  const loadIncrementalRef = useRef<(() => Promise<void>) | null>(null);
  const retryDelayRef = useRef(3000);
  const [messagesFetchError, setMessagesFetchError] = useState(false);
  // Debounced trigger so rapid signals don't spam getMessages
  const debouncedLoadIncremental = useDebouncedCallback(() => {
    loadIncrementalRef.current?.();
  }, 2000);
  const debouncedSaveDraft = useDebouncedCallback((channel: string, text: string) => {
    saveDraft(channel, text);
  }, 1500);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // "Cargar mensajes anteriores" prepende al inicio de allMessages, lo que
  // también dispara el efecto de auto-scroll-al-fondo (depende de
  // allMessages.length) — sin esto, cada vez que se pide historial viejo el
  // scroll saltaría de regreso al mensaje más reciente en vez de quedarse
  // donde el usuario estaba leyendo.
  const skipAutoScrollRef = useRef(false);
  const pendingScrollRestoreRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const initialLoadRef = useRef(true);

  // The channel used for messaging: either activeConvId (DM/group) or activeChannel
  const effectiveChannel = activeConvId ?? activeChannel;
  const effectiveChannelRef = useRef(effectiveChannel);
  const activeConvIdRef = useRef(activeConvId);
  const myNameRef = useRef(myName);
  // ── Fase B Etapa 1: refs for Ably-aware polling ─────────────────────────────
  const realtimeStatusRef = useRef<string>('disabled');
  const prevRealtimeStatusRef = useRef<string>('disabled');

  useEffect(() => {
    effectiveChannelRef.current = effectiveChannel;
    activeConvIdRef.current = activeConvId;
    myNameRef.current = myName;
  }, [effectiveChannel, activeConvId, myName]);

  // ── Central helper to clear read state for a channel ─────────────────────
  const clearReadStateForChannel = (channel: string) => {
    if (!channel) return;
    markRead(channel);
    clearUnreadForChannel(channel);
    clearMentionForChannel(channel);
    setUnreadCounts(prev => {
      const next = { ...prev, [channel]: 0 };
      localStorage.setItem('chat-unread-counts', JSON.stringify(next));
      return next;
    });
    setMentionedChannels(prev => {
      const next = new Set(prev);
      next.delete(channel);
      localStorage.setItem('chat-mention-channels', JSON.stringify([...next]));
      return next;
    });
    // Dispatch outside state updaters — defer past React's current render cycle
    setTimeout(() => {
      const counts = JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}');
      window.dispatchEvent(new CustomEvent('chat-unread-counts-updated', { detail: counts }));
      const mentions = JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]');
      window.dispatchEvent(new CustomEvent('chat-mention-channels-updated', { detail: mentions }));
    }, 0);
  };

  // ── Inform Layout which channel is currently active (so it skips notifications for it) ──
  useEffect(() => {
    localStorage.setItem('chat-active-channel', effectiveChannel);
    window.dispatchEvent(new CustomEvent('chat-channel-changed'));
    return () => {
      localStorage.removeItem('chat-active-channel');
      window.dispatchEvent(new CustomEvent('chat-channel-changed'));
    };
  }, [effectiveChannel]);

  // ── Receive unread-count updates from Layout's global notification handler ──
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ channel: string; hasMention: boolean }>;
      const { channel, hasMention } = ev.detail;
      setUnreadCounts(prev => {
        const next = { ...prev, [channel]: (prev[channel] ?? 0) + 1 };
        localStorage.setItem('chat-unread-counts', JSON.stringify(next));
        return next;
      });
      if (hasMention) {
        setMentionedChannels(prev => {
          const next = new Set(prev);
          next.add(channel);
          localStorage.setItem('chat-mention-channels', JSON.stringify([...next]));
          return next;
        });
      }
    };
    window.addEventListener('chat-unread-updated', handler);
    return () => window.removeEventListener('chat-unread-updated', handler);
  }, []);

  // ── Listen for conversation.created from Ably (via Layout) ─────────────────
  useEffect(() => {
    if (projectOnly) return;
    const handler = (e: Event) => {
      const payload = (e as CustomEvent).detail as {
        conversationId: string;
        conversationType: 'DM' | 'Group';
        conversationName: string;
        members: string[];
        createdBy: string;
        createdAt: string;
      };
      if (!payload?.conversationId) return;

      if (payload.conversationType === 'DM') {
        setDms(prev => {
          if (prev.some(d => d.id === payload.conversationId)) return prev;
          const newDm: DMConv = {
            id: payload.conversationId,
            members: payload.members,
            lastMessageAt: payload.createdAt,
          };
          const next = [newDm, ...prev];
          cachedDms = next;
          return next;
        });
      } else if (payload.conversationType === 'Group') {
        setGroups(prev => {
          if (prev.some(g => g.id === payload.conversationId)) return prev;
          const newGroup: GroupConv = {
            id: payload.conversationId,
            name: payload.conversationName || 'Grupo sin nombre',
            members: payload.members,
            lastMessageAt: payload.createdAt,
          };
          const next = [newGroup, ...prev];
          cachedGroups = next;
          return next;
        });
      }
    };
    window.addEventListener('chat-conversation-created', handler);
    return () => window.removeEventListener('chat-conversation-created', handler);
  }, [projectOnly]);

  // ── Listen for user-notify status changes and sync on reconnect ───────────
  useEffect(() => {
    const handler = (e: Event) => {
      const newStatus = (e as CustomEvent<{ status: string }>).detail?.status ?? 'disconnected';
      const prevStatus = userNotifyStatusRef.current;
      userNotifyStatusRef.current = newStatus;

      // Sync conversations once on any transition TO connected
      if (newStatus === 'connected' && prevStatus !== 'connected') {
        console.log('[chat][fase-b] user-notify connected, syncing conversations');
        getChatConversations({}).then(d => {
          setDms(d.dms); setGroups(d.groups);
          cachedDms = d.dms; cachedGroups = d.groups;
        }).catch(() => {});
      }
    };
    window.addEventListener('chat-user-notify-status-changed', handler);
    return () => window.removeEventListener('chat-user-notify-status-changed', handler);
  }, []);

  // ── Sync from Layout's centralized getUnreadCounts polling ─────────────────
  useEffect(() => {
    const handleCountsRefresh = (e: Event) => {
      const counts = (e as CustomEvent<Record<string, number>>).detail ?? {};
      const active = effectiveChannelRef.current;
      const nextCounts = { ...counts };
      if (active) nextCounts[active] = 0;
      setUnreadCounts(nextCounts);
    };
    const handleSidebarData = (e: Event) => {
      const detail = (e as CustomEvent<{
        lastMessageAt?: Record<string, string>;
        lastMessagePreview?: Record<string, { content: string; senderName: string }>;
      }>).detail ?? {};
      if (detail.lastMessageAt) setLastMessageAt(prev => ({ ...prev, ...detail.lastMessageAt }));
      if (detail.lastMessagePreview) setLastMessagePreview(prev => ({ ...prev, ...detail.lastMessagePreview }));
    };
    window.addEventListener('chat-unread-counts-updated', handleCountsRefresh);
    window.addEventListener('chat-sidebar-data-updated', handleSidebarData);
    return () => {
      window.removeEventListener('chat-unread-counts-updated', handleCountsRefresh);
      window.removeEventListener('chat-sidebar-data-updated', handleSidebarData);
    };
  }, []);

  // ── Realtime: subscribe to message.created events via Ably SSE ──────────────
  const { status: realtimeStatus } = useRealtimeChannel({
    channel: effectiveChannel,
    enabled: !!myEmail,
    onReactionUpdated: (payload) => {
      setAllMessages(prev => prev.map(m =>
        m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
      ));
    },
    onMessagePinned: (payload) => {
      setAllMessages(prev => prev.map(m =>
        m.id === payload.messageId ? { ...m, pinned: payload.pinned } : m
      ));
    },
    onPollUpdated: (payload) => {
      setAllMessages(prev => prev.map(m =>
        m.id === payload.messageId ? { ...m, content: payload.content } : m
      ));
    },
    onTyping: (payload) => {
      if (payload.userEmail === myEmail) return;
      setTypingUsers(prev => ({
        ...prev,
        [payload.userEmail]: { name: payload.userName, expiresAt: Date.now() + 4000 },
      }));
    },
    onMessageCreated: (msg) => {
      console.log('[ably][received message.created]', {
        subscribedChannel: effectiveChannel,
        messageChannel: msg.channel,
        messageId: msg.id,
      });
      // The realtime event will dedupe via mergeMessagesReplacingOptimistic
      setAllMessages(prev => mergeMessagesReplacingOptimistic(prev, [msg as Message]));
      // Update last message preview for this channel (skip replies and polls)
      const _typedMsg = msg as Message;
      if (_typedMsg.channel && !_typedMsg.parentMessageId) {
        const _raw = (_typedMsg.content ?? '').startsWith('{"type":"poll"')
          ? '📊 Encuesta'
          : (_typedMsg.content ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`#]/g, '').trim().slice(0, 80) || '📎 Archivo';
        setLastMessagePreview(prev => {
          const next = {
            ...prev,
            [_typedMsg.channel!]: {
              content: _raw,
              senderName: _typedMsg.senderName ?? _typedMsg.senderEmail?.split('@')[0] ?? '',
            },
          };
          localStorage.setItem('chat-last-message-preview', JSON.stringify(next));
          return next;
        });
      }
      // Update lastMessageAt for the channel sidebar ordering
      if (_typedMsg.channel && _typedMsg.sentAt) {
        setLastMessageAt(prev => {
          const next = { ...prev, [_typedMsg.channel!]: _typedMsg.sentAt! };
          localStorage.setItem('chat-last-message-at', JSON.stringify(next));
          return next;
        });
      }
      // Update lastSentAtRef for incremental fetches
      if (msg.sentAt) {
        const msgTime = new Date(msg.sentAt).getTime();
        const currentTime = lastSentAtRef.current ? new Date(lastSentAtRef.current).getTime() : 0;
        if (msgTime > currentTime) {
          lastSentAtRef.current = msg.sentAt;
        }
      }
    },
  });





  // ── Fase B Etapa 1: keep realtimeStatusRef in sync & detect reconnection ────
  // When Ably reconnects (status goes from non-connected → connected),
  // run loadIncremental once to catch any messages missed during the outage.
  // Estimated impact: ~90% reduction in messages polling
  //   Before: P1 ≈ 2,400 runs/día + P5 ≈ 300 runs/día = 2,700 runs/día
  //   After:  P1 ≈ 240 runs/día (fallback) + P5 ≈ 50 runs/día (safety net) = 290 runs/día
  useEffect(() => {
    const prev = prevRealtimeStatusRef.current;
    realtimeStatusRef.current = realtimeStatus;
    prevRealtimeStatusRef.current = realtimeStatus;
    // On reconnection: sync any missed messages
    if (realtimeStatus === 'connected' && prev !== 'connected' && prev !== 'disabled') {
      console.log('[chat][fase-b] Ably reconnected, syncing missed messages');
      loadIncrementalRef.current?.();
    }
  }, [realtimeStatus]);

  useEffect(() => {
    const sync = () => {
      try {
        const stored = new Set<string>(JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]'));
        stored.delete(activeChannel);
        setMentionedChannels(stored);
      } catch {}
    };
    sync();
    const iv = setInterval(sync, 30000);
    return () => clearInterval(iv);
  }, [activeChannel]);

  useEffect(() => {
    if (projectOnly) setActiveChannel(projectChannel ?? selectedProject ?? 'general');
  }, [projectOnly, projectChannel, selectedProject]);

  const [chatEvents, setChatEvents] = useState<{ id: string; name: string; date?: string; projectCode?: string }[]>([]);
  const [chatGroups, setChatGroups] = useState<{ name: string; projectCode?: string }[]>([]);
  const [chatTasks, setChatTasks] = useState<{ id: string; name: string; projectCode?: string; status?: string; boardName?: string }[]>([]);

  useEffect(() => {
    if (!user?.email) return;
    getTeamMembers({}).then(d => { setTeamMembers(d.members); cachedTeamMembers = d.members; }).catch(() => {});
    getReferenceOptionsCached().then(d => {
      setChatEvents(d.events);
      setChatGroups(d.groups);
      setChatTasks(d.tasks);
    }).catch(() => {});
  }, [user?.email]);

  // Load documents for the active project channel
  useEffect(() => {
    const codes = projectChannelsWithStatus.map(p => p.code);
    if (!activeChannel || !codes.includes(activeChannel)) { setProjectDocs([]); return; }
    getProjectDocuments({ projectCode: activeChannel })
      .then(d => setProjectDocs(d.documents))
      .catch(() => setProjectDocs([]));
  }, [activeChannel, projectChannelsWithStatus]);

  // Populate project channels from context (already loaded by Layout) — no extra endpoint call needed
  useEffect(() => {
    if (projectOnly) return;
    if (projects.length > 0) {
      setProjectChannelsWithStatus(
        projects
          .filter(p => p.projectCode)
          .map(p => ({ code: p.projectCode!, status: p.status ?? '' }))
      );
    }
  }, [projectOnly, projects]);

  // Load conversations
  useEffect(() => {
    if (!myEmail || projectOnly) return;
    getChatConversations({}).then(d => { setDms(d.dms); setGroups(d.groups); cachedDms = d.dms; cachedGroups = d.groups; }).catch(() => {});
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible' && userNotifyStatusRef.current !== 'connected') {
        getChatConversations({}).then(d => { setDms(d.dms); setGroups(d.groups); cachedDms = d.dms; cachedGroups = d.groups; }).catch(() => {});
      }
    }, 120000);
    return () => { clearInterval(iv); };
  }, [myEmail, projectOnly]);

  // Presence: heartbeat (update own presence) + poll active users
  useEffect(() => {
    if (!myEmail) return;
    updatePresence({ activeChannel: effectiveChannelRef.current }).catch(() => {});
    // Poll who is online
    const fetchPresence = () => {
      getPresence({}).then(d => {
        const map: Record<string, { lastSeenAt?: string; activeChannel?: string | null }> = {};
        d.users.forEach(u => { map[u.email] = { lastSeenAt: u.lastSeenAt, activeChannel: u.activeChannel }; });
        setPresenceMap(map);
      }).catch(() => {});
    };
    fetchPresence();
    const presenceIv = setInterval(() => { if (document.visibilityState === 'visible') fetchPresence(); }, 600000); // every 10 min (Etapa 3: reduced from 5 min)
    // Heartbeat every 5 min to keep self marked as active
    const heartbeatIv = setInterval(() => {
      if (document.visibilityState === 'visible') updatePresence({ activeChannel: effectiveChannelRef.current }).catch(() => {});
    }, 300000);
    // Update presence when tab becomes visible again
    const onPresenceVisible = () => {
      if (document.visibilityState === 'visible') {
        updatePresence({ activeChannel: effectiveChannelRef.current }).catch(() => {});
        fetchPresence(); // Etapa 3: also refresh who is online when tab becomes visible
      }
    };
    document.addEventListener('visibilitychange', onPresenceVisible);
    return () => {
      clearInterval(presenceIv); clearInterval(heartbeatIv);
      document.removeEventListener('visibilitychange', onPresenceVisible);
    };
  }, [myEmail]);

  // Update presence immediately when active channel/conv changes
  useEffect(() => {
    if (!myEmail || !effectiveChannel) return;
    updatePresence({ activeChannel: effectiveChannel }).catch(() => {});
  }, [effectiveChannel, myEmail]);

  // Unread counts are now managed centrally by Layout.tsx polling every 5 min.
  // ChatPage receives updates via 'chat-unread-counts-updated' and 'chat-sidebar-data-updated' events.

  useEffect(() => {
    // ── Cache check: restore instantly without skeleton ──────────────────────
    const cached = getCachedMessages(effectiveChannel);
    if (cached) {
      setAllMessages(cached);
      setLoading(false);
    } else {
      setLoading(true);
      setAllMessages([]);
    }
    setReplyingTo(null);
    setTypingUsers({});
    setActiveMsgId(null);
    setHasMoreOlder(false);
    setLoadingOlder(false);
    initialLoadRef.current = true;
    clearReadStateForChannel(effectiveChannel);
    lastSentAtRef.current = null;
    let cancelled = false;

    const load = async () => {
      try {
        const d = await getMessages({ channel: effectiveChannel, limit: 60 });
        if (!cancelled) {
          setAllMessages(d.messages);
          setHasMoreOlder(d.hasMoreOlder ?? false);
          cacheMessages(effectiveChannel, d.messages);
          const last = d.messages[d.messages.length - 1];
          if (last?.sentAt) lastSentAtRef.current = last.sentAt;
        }
      } catch { /* silent */ }
      if (!cancelled) {
        setLoading(false);
        setTimeout(() => { initialLoadRef.current = false; }, 500);
      }
    };

    const loadIncremental = async () => {
      if (!lastSentAtRef.current) {
        return load();
      }
      try {
        const d = await getMessages({ channel: effectiveChannel, since: lastSentAtRef.current });
        if (!cancelled && d.messages.length > 0) {
          setAllMessages(prev => { const next = mergeMessagesReplacingOptimistic(prev, d.messages); cacheMessages(effectiveChannel, next); return next; });
          const last = d.messages[d.messages.length - 1];
          if (last?.sentAt) lastSentAtRef.current = last.sentAt;
        }
        // Success: clear error state and reset backoff
        if (!cancelled) {
          setMessagesFetchError(false);
          retryDelayRef.current = 3000;
        }
      } catch {
        if (!cancelled) {
          setMessagesFetchError(true);
          const delay = retryDelayRef.current;
          retryDelayRef.current = Math.min(delay * 2, 30000);
          setTimeout(() => { if (!cancelled) loadIncremental(); }, delay);
        }
      }
    };

    // Expose to ref so signal listeners outside this effect can call the latest version
    loadIncrementalRef.current = loadIncremental;

    load();
    // ── Fase B Etapa 1 (P1): polling OFF when Ably connected, ON as fallback ──
    const interval = setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible' && realtimeStatusRef.current !== 'connected') {
        loadIncremental();
      }
    }, 30000); // 30s fallback only when Ably is disconnected/error
    const onVisible = () => { if (!cancelled && document.visibilityState === 'visible') loadIncremental(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [effectiveChannel]);



  useEffect(() => {
    if (!allMessages.length) return;
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      const restore = pendingScrollRestoreRef.current;
      const container = messagesContainerRef.current;
      if (restore && container) {
        container.scrollTop = restore.prevScrollTop + (container.scrollHeight - restore.prevScrollHeight);
      }
      pendingScrollRestoreRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: initialLoadRef.current ? 'instant' : 'smooth' });
  }, [allMessages.length]);

  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreOlder || allMessages.length === 0) return;
    const oldest = allMessages[0];
    if (!oldest?.sentAt) return;
    setLoadingOlder(true);
    try {
      const d = await getMessages({ channel: effectiveChannel, before: oldest.sentAt });
      setHasMoreOlder(d.hasMoreOlder ?? false);
      if (d.messages.length > 0) {
        const container = messagesContainerRef.current;
        pendingScrollRestoreRef.current = container
          ? { prevScrollHeight: container.scrollHeight, prevScrollTop: container.scrollTop }
          : null;
        skipAutoScrollRef.current = true;
        setAllMessages(prev => {
          const seen = new Set(prev.map(m => m.id));
          const older = d.messages.filter(m => !seen.has(m.id));
          const next = [...older, ...prev];
          cacheMessages(effectiveChannel, next);
          return next;
        });
      }
    } catch { /* silent — el botón sigue disponible, el usuario puede reintentar */ }
    setLoadingOlder(false);
  };

  // ── Signal-driven immediate refresh ─────────────────────────────────────────
  // When Layout receives a personal Ably notification for the active channel
  // (chat-new-message-signal), or when getUnreadCounts updates sidebar data
  // (chat-sidebar-data-updated) with a newer timestamp, trigger loadIncremental
  // immediately instead of waiting up to 30s for the polling interval.
  useEffect(() => {
    const handleSignal = (e: Event) => {
      const detail = (e as CustomEvent<{ channel?: string; sentAt?: string }>).detail ?? {};
      if (!detail.channel || detail.channel !== effectiveChannel) return;
      // Skip if we already have this message
      if (detail.sentAt && lastSentAtRef.current && detail.sentAt <= lastSentAtRef.current) return;
      debouncedLoadIncremental();
    };

    const handleSidebarUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ lastMessageAt?: Record<string, string> }>).detail ?? {};
      const ts = detail.lastMessageAt?.[effectiveChannel];
      if (!ts) return;
      if (lastSentAtRef.current && ts <= lastSentAtRef.current) return;
      debouncedLoadIncremental();
    };

    window.addEventListener('chat-new-message-signal', handleSignal);
    window.addEventListener('chat-sidebar-data-updated', handleSidebarUpdated);
    return () => {
      window.removeEventListener('chat-new-message-signal', handleSignal);
      window.removeEventListener('chat-sidebar-data-updated', handleSidebarUpdated);
    };
  }, [effectiveChannel, debouncedLoadIncremental]);

  // Clean up expired typing indicators every second
  useEffect(() => {
    const iv = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now();
        const next: typeof prev = {};
        for (const [email, data] of Object.entries(prev)) {
          if (data.expiresAt > now) next[email] = data;
        }
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Local refresh every 30s to update "Activo hace X min" without extra backend calls
  useEffect(() => {
    const iv = setInterval(() => setPresenceRefresh(v => v + 1), 30000);
    return () => clearInterval(iv);
  }, []);





  const topMessages = useMemo(() => allMessages, [allMessages]);
  const pinnedMessages = useMemo(() => allMessages.filter(m => m.pinned && !m.parentMessageId), [allMessages]);
  // Antes cada fila del render buscaba su mensaje padre con allMessages.find(),
  // O(n) por mensaje visible → O(n·m) total y empeora con cada "cargar mensajes
  // anteriores". El Map se arma una vez por cambio de allMessages, lookup O(1).
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    allMessages.forEach(m => map.set(m.id, m));
    return map;
  }, [allMessages]);
  const filteredTopMessages = useMemo(() => {
    if (!searchQuery.trim()) return topMessages;
    if (searchResults !== null) {
      // El backend devuelve más reciente primero (orden natural de resultados
      // de búsqueda); se reordena ascendente para que groupedMessages (que
      // asume orden cronológico normal) no necesite un camino aparte.
      return [...searchResults].sort((a, b) => new Date(a.sentAt ?? 0).getTime() - new Date(b.sentAt ?? 0).getTime());
    }
    // Mientras la búsqueda real al servidor está en camino (debounce/en
    // vuelo), se muestra el filtro local sobre lo ya cargado como vista
    // previa instantánea, para que la caja no se sienta como que no responde.
    const q = searchQuery.toLowerCase();
    return topMessages.filter(m => m.content?.toLowerCase().includes(q) || m.senderName?.toLowerCase().includes(q));
  }, [topMessages, searchQuery, searchResults]);

  const debouncedSearch = useDebouncedCallback(async (query: string, channel: string) => {
    setSearching(true);
    try {
      const d = await searchMessages({ query, channels: [channel], limit: 100 });
      setSearchResults(d.results ?? []);
    } catch {
      setSearchResults(null); // falla la búsqueda real → se queda con el filtro local de vista previa
    }
    setSearching(false);
  }, 350);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    debouncedSearch(searchQuery.trim(), effectiveChannel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, effectiveChannel]);
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: Message[] }[] = [];
    filteredTopMessages.forEach(msg => {
      const date = msg.sentAt ? new Date(msg.sentAt).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Sin fecha';
      const last = groups[groups.length - 1];
      if (!last || last.date !== date) groups.push({ date, messages: [msg] });
      else last.messages.push(msg);
    });
    return groups;
  }, [filteredTopMessages]);

  // ── Fase B Etapa 1 (P5): Ably-aware optimistic message safety net ───────────
  // If Ably is connected, Ably's message.created event will replace the optimistic
  // message via mergeMessagesReplacingOptimistic. We only do a quick-refresh if:
  //   a) Ably is NOT connected → immediate refresh (old behavior)
  //   b) Ably IS connected but optimistic msg still present after 5s → safety refresh
  const scheduleOptimisticSafetyRefresh = (channel: string) => {
    if (realtimeStatusRef.current !== 'connected') {
      // Ably not connected — immediate refresh (fallback, old behavior)
      getMessages({ channel, since: lastSentAtRef.current ?? undefined, limit: 5 })
        .then(d => {
          if (d.messages.length > 0) {
            setAllMessages(prev => { const next = mergeMessagesReplacingOptimistic(prev, d.messages); cacheMessages(channel, next); return next; });
            const last = d.messages[d.messages.length - 1];
            if (last?.sentAt) lastSentAtRef.current = last.sentAt;
          }
        })
        .catch(() => {});
    } else {
      // Ably connected — wait 5s, then check if any optimistic msg remains
      setTimeout(() => {
        // Only refresh if we're still on the same channel
        if (effectiveChannelRef.current !== channel) return;
        setAllMessages(prev => {
          const hasOptimistic = prev.some(m => String(m.id).startsWith('optimistic-'));
          if (hasOptimistic) {
            console.log('[chat][fase-b] safety net: optimistic msg still present after 5s, refreshing');
            getMessages({ channel, since: lastSentAtRef.current ?? undefined, limit: 5 })
              .then(d => {
                if (d.messages.length > 0) {
                  setAllMessages(p => { const next = mergeMessagesReplacingOptimistic(p, d.messages); cacheMessages(channel, next); return next; });
                  const last = d.messages[d.messages.length - 1];
                  if (last?.sentAt) lastSentAtRef.current = last.sentAt;
                }
              })
              .catch(() => {});
          }
          return prev; // no state change from this check
        });
      }, 5000);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setPendingAttachments(prev => [...prev, { url: fileUrl, name: file.name, type: file.type }]);
    } catch { toast.error('Error al subir archivo'); }
    setUploading(false);
  };

  // sendMessage() ya devuelve el id real apenas el servidor confirma — se
  // estampa de inmediato sobre el mensaje optimista para que el dedupe de
  // mergeMessagesReplacingOptimistic sea por id en el camino normal, y el
  // match por contenido quede solo como red de seguridad para la carrera rara
  // donde el evento realtime llega antes que esta respuesta.
  const stampRealMessageId = (channel: string, optimisticId: string, realId: string) => {
    setAllMessages(prev => {
      const next = prev.map(m => m.id === optimisticId ? { ...m, id: realId } : m);
      cacheMessages(channel, next);
      return next;
    });
  };

  const handleSendAudio = async (file: File) => {
    if (file.size < 100) { toast.error('La grabación está vacía, intenta de nuevo'); return; }
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setSending(true);
      // Optimistic update for audio
      const optimisticAudio: Message = {
        id: `optimistic-${Date.now()}`,
        channel: effectiveChannel,
        content: ' ',
        senderEmail: myEmail,
        senderName: myName || myEmail.split('@')[0],
        sentAt: new Date().toISOString(),
        parentMessageId: undefined,
        attachments: serializeAttachments([{ url: fileUrl, name: file.name, type: file.type }]),
        pinned: false,
        reactions: undefined,
      };
      setAllMessages(prev => { const next = [...prev, optimisticAudio]; cacheMessages(effectiveChannel, next); return next; });
      const sent = await sendMessage({ channel: effectiveChannel, content: ' ', attachments: serializeAttachments([{ url: fileUrl, name: file.name, type: file.type }]) });
      stampRealMessageId(effectiveChannel, optimisticAudio.id, sent.id);
      markRead(effectiveChannel);
    } catch { toast.error('Error al enviar nota de voz'); }
    setUploading(false); setSending(false);
    // ── Fase B Etapa 1 (P5): quick-refresh conditional on Ably ──────────────
    scheduleOptimisticSafetyRefresh(effectiveChannel);
  };

  const handleSendSticker = async (emoji: string) => {
    setSending(true);
    // Optimistic update for sticker
    const optimisticSticker: Message = {
      id: `optimistic-${Date.now()}`,
      channel: effectiveChannel,
      content: emoji,
      senderEmail: myEmail,
      senderName: myName || myEmail.split('@')[0],
      sentAt: new Date().toISOString(),
      parentMessageId: undefined,
      attachments: undefined,
      pinned: false,
      reactions: undefined,
    };
    setAllMessages(prev => { const next = [...prev, optimisticSticker]; cacheMessages(effectiveChannel, next); return next; });
    try {
      const sent = await sendMessage({ channel: effectiveChannel, content: emoji });
      stampRealMessageId(effectiveChannel, optimisticSticker.id, sent.id);
      markRead(effectiveChannel);
    }
    catch { toast.error('Error al enviar sticker'); }
    setSending(false);
    // ── Fase B Etapa 1 (P5): quick-refresh conditional on Ably ──────────────
    scheduleOptimisticSafetyRefresh(effectiveChannel);
  };

  const handleInputChange = (v: string) => {
    setInput(v);
    debouncedSaveDraft(effectiveChannel, v);
  };

  const handleSend = async (resolvedContent?: string) => {
    const content = (resolvedContent ?? input).trim();
    if (!content && pendingAttachments.length === 0) return;
    const atts = [...pendingAttachments];
    const parentId = replyingTo?.id;
    setInput(''); setPendingAttachments([]); setReplyingTo(null); setSending(true);

    // Optimistic update: show message immediately
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      channel: effectiveChannel,
      content: content || ' ',
      senderEmail: myEmail,
      senderName: myName || myEmail.split('@')[0],
      sentAt: new Date().toISOString(),
      parentMessageId: parentId ?? undefined,
      attachments: atts.length ? serializeAttachments(atts) : undefined,
      pinned: false,
      reactions: undefined,
    };
    setAllMessages(prev => { const next = [...prev, optimisticMsg]; cacheMessages(effectiveChannel, next); return next; });

    // Optimistic sidebar update — reflect the sent message in the sidebar instantly
    const _nowStr = optimisticMsg.sentAt!;
    const _rawPreview = (content || '').startsWith('{"type":"poll"')
      ? '📊 Encuesta'
      : (content || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`#]/g, '').trim().slice(0, 80) || '📎 Archivo';
    setLastMessageAt(prev => {
      const next = { ...prev, [effectiveChannel]: _nowStr };
      localStorage.setItem('chat-last-message-at', JSON.stringify(next));
      return next;
    });
    if (!parentId) {
      setLastMessagePreview(prev => {
        const next = {
          ...prev,
          [effectiveChannel]: {
            content: _rawPreview,
            senderName: myName || myEmail.split('@')[0],
          },
        };
        localStorage.setItem('chat-last-message-preview', JSON.stringify(next));
        return next;
      });
    }

    try {
      const sent = await sendMessage({ channel: effectiveChannel, content: content || ' ', parentMessageId: parentId, attachments: atts.length ? serializeAttachments(atts) : undefined });
      stampRealMessageId(effectiveChannel, optimisticMsg.id, sent.id);
      saveDraft(effectiveChannel, '');
      markRead(effectiveChannel);
    } catch { toast.error('Error al enviar'); setInput(content); setPendingAttachments(atts); }
    setSending(false);
    // ── Fase B Etapa 1 (P5): quick-refresh conditional on Ably ──────────────
    scheduleOptimisticSafetyRefresh(effectiveChannel);
  };

  // useCallback (deps [myEmail]) para que MessageItem (memo) no re-renderice
  // todas las filas visibles cada vez que el padre re-renderiza por algo
  // no relacionado (typing indicator, presencia, etc.).
  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    setAllMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const r = parseReactions(m.reactions);
      const users = r[emoji] ?? [];
      r[emoji] = users.includes(myEmail) ? users.filter(u => u !== myEmail) : [...users, myEmail];
      return { ...m, reactions: serializeReactions(r) };
    }));
    try { await toggleReaction({ messageId: msgId, emoji }); } catch { /* polling corrects */ }
  }, [myEmail]);

  const handlePin = useCallback(async (msgId: string) => {
    setAllMessages(prev => prev.map(m => m.id === msgId ? { ...m, pinned: !m.pinned } : m));
    try { await togglePinMessage({ messageId: msgId }); } catch { /* polling corrects */ }
  }, []);

  const handleVote = useCallback(async (msgId: string, option: string) => {
    // Optimistic update
    setAllMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      try {
        const poll = JSON.parse(m.content ?? '');
        if (poll?.type !== 'poll') return m;
        const currentVote = Object.entries(poll.votes as Record<string, string[]>)
          .find(([, users]) => users.includes(myEmail))?.[0];
        const newVotes: Record<string, string[]> = {};
        for (const opt of poll.options as string[]) {
          newVotes[opt] = ((poll.votes as Record<string, string[]>)[opt] ?? []).filter((u: string) => u !== myEmail);
        }
        if (currentVote !== option) newVotes[option] = [...(newVotes[option] ?? []), myEmail];
        return { ...m, content: JSON.stringify({ ...poll, votes: newVotes }) };
      } catch { return m; }
    }));
    try { await votePoll({ messageId: msgId, selectedOption: option }); }
    catch { /* polling corrects */ }
  }, [myEmail]);

  // Referencia estable para las ~60+ filas de MessageItem (memo) — antes cada
  // fila recibía una arrow function nueva por render, lo que anulaba el memo.
  const handleActivateMessage = useCallback((id: string) => {
    setActiveMsgId(prev => prev === id ? null : id);
  }, []);
  const handleDocClick = useCallback((docId: string, _docName: string) => {
    const doc = projectDocs.find(d => d.id === docId);
    if (doc?.fileUrl) window.open(doc.fileUrl, '_blank', 'noopener,noreferrer');
  }, [projectDocs]);

  const handleSendPoll = async (pollContent: string) => {
    setSending(true);
    try {
      await sendMessage({ channel: effectiveChannel, content: pollContent });
      markRead(effectiveChannel);
    } catch { toast.error('Error al crear la encuesta'); }
    setSending(false);
  };

  const switchToChannel = (ch: string) => {
    saveDraft(effectiveChannel, input);
    clearReadStateForChannel(activeChannel);
    clearReadStateForChannel(ch);
    setActiveChannel(ch);
    setActiveConvId(null);
    setActiveConvLabel('');
    setInput(loadDraft(ch));
    setSearchQuery(''); setSearchOpen(false); setReplyingTo(null);
    if (window.innerWidth < 768 || isDrawer) setMobileShowChat(true);
    if (isDrawer) setHasExplicitSelection(true);
  };

  const switchToConv = (id: string, label: string) => {
    saveDraft(effectiveChannel, input);
    clearReadStateForChannel(id);
    setActiveConvId(id);
    setActiveConvLabel(label);
    setInput(loadDraft(id));
    setSearchQuery(''); setSearchOpen(false); setReplyingTo(null);
    if (window.innerWidth < 768 || isDrawer) setMobileShowChat(true);
    if (isDrawer) setHasExplicitSelection(true);
  };

  const handleNewConv = (id: string) => {
    // Refresh conversations then switch
    getChatConversations({}).then(d => {
      setDms(d.dms); setGroups(d.groups); cachedDms = d.dms; cachedGroups = d.groups;
      const dm = d.dms.find(c => c.id === id);
      const grp = d.groups.find(c => c.id === id);
      if (dm) {
        const other = dm.members.find(e => e !== myEmail) ?? '';
        const member = teamMembers.find(m => m.email === other);
        const label = member ? `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || other : other;
        switchToConv(id, label);
      } else if (grp) {
        switchToConv(id, grp.name);
      }
    }).catch(() => {});
  };

  // Derived channel lists
  const projectChannels = useMemo(() => projectChannelsWithStatus.map(p => p.code), [projectChannelsWithStatus]);
  const activeChannels = useMemo(() => projectChannelsWithStatus.filter(p => p.status === 'En curso').map(p => p.code), [projectChannelsWithStatus]);
  const archivedChannels = useMemo(() => projectChannelsWithStatus.filter(p => p.status !== 'En curso').map(p => p.code), [projectChannelsWithStatus]);

  // Sorted purely by lastMessageAt DESC — like WhatsApp.
  // Unread/mention state is visual only (bold, badge) and does NOT affect position.
  const sortedGeneralAndActive = useMemo(() => {
    const all = [{ id: 'general', isProject: false }, ...activeChannels.map(c => ({ id: c, isProject: true }))];
    return [...all].sort((a, b) =>
      (lastMessageAt[b.id] ?? '').localeCompare(lastMessageAt[a.id] ?? '')
    );
  }, [activeChannels, lastMessageAt]);

  const sortedArchivedChannels = useMemo(() => {
    return [...archivedChannels].sort((a, b) =>
      (lastMessageAt[b] ?? '').localeCompare(lastMessageAt[a] ?? '')
    );
  }, [archivedChannels, lastMessageAt]);

  const visibleMemberEmails = useMemo(() => new Set(teamMembers.map(m => m.email).filter(Boolean) as string[]), [teamMembers]);

  const sortedDms = useMemo(() => {
    return [...dms].sort((a, b) => {
      const ta = lastMessageAt[a.id] ?? a.lastMessageAt ?? '';
      const tb = lastMessageAt[b.id] ?? b.lastMessageAt ?? '';
      return tb.localeCompare(ta);
    });
  }, [dms, lastMessageAt]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const ta = lastMessageAt[a.id] ?? a.lastMessageAt ?? '';
      const tb = lastMessageAt[b.id] ?? b.lastMessageAt ?? '';
      return tb.localeCompare(ta);
    });
  }, [groups, lastMessageAt]);

  const toggleFavorite = (id: string) => {
    setFavoriteChannels(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('chat-favorite-channels', JSON.stringify([...next]));
      return next;
    });
  };



  // Map email → profilePhoto for avatar display
  const photoMap = useMemo(() => {
    const map: Record<string, string> = {};
    teamMembers.forEach(m => { if (m.email && m.profilePhoto) map[m.email] = m.profilePhoto; });
    return map;
  }, [teamMembers]);

  // Map email → full name for reaction tooltips
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    teamMembers.forEach(m => {
      if (m.email) map[m.email] = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email.split('@')[0];
    });
    return map;
  }, [teamMembers]);

  const typingNames = Object.values(typingUsers).map(t => t.name);
  const typingText = typingNames.length === 0 ? '' :
    typingNames.length === 1 ? `${typingNames[0]} está escribiendo...` :
    typingNames.length === 2 ? `${typingNames[0]} y ${typingNames[1]} están escribiendo...` :
    'Varias personas están escribiendo...';

  const getDmLabel = (dm: DMConv) => {
    const otherEmail = dm.members.find(e => e !== myEmail) ?? '';
    const member = teamMembers.find(m => m.email === otherEmail);
    return member ? `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || otherEmail : otherEmail;
  };

  const headerLabel = activeConvId
    ? activeConvLabel
    : activeChannel;

  const inputPlaceholder = activeConvId
    ? `Escribe a ${activeConvLabel}...`
    : `Escribe en #${activeChannel}... @ personas · # proyectos · ! eventos · / grupos · + tareas · $ documentos`;

  const toggleSound = () => setSoundEnabled(v => { localStorage.setItem('chat-sound-enabled', String(!v)); return !v; });

  return (
    <div className="flex h-full">
      <CreateTaskFromMessageDialog
        open={!!taskMessage} onClose={() => setTaskMessage(null)}
        message={taskMessage} activeChannel={activeChannel}
        projectChannels={projectChannels} teamMembers={teamMembers}
      />
      <NewDMDialog
        open={showNewDM} onClose={() => setShowNewDM(false)}
        teamMembers={teamMembers} myEmail={myEmail}
        onCreate={handleNewConv}
      />
      <NewGroupDialog
        open={showNewGroup} onClose={() => setShowNewGroup(false)}
        teamMembers={teamMembers} myEmail={myEmail}
        onCreate={handleNewConv}
      />
      <CreatePollDialog
        open={showPollDialog} onClose={() => setShowPollDialog(false)}
        onSend={handleSendPoll}
      />
      <TimelinePreviewDialog
        open={docPreview.open}
        onOpenChange={open => setDocPreview(prev => ({ ...prev, open }))}
        fileUrl={docPreview.fileUrl}
        projectName={docPreview.docName}
      />

      {/* Sidebar */}
      {!projectOnly && (
        <aside className={`border-r border-border bg-card flex-shrink-0 flex flex-col ${mobileShowChat ? 'hidden md:flex md:w-72' : 'w-full md:w-72'}`}>
          {isDrawer && (
            <div className="flex items-center px-4 py-3 border-b border-border flex-shrink-0">
              {onClose && (
                <button onClick={onClose} className="p-1.5 -ml-1 mr-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <MessageSquare className="w-4 h-4 text-primary mr-2" />
              <span className="font-semibold text-sm">Chat</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <div className="py-2 space-y-1">

              {/* Favorites */}
              {favoriteChannels.size > 0 && (
                <SidebarSection
                  title="Favoritos" icon={<Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                  onAdd={() => {}} addLabel=""
                  collapsed={secFavorites} onToggle={() => setSecFavorites(v => !v)}
                >
                  <div className="px-2 space-y-0.5">
                    {[{ id: 'general' }, ...projectChannels.map(c => ({ id: c }))]
                      .filter(ch => favoriteChannels.has(ch.id))
                      .map(ch => {
                        const hasMention = mentionedChannels.has(ch.id) && ch.id !== activeChannel;
                        const isActive = !activeConvId && activeChannel === ch.id;
                        const unread = !isActive ? (unreadCounts[ch.id] ?? 0) : 0;
                        return (
                          <button key={ch.id} onClick={() => switchToChannel(ch.id)}
                            className={`group/ch w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                              isActive ? 'bg-primary/10 text-primary font-semibold' : (unread > 0 || hasMention) ? 'text-foreground hover:bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}>
                            <Hash className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate flex-1">{ch.id}</span>
                            {unread > 0 && (
                              <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0 leading-none ${hasMention ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
                                {unread > 99 ? '99+' : unread}
                              </span>
                            )}
                            <button onClick={e => { e.stopPropagation(); toggleFavorite(ch.id); }}
                              className="opacity-0 group-hover/ch:opacity-100 transition-opacity p-0.5 rounded text-amber-400 hover:bg-muted">
                              <Star className="w-3 h-3 fill-current" />
                            </button>
                          </button>
                        );
                      })}
                  </div>
                </SidebarSection>
              )}

              {/* Channels */}
              <SidebarSection
                title="Canales" icon={<Hash className="w-3 h-3 text-muted-foreground" />}
                onAdd={() => {}} addLabel="Nuevo canal"
                collapsed={secChannels} onToggle={() => setSecChannels(v => !v)}
                badgeCount={['general', ...activeChannels, ...archivedChannels].filter(c => (unreadCounts[c] ?? 0) > 0).length}
                hasMention={['general', ...activeChannels, ...archivedChannels].some(c => (unreadCounts[c] ?? 0) > 0 && mentionedChannels.has(c))}
              >
                <div className="max-h-[40vh] overflow-y-auto">
                <div className="px-2 space-y-0.5">
                  {/* Search bar */}
                  <div className="flex items-center gap-1.5 px-2 mb-1 bg-muted/50 border border-border/40 rounded-lg h-7">
                    <Search className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                    <input
                      value={channelSearch}
                      onChange={e => setChannelSearch(e.target.value)}
                      placeholder="Buscar canal..."
                      className="bg-transparent text-xs flex-1 outline-none placeholder:text-muted-foreground/40 min-w-0"
                    />
                    {channelSearch && (
                      <button onClick={() => setChannelSearch('')} className="text-muted-foreground/60 hover:text-muted-foreground flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* General + active project channels — sorted by unread */}
                  {sortedGeneralAndActive
                    .filter(ch => !channelSearch || ch.id.toLowerCase().includes(channelSearch.toLowerCase()))
                    .map(ch => {
                      const hasMention = mentionedChannels.has(ch.id) && ch.id !== activeChannel;
                      const isActive = !activeConvId && activeChannel === ch.id;
                      const isFav = favoriteChannels.has(ch.id);
                      const unread = !isActive ? (unreadCounts[ch.id] ?? 0) : 0;
                      return (
                        <button key={ch.id} onClick={() => switchToChannel(ch.id)}
                          className={`group/ch w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                            isActive ? 'bg-primary/10 text-primary font-semibold' : (unread > 0 || hasMention) ? 'text-foreground hover:bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}>
                          <Hash className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span className="truncate block text-sm leading-tight">{ch.id}</span>
                            {lastMessagePreview[ch.id] && (
                              <span className="text-xs text-muted-foreground/60 truncate leading-tight">
                                {lastMessagePreview[ch.id].senderName.split(' ')[0]}: {lastMessagePreview[ch.id].content}
                              </span>
                            )}
                          </div>
                          {unread > 0 && (
                            <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0 leading-none mt-0.5 ${hasMention ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                          <button
                            onClick={e => { e.stopPropagation(); toggleFavorite(ch.id); }}
                            title={isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                            className={`p-0.5 rounded transition-all hover:bg-muted ${isFav ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover/ch:opacity-100 text-muted-foreground/40 hover:text-amber-400'}`}>
                            <Star className={`w-3 h-3 ${isFav ? 'fill-current' : ''}`} />
                          </button>
                        </button>
                      );
                    })}

                  {/* Archived toggle */}
                  {(() => {
                    const visibleArchived = sortedArchivedChannels.filter(c => !channelSearch || c.toLowerCase().includes(channelSearch.toLowerCase()));
                    if (visibleArchived.length === 0) return null;
                    return (
                      <>
                        <button onClick={() => setShowArchived(v => !v)}
                          className="w-full flex items-center gap-1 px-3 py-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded-lg hover:bg-muted/50">
                          {showArchived ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          <span>Archivados ({archivedChannels.length})</span>
                        </button>
                        {showArchived && visibleArchived.map(c => {
                          const hasMention = mentionedChannels.has(c) && c !== activeChannel;
                          const isActive = !activeConvId && activeChannel === c;
                          const isFav = favoriteChannels.has(c);
                          const unread = !isActive ? (unreadCounts[c] ?? 0) : 0;
                          return (
                            <button key={c} onClick={() => switchToChannel(c)}
                              className={`group/ch w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                                isActive ? 'bg-primary/10 text-primary font-semibold' : unread > 0 ? 'text-muted-foreground hover:bg-muted font-semibold' : 'text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground'
                              }`}>
                              <Hash className="w-3 h-3 flex-shrink-0 opacity-50 mt-0.5" />
                              <div className="flex-1 min-w-0 flex flex-col">
                                <span className="truncate block text-xs italic leading-tight">{c}</span>
                                {lastMessagePreview[c] && (
                                  <span className="text-xs text-muted-foreground/60 truncate leading-tight not-italic">
                                    {lastMessagePreview[c].senderName.split(' ')[0]}: {lastMessagePreview[c].content}
                                  </span>
                                )}
                              </div>
                              {unread > 0 && (
                                <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0 leading-none ${hasMention ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
                                  {unread > 99 ? '99+' : unread}
                                </span>
                              )}
                              <button
                                onClick={e => { e.stopPropagation(); toggleFavorite(c); }}
                                className={`p-0.5 rounded transition-all hover:bg-muted ${isFav ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover/ch:opacity-100 text-muted-foreground/40 hover:text-amber-400'}`}>
                                <Star className={`w-3 h-3 ${isFav ? 'fill-current' : ''}`} />
                              </button>
                            </button>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
                </div>
              </SidebarSection>

              {/* Direct Messages */}
              <SidebarSection
                title="Mensajes directos" icon={<MessageCircle className="w-3 h-3 text-muted-foreground" />}
                onAdd={() => setShowNewDM(true)} addLabel="Nuevo DM"
                collapsed={secDMs} onToggle={() => setSecDMs(v => !v)}
                badgeCount={dms.filter(d => (unreadCounts[d.id] ?? 0) > 0).length}
                hasMention={dms.some(d => (unreadCounts[d.id] ?? 0) > 0)}
              >
                <div className="max-h-[30vh] overflow-y-auto">
                <div className="px-2 space-y-0.5">
                  {/* DM search — always visible */}
                  <div className="flex items-center gap-1.5 px-2 mb-1 bg-muted/50 border border-border/40 rounded-lg h-7">
                    <Search className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                    <input
                      value={dmSearch}
                      onChange={e => setDmSearch(e.target.value)}
                      placeholder="Buscar persona..."
                      className="bg-transparent text-xs flex-1 outline-none placeholder:text-muted-foreground/40 min-w-0"
                    />
                    {dmSearch && (
                      <button onClick={() => setDmSearch('')} className="text-muted-foreground/60 hover:text-muted-foreground flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Existing DMs */}
                  {dms.filter(dm => { const other = dm.members.find(e => e !== myEmail); return !other || visibleMemberEmails.size === 0 || visibleMemberEmails.has(other); }).length === 0 && !dmSearch && (
                    <p className="px-3 py-2 text-xs text-muted-foreground italic">Sin mensajes directos</p>
                  )}
                  {sortedDms
                    .filter(dm => { const other = dm.members.find(e => e !== myEmail); return !other || visibleMemberEmails.size === 0 || visibleMemberEmails.has(other); })
                    .filter(dm => !dmSearch || getDmLabel(dm).toLowerCase().includes(dmSearch.toLowerCase()))
                    .map(dm => {
                      const label = getDmLabel(dm);
                      const isActive = activeConvId === dm.id;
                      const unread = !isActive ? (unreadCounts[dm.id] ?? 0) : 0;
                      const otherEmailForDm = dm.members.find(e => e !== myEmail) ?? '';
                      const dmPhotoUrl = photoMap[otherEmailForDm];
                      return (
                        <button key={dm.id} onClick={() => switchToConv(dm.id, label)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
                            isActive ? 'bg-primary/10 text-primary font-semibold' : unread > 0 ? 'text-foreground hover:bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}>
                          <Avatar name={label} email={otherEmailForDm} size={6} photoUrl={dmPhotoUrl} />
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span className="truncate block text-sm leading-tight">{label}</span>
                            {lastMessagePreview[dm.id] && (
                              <span className="text-xs text-muted-foreground/60 truncate leading-tight">
                                {lastMessagePreview[dm.id].content}
                              </span>
                            )}
                          </div>
                          {unread > 0 && (
                            <span className="min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0 leading-none">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                          {(() => {
                            const pres = presenceMap[otherEmailForDm];
                            const isOnline = pres?.lastSeenAt
                              ? (Date.now() - new Date(pres.lastSeenAt).getTime()) < 3 * 60 * 1000
                              : false;
                            return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />;
                          })()}
                        </button>
                      );
                    })}

                  {/* Suggestions: team members without an existing DM */}
                  {(() => {
                    if (!dmSearch.trim()) return null;
                    const existingEmails = new Set(dms.flatMap(dm => dm.members));
                    const q = dmSearch.toLowerCase();
                    const suggestions = teamMembers.filter(m => {
                      if (!m.email || m.email === myEmail || existingEmails.has(m.email)) return false;
                      const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim().toLowerCase();
                      return name.includes(q) || m.email.toLowerCase().includes(q);
                    });
                    if (suggestions.length === 0) return null;
                    return (
                      <>
                        <div className="px-2 pt-2 pb-0.5">
                          <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Iniciar conversación</span>
                        </div>
                        {suggestions.map(m => {
                          const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?';
                          const isOnline = activeEmails.has(m.email ?? '');
                          return (
                            <button
                              key={m.id}
                              onClick={async () => {
                                try {
                                  const res = await saveChatConversation({ type: 'dm', targetEmail: m.email! });
                                  setDmSearch('');
                                  handleNewConv(res.id);
                                } catch { toast.error('Error al crear conversación'); }
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Avatar name={name} email={m.email} size={6} photoUrl={m.profilePhoto ?? undefined} />
                              <span className="truncate flex-1">{name}</span>
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                            </button>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
                </div>
              </SidebarSection>

              {/* Groups */}
              <SidebarSection
                title="Grupos" icon={<Users className="w-3 h-3 text-muted-foreground" />}
                onAdd={() => setShowNewGroup(true)} addLabel="Nuevo grupo"
                collapsed={secGroups} onToggle={() => setSecGroups(v => !v)}
                badgeCount={groups.filter(g => (unreadCounts[g.id] ?? 0) > 0).length}
                hasMention={groups.some(g => (unreadCounts[g.id] ?? 0) > 0 && mentionedChannels.has(g.id))}
              >
                <div className="max-h-[25vh] overflow-y-auto">
                <div className="px-2 space-y-0.5">
                  {/* Group search */}
                  {groups.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2 mb-1 bg-muted/50 border border-border/40 rounded-lg h-7">
                      <Search className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                      <input
                        value={groupSearch}
                        onChange={e => setGroupSearch(e.target.value)}
                        placeholder="Buscar grupo..."
                        className="bg-transparent text-xs flex-1 outline-none placeholder:text-muted-foreground/40 min-w-0"
                      />
                      {groupSearch && (
                        <button onClick={() => setGroupSearch('')} className="text-muted-foreground/60 hover:text-muted-foreground flex-shrink-0">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {groups.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground italic">Sin grupos</p>
                  )}
                  {sortedGroups
                    .filter(grp => !groupSearch || grp.name.toLowerCase().includes(groupSearch.toLowerCase()))
                    .map(grp => {
                      const isActive = activeConvId === grp.id;
                      const unread = !isActive ? (unreadCounts[grp.id] ?? 0) : 0;
                      const hasMention = mentionedChannels.has(grp.id) && !isActive;
                      return (
                        <button key={grp.id} onClick={() => switchToConv(grp.id, grp.name)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
                            isActive ? 'bg-primary/10 text-primary font-semibold' : unread > 0 ? 'text-foreground hover:bg-muted font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}>
                          <div className="w-6 h-6 rounded-full bg-chart-4/80 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Users className="w-3 h-3 text-primary-foreground" />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span className="truncate block text-sm leading-tight">{grp.name}</span>
                            {lastMessagePreview[grp.id] && (
                              <span className="text-xs text-muted-foreground/60 truncate leading-tight">
                                {lastMessagePreview[grp.id].senderName.split(' ')[0]}: {lastMessagePreview[grp.id].content}
                              </span>
                            )}
                          </div>
                          {unread > 0 ? (
                            <span className={`min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center px-1 flex-shrink-0 leading-none ${hasMention ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
                              {unread > 99 ? '99+' : unread}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">{grp.members.length}</span>
                          )}
                        </button>
                      );
                    })}
                  {groupSearch && groups.length > 0 && groups.filter(grp => grp.name.toLowerCase().includes(groupSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground/60 italic">Sin resultados</p>
                  )}
                </div>
                </div>
              </SidebarSection>
            </div>
          </div>

          {/* User footer */}
          <div className="px-4 py-3 border-t text-xs text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="truncate">{myName || user?.email?.split('@')[0]}</span>
          </div>
        </aside>
      )}

      {/* Main */}
      <div className={`${!projectOnly && !mobileShowChat ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0 overflow-hidden`}>
        {isDrawer && !hasExplicitSelection && (
          <div className="flex flex-1 flex-col items-center justify-center text-center p-12 bg-muted/5 select-none">
            <div className="w-24 h-24 rounded-full bg-muted/60 flex items-center justify-center mb-6">
              <MessageSquare className="w-12 h-12 text-muted-foreground/25" />
            </div>
            <h3 className="text-base font-semibold text-muted-foreground/60 mb-2">Selecciona una conversación</h3>
            <p className="text-sm text-muted-foreground/40 max-w-[220px] leading-relaxed">
              Elige un canal, mensaje directo o grupo para empezar a chatear
            </p>
          </div>
        )}
        {(!isDrawer || hasExplicitSelection) && <>
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b bg-card flex-shrink-0">
          {!projectOnly && (
            <button
              onClick={() => setMobileShowChat(false)}
              className="md:hidden -ml-2 mr-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {activeConvId ? (
            activeConvLabel && groups.find(g => g.id === activeConvId)
              ? <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              : <MessageCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <Hash className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          <span className="font-semibold truncate">{headerLabel}</span>
          {(() => {
            const currentDm = activeConvId ? dms.find(d => d.id === activeConvId) : null;
            const isDm1to1 = !!currentDm;
            if (!isDm1to1) return null;
            const otherEmail = currentDm.members.find(e => e !== myEmail) ?? '';
            const otherPresence = presenceMap[otherEmail];
            const now = Date.now();
            const lastSeenAt = otherPresence?.lastSeenAt;
            let dot = 'bg-muted-foreground/30';
            let text = 'Sin conexión';
            if (lastSeenAt) {
              const diffMs = now - new Date(lastSeenAt).getTime();
              const diffMin = Math.round(diffMs / 60000);
              if (diffMs < 3 * 60 * 1000) {
                dot = 'bg-emerald-500';
                text = otherPresence?.activeChannel === effectiveChannel ? 'Activo en este chat' : 'En línea';
              } else if (diffMs < 30 * 60 * 1000) {
                text = `Activo hace ${diffMin} min`;
              }
            }
            return (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1 shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                {text}
              </span>
            );
          })()}
          {activeConvId && groups.find(g => g.id === activeConvId) && (
            <span className="text-sm text-muted-foreground hidden sm:inline shrink-0">
              — {groups.find(g => g.id === activeConvId)?.members.length} miembros
            </span>
          )}
          {!activeConvId && (
            <span className="text-sm text-muted-foreground hidden sm:inline shrink-0">— {topMessages.length} mensajes</span>
          )}
          {!activeConvId && projectChannels.includes(activeChannel) && (
            <button
              onClick={() => navigate(`/operacion/proyectos/${activeChannel}`)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded-md px-2 py-1 transition-colors ml-1 shrink-0"
              title="Ir al proyecto"
            >
              <ExternalLink className="w-3 h-3" />
              <span className="hidden sm:inline">Ir al proyecto</span>
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={toggleSound} title={soundEnabled ? 'Silenciar' : 'Activar notificaciones'}
              className={`p-1.5 rounded transition-colors hover:bg-muted ${soundEnabled ? 'text-muted-foreground hover:text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}>
              {soundEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            </button>
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium select-none ${
              realtimeStatus === 'connected' ? 'text-emerald-600 bg-emerald-500/10' :
              realtimeStatus === 'connecting' ? 'text-amber-600 bg-amber-500/10' :
              realtimeStatus === 'error' ? 'text-destructive bg-destructive/10' :
              'text-muted-foreground bg-muted'
            }`} title={`Realtime: ${realtimeStatus}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                realtimeStatus === 'connected' ? 'bg-emerald-500' :
                realtimeStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                realtimeStatus === 'error' ? 'bg-destructive' :
                'bg-muted-foreground/40'
              }`} />
              {realtimeStatus === 'connected' ? 'RT' :
               realtimeStatus === 'connecting' ? 'RT…' :
               realtimeStatus === 'error' ? 'RT!' :
               'RT off'}
            </div>
            {pinnedMessages.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-amber-600">
                    <Pin className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{pinnedMessages.length}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 p-2 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground px-1 mb-1.5">Mensajes fijados</p>
                  {pinnedMessages.map(m => (
                    <div key={m.id} className="px-2 py-1.5 rounded-md bg-muted/40 text-sm">
                      <div className="text-xs text-muted-foreground mb-0.5">{m.senderName}</div>
                      <div className="truncate">{m.content}</div>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {searchOpen ? (
              <div className="flex items-center gap-1">
                <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar..." className="h-7 text-xs w-40" autoFocus />
                <button onClick={() => { setSearchOpen(false); setSearchQuery(''); }} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSearchOpen(true)}>
                <Search className="w-3.5 h-3.5" />
              </Button>
            )}

          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto py-4">
          {/* Reconnecting banner — shows when incremental fetches are failing */}
          {messagesFetchError && !loading && (
            <div className="sticky top-0 z-10 mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm shadow-sm">
              <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/60 border-t-muted-foreground animate-spin flex-shrink-0" />
              <span>Reconectando mensajes...</span>
            </div>
          )}
          {loading ? (
            <div className="px-5 space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
                  <div className="space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-64" /></div>
                </div>
              ))}
            </div>
          ) : filteredTopMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-12">
              {activeConvId
                ? <MessageCircle className="w-10 h-10 text-muted-foreground mb-3" />
                : <MessageSquare className="w-10 h-10 text-muted-foreground mb-3" />}
              <p className="text-sm font-medium">{searchQuery ? 'Sin resultados' : `Sin mensajes aún`}</p>
              <p className="text-xs text-muted-foreground mt-1">{searchQuery ? 'Prueba con otras palabras' : 'Sé el primero en escribir algo.'}</p>
            </div>
          ) : (
            <>
              {!searchQuery && hasMoreOlder && (
                <div className="flex justify-center py-2">
                  <button
                    onClick={loadOlderMessages}
                    disabled={loadingOlder}
                    className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 px-3 py-1 rounded-md hover:bg-muted transition-colors"
                  >
                    {loadingOlder ? 'Cargando...' : 'Cargar mensajes anteriores'}
                  </button>
                </div>
              )}
              {groupedMessages.map(({ date, messages: dayMsgs }) => (
              <div key={date}>
                <div className="flex items-center gap-3 px-5 py-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground bg-background px-2 capitalize">{date}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {dayMsgs.map(msg => {
                  const parentMsg = msg.parentMessageId ? messagesById.get(msg.parentMessageId) : undefined;
                  return (
                    <MessageItem key={msg.id} msg={msg} isOwn={msg.senderEmail === myEmail} myEmail={myEmail}
                      onReply={setReplyingTo} onPin={handlePin} onReact={handleReact} onCreateTask={setTaskMessage} onVote={handleVote}
                      parentMsg={parentMsg}
                      activeChannel={activeChannel}
                      senderPhotoUrl={msg.senderEmail ? photoMap[msg.senderEmail] : undefined}
                      nameMap={nameMap}
                      isActiveActions={activeMsgId === msg.id}
                      onActivate={handleActivateMessage}
                      onDocClick={handleDocClick} />
                  );
                })}
              </div>
            ))}
            </>
          )}
          <div ref={bottomRef} />
        </div>



        {typingText && (
          <div className="px-5 pb-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex gap-0.5 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
              <span>{typingText}</span>
            </div>
          </div>
        )}
        <div className="px-5 pb-5 pt-1 flex-shrink-0">
          <ChatInput
            value={input} onChange={handleInputChange} onSend={handleSend}
            onFileUpload={handleFileUpload} onSendAudio={handleSendAudio} onSendSticker={handleSendSticker}
            sending={sending} uploading={uploading}
            pendingAttachments={pendingAttachments}
            onRemoveAttachment={i => setPendingAttachments(p => p.filter((_, idx) => idx !== i))}
            placeholder={inputPlaceholder}
            teamMembers={teamMembers} projectChannels={projectChannels}
            replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)}
            onCreatePoll={() => setShowPollDialog(true)}
            onTyping={() => { publishTyping({ channel: effectiveChannel }).catch(() => {}); }}
            events={chatEvents} groups={chatGroups} tasks={chatTasks}
            projectDocuments={projectDocs}
            activeChannel={effectiveChannel}
          />
        </div>
        </>}
      </div>
    </div>
  );
}
