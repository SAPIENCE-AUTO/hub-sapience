import { useState, useEffect } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { SearchCheck, AlertTriangle, Copy, CheckCircle2, Mail, User, Phone, Layers, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { searchParticipantHistory, SearchParticipantHistoryOutputType } from 'zite-endpoints-sdk';

type Result = SearchParticipantHistoryOutputType['results'][0];
type HistoryEntry = Result['history'][0];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectCode?: string;
  boardName?: string;
}

function MatchedByBadges({ matchedBy }: { matchedBy: string[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Por:</span>
      {matchedBy.includes('email') && (
        <span className="inline-flex items-center gap-0.5 text-[10px] bg-sky-500/10 text-sky-600 border border-sky-400/40 rounded px-1.5 py-0.5">
          <Mail className="w-2.5 h-2.5" /> Email
        </span>
      )}
      {matchedBy.includes('name') && (
        <span className="inline-flex items-center gap-0.5 text-[10px] bg-violet-500/10 text-violet-600 border border-violet-400/40 rounded px-1.5 py-0.5">
          <User className="w-2.5 h-2.5" /> Nombre
        </span>
      )}
      {matchedBy.includes('phone') && (
        <span className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-500/10 text-emerald-600 border border-emerald-400/40 rounded px-1.5 py-0.5">
          <Phone className="w-2.5 h-2.5" /> Teléfono
        </span>
      )}
    </div>
  );
}

function EntryParticipationBadge({ h }: { h: HistoryEntry }) {
  const wl = (h as any).warningLevel as string | null | undefined;
  const cn = (h as any).clientName as string | undefined;
  if (wl === 'same_board') return null;
  if (wl === 'same_client') {
    return (
      <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-0.5">
        <AlertTriangle className="w-2.5 h-2.5" /> ⚠️ Mismo cliente{cn ? ` (${cn})` : ''}
      </Badge>
    );
  }
  if (wl === 'recent') {
    return (
      <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-0.5">
        ⚠️ Activo / reciente
      </Badge>
    );
  }
  if (wl === 'old') {
    return (
      <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-blue-600 border-blue-400/40 bg-blue-500/5">
        Participó hace +6m
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-blue-600 border-blue-400/40 bg-blue-500/5">Solo registrado</Badge>;
}

function EntryCard({ h }: { h: HistoryEntry }) {
  const wl = (h as any).warningLevel as string | null | undefined;
  const borderCls = wl === 'same_client' || wl === 'recent'
    ? 'border-destructive/40 bg-destructive/5'
    : h.sameProject
    ? 'border-orange-400/40 bg-orange-500/5'
    : wl === 'old' || !wl
    ? 'border-blue-400/40 bg-blue-500/5'
    : 'border-border bg-muted/30';
  const dot = wl === 'same_client' || wl === 'recent' ? 'bg-destructive' : h.sameProject ? 'bg-orange-500' : 'bg-blue-500';

  return (
    <div className={`border rounded-lg px-3 py-2 flex flex-col gap-1 ${borderCls}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono font-bold text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {h.projectCode}
            </span>
            {h.boardName && (
              <span className="text-xs text-foreground/75 flex items-center gap-0.5">
                <Layers className="w-3 h-3 text-muted-foreground" /> {h.boardName}
              </span>
            )}
            {h.sameProject && !h.sameBoard && (
              <span className="text-[10px] text-orange-600 font-semibold">mismo proyecto</span>
            )}
          </div>
          {h.group && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground/60">Grupo:</span> {h.group}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {h.status && <Badge variant="outline" className="text-[10px] h-4 px-1.5 font-normal">{h.status}</Badge>}
            <EntryParticipationBadge h={h} />
            {h.sourceForm && (
              <span className="text-[10px] text-muted-foreground italic flex items-center gap-0.5">
                <ExternalLink className="w-2.5 h-2.5" />{h.sourceForm}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DuplicateSearchDialog({ open, onOpenChange, projectCode, boardName }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Sin projectCode/boardName, el backend nunca puede marcar sameProject/
  // sameBoard — todo caía en "Otros estudios" con un conteo global sin
  // aviso, aunque el diálogo se abriera desde un tablero específico.
  const doSearch = useDebouncedCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const data = await searchParticipantHistory({ query: q.trim(), projectCode, boardName });
      setResults(data.results);
      setSearched(true);
    } catch { /* ignore */ }
    setLoading(false);
  }, 500);

  useEffect(() => { doSearch(query); }, [query]);
  useEffect(() => { if (!open) { setQuery(''); setResults([]); setSearched(false); } }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SearchCheck className="w-4 h-4 text-primary" />
            Verificar historial
          </DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Buscar por nombre, email o teléfono..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          className="text-sm"
        />

        {query.length > 0 && query.length < 2 && (
          <p className="text-xs text-muted-foreground -mt-1">Escribe al menos 2 caracteres...</p>
        )}

        <ScrollArea className="max-h-[460px]">
          {loading ? (
            <div className="space-y-2 mt-1">
              {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
            </div>
          ) : searched && results.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500/60 mb-2" />
              <p className="text-sm font-semibold">Sin resultados</p>
              <p className="text-xs text-muted-foreground mt-1">No se encontró ningún participante con "{query}"</p>
            </div>
          ) : (
            <div className="space-y-3 mt-1 pb-1">
              {results.map(r => {
                // Use result-level badges — resolved by backend, not computed from entries
                const hasSameClient  = r.primaryBadge === 'same_client';
                const hasRecent      = r.primaryBadge === 'recent';
                const hasParticipated = hasSameClient || hasRecent;
                const hasSameProject  = r.history.some(h => h.sameProject);
                const cardBorder = hasSameClient || hasRecent
                  ? 'border-destructive/50 bg-destructive/5'
                  : hasSameProject
                  ? 'border-orange-400/40 bg-orange-500/5'
                  : r.history.length > 0
                  ? 'border-blue-400/40 bg-blue-500/5'
                  : 'border-border';

                const sameProjectEntries = r.history.filter(h => h.sameProject);
                const otherEntries       = r.history.filter(h => !h.sameProject);

                return (
                  <div key={r.id} className={`border rounded-xl p-3.5 ${cardBorder}`}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate">{r.fullName || r.email || 'Sin nombre'}</div>
                        {r.email && <div className="text-xs text-muted-foreground mt-0.5">{r.email}</div>}
                        {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {hasSameClient && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" /> ⚠️ Mismo cliente
                          </Badge>
                        )}
                        {!hasSameClient && hasRecent && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="w-3 h-3" /> Activo / reciente
                          </Badge>
                        )}
                        {!hasParticipated && r.history.length > 0 && (
                          <Badge variant="outline" className="text-xs gap-1 text-blue-600 border-blue-400/60 bg-blue-500/5">
                            <Copy className="w-3 h-3" />
                            {sameProjectEntries.length > 0 && otherEntries.length > 0
                              ? `${sameProjectEntries.length} en este proyecto · ${otherEntries.length} en otros`
                              : `${r.history.length} aparición${r.history.length > 1 ? 'es' : ''}${otherEntries.length > 0 && sameProjectEntries.length === 0 ? ' en otros proyectos' : ''}`}
                          </Badge>
                        )}
                        {r.history.length === 0 && (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-400">Primera vez</Badge>
                        )}
                      </div>
                    </div>

                    {/* Match method */}
                    {r.matchedBy.length > 0 && (
                      <div className="mb-2">
                        <MatchedByBadges matchedBy={r.matchedBy} />
                      </div>
                    )}

                    {/* Same project section */}
                    {sameProjectEntries.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" /> Este proyecto
                        </p>
                        <div className="space-y-1">
                          {sameProjectEntries.map((h, i) => <EntryCard key={i} h={h} />)}
                        </div>
                      </div>
                    )}

                    {/* Other projects section */}
                    {otherEntries.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Otros estudios
                        </p>
                        <div className="space-y-1">
                          {otherEntries.map((h, i) => <EntryCard key={i} h={h} />)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
