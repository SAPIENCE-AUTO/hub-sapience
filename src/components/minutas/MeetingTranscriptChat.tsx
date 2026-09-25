import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Loader2, Sparkles, Trash2, ChevronDown, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { chatWithMeetingTranscript, getMeetingChatHistory } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Markdown } from '@/components/markdown';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
};

const SUGGESTED_QUESTIONS = [
  '¿Cuáles son los temas más mencionados?',
  '¿Hubo desacuerdos entre los participantes?',
  '¿Qué se acordó hacer y quién es responsable?',
  '¿En qué minuto se habló del presupuesto?',
];

const TIMECODE_RE = /\[(\d{1,3}):(\d{2})\]/g;

const MD_CLASS = 'prose-sm [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_h4]:text-xs [&_h4]:font-semibold [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h4]:m-0 [&_p]:m-0 [&_ul]:my-0.5 [&_li]:my-0';

function TsPill({ label, seconds, onSeekTo }: { label: string; seconds: number; onSeekTo?: (s: number) => void }) {
  return (
    <button
      onClick={() => onSeekTo?.(seconds)}
      className={`inline-flex items-center gap-0.5 mr-1.5 px-1.5 py-0.5 rounded text-xs font-mono bg-primary/10 text-primary hover:bg-primary/25 transition-colors shrink-0 ${onSeekTo ? 'cursor-pointer' : 'pointer-events-none'}`}
      title={onSeekTo ? `Ir al minuto ${label}` : label}
    >
      <Clock className="h-2.5 w-2.5 shrink-0" />
      {label}
    </button>
  );
}

// Puerto de TimestampedMessage en FloatingTranscriptChat.tsx (Sharpli) — sin
// citas estructuradas: el modelo escribe [MM:SS] en su propio texto (se lo
// pide el system prompt) y esto lo separa con una expresión regular para
// convertir cada timecode en un pill clickeable que hace seek en el video.
function TimestampedMessage({ content, onSeekTo }: { content: string; onSeekTo?: (s: number) => void }) {
  type Segment = { label: string; seconds: number; text: string };
  const segments: Segment[] = [];
  let leadingText = '';
  let lastIndex = 0;
  let lastTs: { label: string; seconds: number } | null = null;

  const re = new RegExp(TIMECODE_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (lastTs === null) {
      leadingText += before;
    } else {
      segments.push({ ...lastTs, text: before });
    }
    lastTs = { label: match[0], seconds: parseInt(match[1], 10) * 60 + parseInt(match[2], 10) };
    lastIndex = match.index + match[0].length;
  }

  const remainder = content.slice(lastIndex);
  if (lastTs) segments.push({ ...lastTs, text: remainder });
  else leadingText += remainder;

  return (
    <div className="leading-relaxed space-y-1">
      {leadingText.trim() && <Markdown className={MD_CLASS}>{leadingText}</Markdown>}
      {segments.map((seg, i) => (
        <div key={i} className="flex items-start gap-0">
          <TsPill label={seg.label} seconds={seg.seconds} onSeekTo={onSeekTo} />
          <Markdown className={`${MD_CLASS} flex-1 min-w-0`}>{seg.text || '​'}</Markdown>
        </div>
      ))}
    </div>
  );
}

function ChatBubble({ msg, onSeekTo }: { msg: Message; onSeekTo?: (s: number) => void }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
        isUser ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'
      }`}>
        {isUser ? (
          <span className="whitespace-pre-wrap">{msg.content}</span>
        ) : msg.streaming ? (
          <span className="whitespace-pre-wrap">
            {msg.content}
            <span className="inline-block w-1.5 h-3.5 bg-current animate-pulse ml-0.5 align-text-bottom opacity-70 rounded-sm" />
          </span>
        ) : (
          <TimestampedMessage content={msg.content} onSeekTo={onSeekTo} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onSuggest }: { onSuggest: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center gap-4">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <div>
        <p className="font-semibold text-foreground text-sm">Chat con la transcripción</p>
        <p className="text-muted-foreground text-xs mt-1">Pregúntame cualquier cosa sobre esta junta</p>
      </div>
      <div className="flex flex-col gap-2 w-full mt-2">
        {SUGGESTED_QUESTIONS.map(q => (
          <button key={q} onClick={() => onSuggest(q)}
            className="text-xs text-left px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// Minutas / notetaker (sep 2026): "el feature de chat en la transcripción...
// también está en sharpli ya implementado" (Sergio) — puerto de
// FloatingTranscriptChat.tsx. Misma UX (burbuja flotante que expande a un
// panel de chat, preguntas sugeridas, streaming token por token, timecodes
// clickeables que hacen seek), con una diferencia obligada: Sharpli vive en
// una página completa así que usa `fixed` contra el viewport; aquí vive
// dentro de un <Dialog>, así que se posiciona `absolute` contra la tarjeta
// del modal (que declara position:relative) en vez de flotar sobre toda la
// pantalla.
export default function MeetingTranscriptChat({
  meetingRecordingId, title, onSeekTo,
}: {
  meetingRecordingId: string;
  title?: string;
  onSeekTo?: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (open && !historyLoaded) {
      setLoadingHistory(true);
      getMeetingChatHistory({ meetingRecordingId })
        .then(res => {
          setMessages(res.messages.map((m: any) => ({ ...m, id: m.id || crypto.randomUUID() })));
          setHistoryLoaded(true);
        })
        .catch(() => toast.error('Error al cargar historial'))
        .finally(() => setLoadingHistory(false));
    }
  }, [open, historyLoaded, meetingRecordingId]);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [messages, open, scrollToBottom]);

  const sendMessage = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || sending) return;
    setInput('');

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: userText };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setSending(true);

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

      const streamResp = chatWithMeetingTranscript({
        meetingRecordingId,
        messages: history,
        userMessage: userText,
      });

      // El chunk de progreso llega como { type: 'progress', text } (server/index.ts
      // le pega `type` a lo que se le pase a stream.write) — no como string
      // suelto, a diferencia de la versión de Sharpli.
      for await (const chunk of streamResp) {
        const delta = chunk?.text ?? '';
        if (!delta) continue;
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + delta } : m));
      }

      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m));
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al enviar mensaje');
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setHistoryLoaded(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="absolute bottom-4 right-4 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        aria-label="Abrir chat IA"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X className="h-6 w-6" />
            </motion.div>
          ) : (
            <motion.div key="open" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <MessageSquare className="h-6 w-6" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="absolute bottom-20 right-4 z-50 w-[360px] max-w-[calc(100%-2rem)] h-[480px] max-h-[65%] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">Chat IA</p>
                  {title && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{title}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {messages.length > 0 && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={clearChat} title="Limpiar chat">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setOpen(false)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {loadingHistory ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : messages.length === 0 ? (
                <EmptyState onSuggest={q => { setInput(q); textareaRef.current?.focus(); }} />
              ) : (
                <>
                  {messages.map(msg => <ChatBubble key={msg.id} msg={msg} onSeekTo={onSeekTo} />)}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <div className="shrink-0 px-3 pb-3 pt-2 border-t border-border bg-card">
              <div className="flex items-end gap-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pregunta sobre la transcripción…"
                  className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm rounded-xl py-2.5 px-3"
                  disabled={sending}
                  rows={1}
                />
                <Button size="icon" className="h-10 w-10 rounded-xl shrink-0" onClick={() => sendMessage()} disabled={!input.trim() || sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Enter para enviar · Shift+Enter para nueva línea</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
