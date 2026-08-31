import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, RotateCcw, AlertTriangle, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { getTrashItems, restoreFromTrash, permanentlyDelete, GetTrashItemsOutputType } from 'zite-endpoints-sdk';

type TrashBoard = GetTrashItemsOutputType['boards'][0];
type TrashRow = GetTrashItemsOutputType['rows'][0];
type TrashTask = GetTrashItemsOutputType['tasks'][0];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectCode: string;
  onRestored: () => void;
}

function daysLeft(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, 10 - Math.floor(elapsed / (24 * 60 * 60 * 1000)));
}

function DaysLeftBadge({ deletedAt }: { deletedAt: string }) {
  const d = daysLeft(deletedAt);
  const color = d <= 2 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground';
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${color}`}>
      {d === 0 ? 'Expira hoy' : `${d} día${d === 1 ? '' : 's'} restante${d === 1 ? '' : 's'}`}
    </span>
  );
}

function DeletedByLabel({ deletedBy, deletedAt }: { deletedBy?: string; deletedAt: string }) {
  const date = new Date(deletedAt);
  const dateStr = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex items-center gap-1 mt-1">
      <UserX className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      <span className="text-[11px] text-muted-foreground truncate">
        {deletedBy
          ? <><span className="font-medium text-foreground">{deletedBy}</span> · {dateStr} {timeStr}</>
          : <span className="italic">{dateStr} {timeStr}</span>
        }
      </span>
    </div>
  );
}

export function TrashSheet({ open, onOpenChange, projectCode, onRestored }: Props) {
  const [loading, setLoading] = useState(false);
  const [boards, setBoards] = useState<TrashBoard[]>([]);
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [tasks, setTasks] = useState<TrashTask[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  const reload = async () => {
    if (!projectCode) return;
    setLoading(true);
    try {
      const data = await getTrashItems({ projectCode });
      setBoards(data.boards);
      setRows(data.rows);
      setTasks(data.tasks);
    } catch {
      toast.error('Error al cargar la papelera');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
  }, [open, projectCode]);

  const restoreBoard = async (board: TrashBoard) => {
    setRestoringId(board.boardId);
    try {
      await restoreFromTrash({ type: 'board', boardId: board.boardId, boardName: board.boardName, projectCode });
      setBoards(prev => prev.filter(b => b.boardId !== board.boardId));
      toast.success(`Tablero "${board.boardName}" restaurado`);
      onRestored();
    } catch {
      toast.error('Error al restaurar el tablero');
    } finally {
      setRestoringId(null);
    }
  };

  const restoreRow = async (row: TrashRow) => {
    setRestoringId(row.id);
    try {
      await restoreFromTrash({ type: 'row', rowId: row.id });
      setRows(prev => prev.filter(r => r.id !== row.id));
      toast.success(`"${row.participantName || 'Participante'}" restaurado`);
      onRestored();
    } catch {
      toast.error('Error al restaurar el participante');
    } finally {
      setRestoringId(null);
    }
  };

  const restoreTask = async (task: TrashTask) => {
    setRestoringId(task.id);
    try {
      await restoreFromTrash({ type: 'task', taskId: task.id });
      setTasks(prev => prev.filter(t => t.id !== task.id));
      toast.success(`"${task.taskName || 'Tarea'}" restaurada`);
      onRestored();
    } catch {
      toast.error('Error al restaurar la tarea');
    } finally {
      setRestoringId(null);
    }
  };

  const emptyTrash = async () => {
    setEmptyingTrash(true);
    try {
      const result = await permanentlyDelete({});
      toast.success(result.deleted > 0 ? `${result.deleted} elemento(s) eliminados permanentemente` : 'Papelera vacía');
      await reload();
    } catch {
      toast.error('Error al vaciar la papelera');
    } finally {
      setEmptyingTrash(false);
    }
  };

  const isEmpty = boards.length === 0 && rows.length === 0 && tasks.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[460px] flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            Papelera
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Los elementos se eliminan permanentemente después de 10 días.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-4 space-y-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">La papelera está vacía</p>
              <p className="text-xs text-muted-foreground">Los elementos eliminados aparecerán aquí.</p>
            </div>
          ) : (
            <>
              {/* Deleted boards */}
              {boards.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Tableros ({boards.length})
                  </h3>
                  <div className="space-y-2">
                    {boards.map(board => (
                      <div key={board.boardId} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{board.boardName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground">
                              {board.rowCount} elemento{board.rowCount !== 1 ? 's' : ''}
                            </span>
                            <DaysLeftBadge deletedAt={board.deletedAt} />
                          </div>
                          <DeletedByLabel deletedBy={board.deletedBy} deletedAt={board.deletedAt} />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs flex-shrink-0 mt-0.5"
                          disabled={restoringId === board.boardId}
                          onClick={() => restoreBoard(board)}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restaurar
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Deleted tasks */}
              {tasks.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Tareas ({tasks.length})
                  </h3>
                  <div className="space-y-2">
                    {tasks.map(task => (
                      <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {task.taskName || 'Sin nombre'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {task.boardName && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                {task.boardName}
                              </Badge>
                            )}
                            <DaysLeftBadge deletedAt={task.deletedAt} />
                          </div>
                          <DeletedByLabel deletedBy={task.deletedBy} deletedAt={task.deletedAt} />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs flex-shrink-0 mt-0.5"
                          disabled={restoringId === task.id}
                          onClick={() => restoreTask(task)}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restaurar
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Deleted rows */}
              {rows.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Participantes ({rows.length})
                  </h3>
                  <div className="space-y-2">
                    {rows.map(row => (
                      <div key={row.id} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {row.participantName || 'Sin nombre'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {row.boardName && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                {row.boardName}
                              </Badge>
                            )}
                            {row.email && (
                              <span className="text-xs text-muted-foreground truncate">{row.email}</span>
                            )}
                            <DaysLeftBadge deletedAt={row.deletedAt} />
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            <UserX className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-[11px] text-muted-foreground italic">
                              {new Date(row.deletedAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                              {' '}
                              {new Date(row.deletedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs flex-shrink-0 mt-0.5"
                          disabled={restoringId === row.id}
                          onClick={() => restoreRow(row)}
                        >
                          <RotateCcw className="w-3 h-3" />
                          Restaurar
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!isEmpty && !loading && (
          <div className="flex-shrink-0 pt-4 border-t border-border mt-2">
            <Button
              variant="destructive"
              size="sm"
              className="w-full gap-2"
              disabled={emptyingTrash}
              onClick={emptyTrash}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {emptyingTrash ? 'Vaciando...' : 'Vaciar papelera (elementos expirados)'}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-1.5">
              Solo elimina elementos con más de 10 días en la papelera
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
