import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from 'zite-auth-sdk';
import {
  migrateCellValuesToUUID, MigrateCellValuesToUUIDOutputType,
  getProjects, GetProjectsOutputType,
  saveMigrationLog, getMigrationLogs, GetMigrationLogsOutputType,
} from 'zite-endpoints-sdk';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Square, CheckCircle2, AlertTriangle, Loader2, History, RefreshCw } from 'lucide-react';

type LogEntry = {
  ts: string;
  boardId: string | null;
  migrated: number;
  failed: number;
  skipped: number;
  done: boolean;
  allDone: boolean;
  timedOut: boolean;
  elapsed: number;
  error?: string;
};

type HistoryLog = GetMigrationLogsOutputType['logs'][0];

// ── History Table ──────────────────────────────────────────────────────────────
function MigrationHistory({ projects }: { projects: GetProjectsOutputType['projects'] }) {
  const [logs, setLogs] = useState<HistoryLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState('');

  const load = useCallback((pc?: string) => {
    setLoading(true);
    getMigrationLogs({ projectCode: pc || undefined })
      .then(d => setLogs(d.logs))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFilterChange = (v: string) => {
    const val = v === '__all__' ? '' : v;
    setFilterProject(val);
    load(val);
  };

  const statusBadge = (status?: string) => {
    if (!status) return null;
    const s = status.toLowerCase();
    if (s === 'completed') return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 py-0">Completed</Badge>;
    if (s === 'partial') return <Badge className="bg-accent/50 text-foreground border-border text-[10px] px-1.5 py-0">Partial</Badge>;
    return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Error</Badge>;
  };

  const fmtDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const fmtBoard = (bid?: string) => {
    if (!bid) return '—';
    const parts = bid.split('-');
    return parts[parts.length - 1]?.slice(0, 20) || bid.slice(0, 12);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Historial de migraciones
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterProject || '__all__'} onValueChange={handleFilterChange}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="Todos los proyectos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos los proyectos</SelectItem>
                {[...projects]
                  .filter(p => p.projectCode)
                  .sort((a, b) => (a.projectCode ?? '').localeCompare(b.projectCode ?? ''))
                  .map(p => (
                    <SelectItem key={p.id} value={p.projectCode!} className="text-xs">
                      {p.projectCode}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => load(filterProject)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sin registros de migración.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Fecha</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Proyecto</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Board</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Migradas</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Fallidas</th>
                  <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Status</th>
                  <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Duración</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{log.projectCode || '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono truncate max-w-[120px]" title={log.boardId}>{fmtBoard(log.boardId)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">{(log.migrated ?? 0).toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right font-bold tabular-nums ${(log.failed ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{log.failed ?? 0}</td>
                    <td className="px-3 py-2 text-center">{statusBadge(log.status)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{(log.durationSeconds ?? 0).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function MigrationRunnerPage() {
  const { user, isLoading, loginWithRedirect } = useAuth();
  const [projectCode, setProjectCode] = useState('');
  const [projects, setProjects] = useState<GetProjectsOutputType['projects']>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalMigrated, setTotalMigrated] = useState(0);
  const [totalFailed, setTotalFailed] = useState(0);
  const [totalSkipped, setTotalSkipped] = useState(0);
  const [currentBoard, setCurrentBoard] = useState<string | null>(null);
  const stopRef = useRef(false);
  const [delayMs, setDelayMs] = useState(5000);
  const [allDone, setAllDone] = useState(false);
  const historyKeyRef = useRef(0);

  useEffect(() => {
    getProjects({}).then(d => setProjects(d.projects)).catch(() => {}).finally(() => setLoadingProjects(false));
  }, []);

  const addLog = useCallback((entry: LogEntry) => {
    setLogs(prev => [entry, ...prev].slice(0, 200));
  }, []);

  const persistLog = useCallback(async (
    pc: string, boardId: string | null, migrated: number, failed: number, skipped: number,
    status: 'completed' | 'partial' | 'error', elapsed: number,
  ) => {
    try {
      await saveMigrationLog({ projectCode: pc, boardId: boardId ?? undefined, migrated, failed, skipped, status, durationSeconds: elapsed });
    } catch { /* non-critical */ }
  }, []);

  const runMigration = useCallback(async () => {
    setRunning(true);
    setAllDone(false);
    stopRef.current = false;

    let nextOffset: number | null = 0;
    let activeBoardId: string | undefined = undefined;

    while (!stopRef.current) {
      try {
        const result: MigrateCellValuesToUUIDOutputType = await migrateCellValuesToUUID({
          projectCode,
          dryRun,
          boardId: activeBoardId,
          offset: nextOffset ?? 0,
        });

        setTotalMigrated(prev => prev + result.migrated);
        setTotalFailed(prev => prev + result.failed);
        setTotalSkipped(prev => prev + result.skipped);
        setCurrentBoard(result.boardId);

        addLog({
          ts: new Date().toLocaleTimeString(),
          boardId: result.boardId,
          migrated: result.migrated,
          failed: result.failed,
          skipped: result.skipped,
          done: result.done,
          allDone: result.allDone,
          timedOut: result.timedOut,
          elapsed: result.elapsed,
        });

        // Persist log for non-dry-run chunks with actual work
        if (!dryRun && (result.migrated > 0 || result.failed > 0)) {
          const chunkStatus = result.failed > 0 ? 'error' : result.allDone ? 'completed' : result.done ? 'completed' : 'partial';
          persistLog(projectCode, result.boardId, result.migrated, result.failed, result.skipped, chunkStatus, result.elapsed);
        }

        if (result.allDone) {
          addLog({
            ts: new Date().toLocaleTimeString(),
            boardId: null, migrated: 0, failed: 0, skipped: 0,
            done: true, allDone: true, timedOut: false, elapsed: 0,
          });
          // Persist final "completed" entry
          if (!dryRun) {
            persistLog(projectCode, null, 0, 0, 0, 'completed', 0);
          }
          setAllDone(true);
          historyKeyRef.current++;
          break;
        }

        if (result.done) {
          activeBoardId = undefined;
          nextOffset = 0;
        } else {
          activeBoardId = result.boardId ?? undefined;
          nextOffset = result.nextOffset;
        }

        const waitMs = (result.failed > 0 || result.timedOut) ? delayMs * 2 : delayMs;
        await new Promise(r => setTimeout(r, waitMs));
      } catch (err: any) {
        addLog({
          ts: new Date().toLocaleTimeString(),
          boardId: activeBoardId ?? null,
          migrated: 0, failed: 0, skipped: 0,
          done: false, allDone: false, timedOut: false, elapsed: 0,
          error: err?.message || 'Unknown error',
        });
        if (!dryRun) {
          persistLog(projectCode, activeBoardId ?? null, 0, 0, 0, 'error', 0);
        }
        await new Promise(r => setTimeout(r, 15000));
      }
    }

    setRunning(false);
  }, [projectCode, dryRun, delayMs, addLog, persistLog]);

  const stopMigration = useCallback(() => {
    stopRef.current = true;
  }, []);

  if (isLoading) return null;
  if (!user) {
    loginWithRedirect();
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-foreground">UUID Migration Runner</h1>
        <p className="text-sm text-muted-foreground">
          Migra CellValues de legacy boardId a UUID, de forma automática y resumable.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuración</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Project Code</Label>
                <Select value={projectCode} onValueChange={setProjectCode} disabled={running}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar proyecto..." />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingProjects ? (
                      <SelectItem value="__loading__" disabled>Cargando proyectos...</SelectItem>
                    ) : (
                      [...projects]
                        .filter(p => p.projectCode)
                        .sort((a, b) => (a.projectCode ?? '').localeCompare(b.projectCode ?? ''))
                        .map(p => (
                          <SelectItem key={p.id} value={p.projectCode!}>
                            {p.projectCode} — {p.fullName || 'Sin nombre'}
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delay entre llamadas (ms)</Label>
                <Input
                  type="number"
                  value={delayMs}
                  onChange={e => setDelayMs(Number(e.target.value))}
                  disabled={running}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={dryRun}
                onCheckedChange={setDryRun}
                disabled={running}
              />
              <Label>Dry Run (solo reportar, no modificar)</Label>
              {dryRun && <Badge variant="secondary">Modo seguro</Badge>}
              {!dryRun && <Badge variant="destructive">Escritura real</Badge>}
            </div>

            <div className="flex gap-3 items-center">
              {!running ? (
                <Button disabled={!projectCode} onClick={() => { setAllDone(false); setTotalMigrated(0); setTotalFailed(0); setTotalSkipped(0); setLogs([]); runMigration(); }} className="gap-2">
                  <Play className="h-4 w-4" />
                  {dryRun ? 'Iniciar Dry Run' : 'Iniciar Migración'}
                </Button>
              ) : (
                <Button onClick={stopMigration} variant="destructive" className="gap-2">
                  <Square className="h-4 w-4" />
                  Detener
                </Button>
              )}
              {allDone && !running && (
                <Badge className="bg-green-600 text-white gap-1 py-1 px-3">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Migración completada
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Estado
              {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-foreground">{totalMigrated}</p>
                <p className="text-xs text-muted-foreground">Migradas</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${totalFailed > 0 ? 'text-destructive' : 'text-foreground'}`}>{totalFailed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{totalSkipped}</p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{logs.length}</p>
                <p className="text-xs text-muted-foreground">Chunks</p>
              </div>
              <div>
                <p className="text-sm font-mono text-foreground truncate">
                  {currentBoard?.split('-').slice(-1)[0] || '—'}
                </p>
                <p className="text-xs text-muted-foreground">Board</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Completion Banner */}
        {allDone && !running && (
          <Card className="border-green-500/50 bg-green-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <h3 className="text-lg font-semibold text-foreground">
                  ¡Migración completada exitosamente!
                </h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Todos los CellValues del proyecto <strong>{projectCode}</strong> fueron procesados.
              </p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-background rounded-lg p-3 border">
                  <p className="text-xl font-bold text-foreground">{totalMigrated}</p>
                  <p className="text-xs text-muted-foreground">Migradas</p>
                </div>
                <div className="bg-background rounded-lg p-3 border">
                  <p className="text-xl font-bold text-foreground">{totalSkipped}</p>
                  <p className="text-xs text-muted-foreground">Ya estaban en UUID</p>
                </div>
                <div className="bg-background rounded-lg p-3 border">
                  <p className={`text-xl font-bold ${totalFailed > 0 ? 'text-destructive' : 'text-foreground'}`}>{totalFailed}</p>
                  <p className="text-xs text-muted-foreground">Fallidas</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto space-y-1 font-mono text-xs">
              {logs.length === 0 && (
                <p className="text-muted-foreground">Sin actividad aún.</p>
              )}
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 py-1 px-2 rounded ${
                    log.error || log.failed > 0
                      ? 'bg-destructive/10 text-destructive'
                      : log.allDone
                        ? 'bg-green-500/10 text-green-700'
                        : 'bg-muted/50 text-foreground'
                  }`}
                >
                  {log.error || log.failed > 0 ? (
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  ) : log.allDone ? (
                    <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                  ) : null}
                  <span className="text-muted-foreground">{log.ts}</span>
                  {log.error ? (
                    <span>Error: {log.error}</span>
                  ) : log.allDone && log.migrated === 0 ? (
                    <span className="font-bold">✅ ALL DONE — migración completa</span>
                  ) : (
                    <span>
                      {log.boardId?.split('-').slice(-1)[0] || '?'}: +{log.migrated}
                      {log.failed > 0 ? ` ❌${log.failed}failed` : ''}
                      {log.skipped > 0 ? ` ⏭${log.skipped}skip` : ''}
                      {' '}{log.timedOut ? '⏱️timeout' : log.done ? '✅done' : ''}
                      {' '}({log.elapsed.toFixed(1)}s)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Migration History */}
        <MigrationHistory key={historyKeyRef.current} projects={projects} />
      </div>
    </div>
  );
}
