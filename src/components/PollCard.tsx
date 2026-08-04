import { BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface PollData {
  type: 'poll';
  question: string;
  options: string[];
  votes: Record<string, string[]>;
  creatorName: string;
  creatorEmail: string;
}

export function parsePoll(content?: string | null): PollData | null {
  if (!content) return null;
  try {
    const data = JSON.parse(content);
    if (data?.type === 'poll' && Array.isArray(data.options)) return data as PollData;
    return null;
  } catch {
    return null;
  }
}

interface PollCardProps {
  poll: PollData;
  myEmail: string;
  onVote: (option: string) => void;
  isOwn: boolean;
}

export function PollCard({ poll, myEmail, onVote, isOwn }: PollCardProps) {
  const totalVotes = Object.values(poll.votes).reduce((sum, users) => sum + users.length, 0);

  const myVote = Object.entries(poll.votes).find(([, users]) =>
    users.includes(myEmail)
  )?.[0];

  return (
    <div className={`rounded-2xl overflow-hidden border shadow-sm w-72 ${
      isOwn ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'
    }`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3.5 py-2.5 border-b ${
        isOwn ? 'border-primary/20 bg-primary/8' : 'border-border/60 bg-muted/40'
      }`}>
        <BarChart3 className={`w-3.5 h-3.5 flex-shrink-0 ${isOwn ? 'text-primary' : 'text-muted-foreground'}`} />
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-semibold tracking-wide">
          ENCUESTA
        </Badge>
      </div>

      {/* Question */}
      <div className="px-3.5 pt-3 pb-2">
        <p className="text-sm font-semibold leading-snug text-foreground">{poll.question}</p>
      </div>

      {/* Options */}
      <div className="px-3.5 pb-3 space-y-2">
        {poll.options.map(option => {
          const count = (poll.votes[option] ?? []).length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isMyVote = myVote === option;

          return (
            <button
              key={option}
              onClick={() => onVote(option)}
              className={`w-full text-left rounded-xl border transition-all duration-150 overflow-hidden group relative ${
                isMyVote
                  ? 'border-primary/60 bg-primary/8 ring-1 ring-primary/25'
                  : 'border-border hover:border-primary/30 bg-background hover:bg-muted/40'
              }`}
            >
              {/* Progress fill */}
              <div
                className={`absolute inset-0 rounded-xl transition-all duration-500 ${
                  isMyVote ? 'bg-primary/12' : 'bg-muted/60'
                }`}
                style={{ width: `${pct}%` }}
              />
              {/* Content */}
              <div className="relative flex items-center gap-2 px-3 py-2">
                <span className={`text-xs font-medium flex-1 truncate ${
                  isMyVote ? 'text-primary font-semibold' : 'text-foreground'
                }`}>
                  {option}
                </span>
                <span className={`text-[11px] font-bold tabular-nums flex-shrink-0 ${
                  isMyVote ? 'text-primary' : 'text-muted-foreground'
                }`}>
                  {pct > 0 ? `${pct}%` : ''}
                </span>
                {count > 0 && (
                  <span className={`text-[10px] flex-shrink-0 ${
                    isMyVote ? 'text-primary/70' : 'text-muted-foreground/60'
                  }`}>
                    {count}
                  </span>
                )}
                {isMyVote && (
                  <span className="text-primary text-[11px] flex-shrink-0">✓</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className={`flex items-center gap-1.5 px-3.5 py-2 border-t text-[11px] text-muted-foreground ${
        isOwn ? 'border-primary/20' : 'border-border/60'
      }`}>
        <span className="font-medium">
          {totalVotes === 0 ? 'Sin votos aún' : `${totalVotes} ${totalVotes === 1 ? 'voto' : 'votos'}`}
        </span>
        <span className="opacity-40">·</span>
        <span className="truncate">por {poll.creatorName || poll.creatorEmail}</span>
      </div>
    </div>
  );
}
