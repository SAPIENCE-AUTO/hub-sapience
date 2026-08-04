import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { PresenceMember } from '../hooks/useProjectPresence';

const PAGE_LABELS: Record<string, string> = {
  pm:          'Actividades',
  recruitment: 'Reclutamiento',
};

function getInitials(email: string, name?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts[0].length > 0) return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function getPageLabel(pageName?: string): string {
  if (!pageName) return '';
  return PAGE_LABELS[pageName] ?? pageName;
}

// Deterministic background color from email hash
const COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
];
function avatarBg(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = email.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

const MAX_VISIBLE = 4;

interface ProjectPresenceAvatarsProps {
  members: PresenceMember[];
}

function PresenceAvatar({ m, i }: { m: PresenceMember; i: number }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 border-2 border-background cursor-default select-none ${i > 0 ? '-ml-2' : ''} ${avatarBg(m.email)}`}
      style={{ zIndex: MAX_VISIBLE - i }}
    >
      {/* Initials always shown as fallback base */}
      {getInitials(m.email, m.name)}

      {/* Photo overlay — hides itself on error */}
      {m.profilePhoto && !imgError && (
        <img
          src={m.profilePhoto}
          alt={m.name || m.email}
          className="absolute inset-0 w-full h-full rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}

export function ProjectPresenceAvatars({ members }: ProjectPresenceAvatarsProps) {
  if (!members || members.length === 0) return null;

  const visible  = members.slice(0, MAX_VISIBLE);
  const overflow = members.length - MAX_VISIBLE;

  return (
    <TooltipProvider>
      <div className="flex items-center flex-shrink-0">
        {visible.map((m, i) => (
          <Tooltip key={m.email}>
            <TooltipTrigger asChild>
              <span>
                <PresenceAvatar m={m} i={i} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs py-1.5 px-2.5">
              <div className="font-semibold">{m.name || m.email}</div>
              {m.pageName && (
                <div className="text-muted-foreground text-[11px] mt-0.5">{getPageLabel(m.pageName)}</div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}

        {overflow > 0 && (
          <div
            className="relative -ml-2 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold bg-muted text-muted-foreground border-2 border-background flex-shrink-0"
            style={{ zIndex: 0 }}
          >
            +{overflow}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
