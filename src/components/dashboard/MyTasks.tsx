import React, { useState, useEffect } from 'react';
import { GetDashboardDataOutputType, GetTaskCommentsOutputType } from 'zite-endpoints-sdk';
import { updateDashboardTask, getTaskComments } from 'zite-endpoints-sdk';
import { CheckSquare, ArrowRight, Calendar, Folder, LayoutGrid, ExternalLink, Loader2, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../../context/ProjectContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarPicker } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

type Task = GetDashboardDataOutputType['myTasks'][0];
type TaskComment = GetTaskCommentsOutputType['comments'][0];
type Filter = 'all' | 'pending' | 'inprogress';

const DEFAULT_STATUS_OPTIONS = ['Pendiente', 'En progreso', 'Completada', 'Bloqueada'];

const statusStyle: Record<string, string> = {
  'Pendiente':   'bg-muted text-muted-foreground',
  'En progreso': 'bg-sky-100 text-sky-700',
  'Completada':  'bg-emerald-100 text-emerald-700',
  'Bloqueada':   'bg-destructive/10 text-destructive',
};

const statusDot: Record<string, string> = {
  'Pendiente':   'bg-muted-foreground',
  'En progreso': 'bg-sky-500',
  'Completada':  'bg-emerald-500',
  'Bloqueada':   'bg-destructive',
};

function getInitials(name?: string) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// Parse task/project mentions from chat message content into readable chips
function CommentContent({ content }: { content?: string }) {
  if (!content) return null;
  const taskRe = /\[✅\s*([^\]]+)\]\(task:[^)]+\)/g;
  const projectRe = /\[#([^\]]+)\]\([^)]+\)/g;
  const combined = /(\[✅\s*[^\]]+\]\(task:[^)]+\)|\[#[^\]]+\]\([^)]+\))/g;

  const hasSpecial = taskRe.test(content) || projectRe.test(content);
  taskRe.lastIndex = 0; projectRe.lastIndex = 0;

  if (!hasSpecial) {
    return <span className="text-xs text-muted-foreground">{content}</span>;
  }

  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  combined.lastIndex = 0;
  while ((m = combined.exec(content)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`txt-${last}`} className="text-xs text-muted-foreground">{content.slice(last, m.index)}</span>);
    }
    const token = m[0];
    if (token.startsWith('[✅')) {
      const nameMatch = token.match(/\[✅\s*([^\]]+)\]/);
      const name = nameMatch ? nameMatch[1].trim() : 'Tarea';
      parts.push(
        <span key={`task-${m.index}`} className="inline-flex items-center gap-0.5 bg-chart-3/15 text-chart-3 text-[11px] font-medium px-1.5 py-0.5 rounded-md mx-0.5">
          ✅ {name}
        </span>
      );
    } else {
      const nameMatch = token.match(/\[#([^\]]+)\]/);
      const name = nameMatch ? nameMatch[1].trim() : 'Proyecto';
      parts.push(
        <span key={`proj-${m.index}`} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary text-[11px] font-medium px-1.5 py-0.5 rounded-md mx-0.5">
          #{name}
        </span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    parts.push(<span key={`txt-end`} className="text-xs text-muted-foreground">{content.slice(last)}</span>);
  }
  return <span className="inline leading-relaxed">{parts}</span>;
}

// ── Task Detail Dialog ────────────────────────────────────────────────────────
function TaskDetailDialog({
  task, open, onClose, onUpdate,
}: {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (taskId: string, updates: { status?: string; endDate?: string }) => void;
}) {
  const navigate = useNavigate();
  const { setSelectedProject } = useProject();
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  useEffect(() => {
    if (!open || !task) return;
    setLoadingComments(true);
    getTaskComments({ taskId: task.id })
      .then(d => setComments(d.comments))
      .catch(() => {})
      .finally(() => setLoadingComments(false));
  }, [open, task?.id]);

  if (!task) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  const overdue = !!task.endDate && task.endDate < todayStr && task.status !== 'Completada';
  const options = task.statusOptions && task.statusOptions.length > 0 ? task.statusOptions : DEFAULT_STATUS_OPTIONS;

  const selectedDate = task.endDate ? parseISO(task.endDate + 'T00:00:00') : undefined;

  const handleStatusChange = async (newStatus: string) => {
    setSavingStatus(true);
    try {
      await updateDashboardTask({ taskId: task.id, newStatus });
      onUpdate(task.id, { status: newStatus });
    } catch { /* ignore */ } finally {
      setSavingStatus(false);
    }
  };

  const handleDateSelect = async (date: Date | undefined) => {
    if (!date) return;
    setDateOpen(false);
    const newEndDate = format(date, 'yyyy-MM-dd');
    setSavingDate(true);
    try {
      await updateDashboardTask({ taskId: task.id, newEndDate });
      onUpdate(task.id, { endDate: newEndDate });
    } catch { /* ignore */ } finally {
      setSavingDate(false);
    }
  };

  const handleGoToBoard = () => {
    if (task.projectCode) setSelectedProject(task.projectCode);
    navigate('/pm');
    onClose();
  };

  const displayedComments = comments.slice(-10);
  const hiddenCount = comments.length > 10 ? comments.length - 10 : 0;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${statusDot[task.status ?? ''] ?? 'bg-muted-foreground'}`} />
            <DialogTitle className="text-left text-base font-semibold leading-snug">
              {task.taskName ?? 'Sin nombre'}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Project + Board */}
          <div className="flex gap-4">
            {task.projectCode && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Folder className="w-3.5 h-3.5" />
                <span className="font-medium text-foreground">{task.projectCode}</span>
              </div>
            )}
            {task.boardName && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>{task.boardName}</span>
              </div>
            )}
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Estado</p>
            <div className="flex items-center gap-2">
              <Select value={task.status ?? ''} onValueChange={handleStatusChange} disabled={savingStatus}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue placeholder="Sin estado" />
                </SelectTrigger>
                <SelectContent>
                  {options.map(opt => (
                    <SelectItem key={opt} value={opt}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${statusDot[opt] ?? 'bg-muted-foreground'}`} />
                        {opt}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {savingStatus && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Vencimiento</p>
            <div className="flex items-center gap-2">
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={`h-8 text-xs justify-start gap-2 flex-1 font-normal ${overdue ? 'border-destructive text-destructive' : ''}`}>
                    <Calendar className="w-3.5 h-3.5" />
                    {task.endDate
                      ? format(parseISO(task.endDate + 'T00:00:00'), 'd MMM yyyy', { locale: es })
                      : 'Sin fecha'}
                    {overdue && <span className="ml-auto text-[10px] bg-destructive/10 text-destructive px-1.5 rounded-full font-semibold">Vencida</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleDateSelect}
                    locale={es}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              {savingDate && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {/* Chat conversation history */}
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Conversación en chat
            </p>
            {loadingComments ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 py-2 italic">Sin menciones en el chat</p>
            ) : (
              <div className="space-y-2">
                {hiddenCount > 0 && (
                  <p className="text-xs text-muted-foreground/60 text-center py-1">
                    +{hiddenCount} comentario{hiddenCount !== 1 ? 's' : ''} más en el chat
                  </p>
                )}
                {displayedComments.map(c => (
                  <div key={c.id} className="flex gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/50">
                    <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                      {getInitials(c.senderName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-semibold truncate">{c.senderName ?? c.senderEmail ?? 'Usuario'}</span>
                        {c.isThreadReply && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-normal">Respuesta</Badge>
                        )}
                        {c.sentAt && (
                          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                            {formatDistanceToNow(new Date(c.sentAt), { addSuffix: true, locale: es })}
                          </span>
                        )}
                      </div>
                      <div className="line-clamp-2"><CommentContent content={c.content} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          <Button onClick={handleGoToBoard} className="w-full gap-2 h-9 text-sm">
            Ir al board
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MyTasks({ tasks: initialTasks }: { tasks: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<Filter>('pending');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => { setTasks(initialTasks); }, [initialTasks]);

  const handleUpdate = (taskId: string, updates: { status?: string; endDate?: string }) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, ...updates } : prev);
  };

  const counts = {
    all: tasks.length,
    pending: tasks.filter(t => t.status === 'Pendiente').length,
    inprogress: tasks.filter(t => t.status === 'En progreso').length,
  };

  const filtered = tasks.filter(t => {
    if (filter === 'pending') return t.status === 'Pendiente';
    if (filter === 'inprogress') return t.status === 'En progreso';
    return true;
  });

  const todayStr = new Date().toISOString().split('T')[0];
  const isOverdue = (d?: string) => !!d && d < todayStr;

  const filterBtns: { key: Filter; label: string }[] = [
    { key: 'pending',    label: `Pendientes (${counts.pending})` },
    { key: 'inprogress', label: `En progreso (${counts.inprogress})` },
    { key: 'all',        label: `Todas (${counts.all})` },
  ];

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {filterBtns.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center bg-muted/20 rounded-xl border border-dashed border-border">
            <CheckSquare className="w-7 h-7 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {filter === 'pending' ? '¡Sin tareas pendientes! 🎉' : 'Sin tareas en esta categoría'}
            </p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
              {filtered.slice(0, 50).map(t => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTask(t)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors cursor-pointer group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {t.taskName}
                    </div>
                    {t.projectCode && (
                      <div className="text-xs text-muted-foreground">{t.projectCode}</div>
                    )}
                  </div>

                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusStyle[t.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                    {t.status ?? '—'}
                  </span>

                  {t.endDate ? (
                    <span className={`text-xs flex-shrink-0 tabular-nums ${
                      isOverdue(t.endDate) && t.status !== 'Completada'
                        ? 'text-destructive font-semibold'
                        : 'text-muted-foreground'
                    }`}>
                      {format(parseISO(t.endDate + 'T00:00:00'), 'd/M/yy')}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/40 flex-shrink-0">—</span>
                  )}

                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary flex-shrink-0 transition-colors" />
                </div>
              ))}
            </div>
            {filtered.length > 50 && (
              <div className="px-4 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
                +{filtered.length - 50} tareas más — ve a Proyectos para verlas todas
              </div>
            )}
          </div>
        )}
      </div>

      <TaskDetailDialog
        task={selectedTask}
        open={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdate={handleUpdate}
      />
    </>
  );
}
