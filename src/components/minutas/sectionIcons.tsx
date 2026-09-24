import {
  Target, Users, ClipboardList, CalendarClock, UserCheck, AlertTriangle,
  PackageCheck, ShieldAlert, Info, Search, Lightbulb, HelpCircle,
  CheckCircle2, TrendingUp, ArrowRightCircle, FileText, type LucideIcon,
} from 'lucide-react';

// Un ícono por encabezado de sección del resumen — los 5 prompts de
// meetingSummaryPrompts.ts usan un set fijo y conocido de nombres de
// sección (no texto libre), así que emparejar por palabra clave es
// confiable en vez de adivinar. Orden importa poco: cada palabra clave
// aparece en un solo grupo de secciones relacionadas entre los 5 tipos.
const RULES: [string, LucideIcon][] = [
  ['objetivo', Target],
  ['alcance', Users],
  ['público', Users],
  ['metodología', ClipboardList],
  ['plan de trabajo', ClipboardList],
  ['timeline', CalendarClock],
  ['presupuesto', CalendarClock],
  ['roles', UserCheck],
  ['responsables', UserCheck],
  ['riesgo', AlertTriangle],
  ['obstáculo', AlertTriangle],
  ['bloqueo', AlertTriangle],
  ['duda', HelpCircle],
  ['desacuerdo', HelpCircle],
  ['entregable', PackageCheck],
  ['restricci', ShieldAlert],
  ['contexto', Info],
  ['hallazgo', Search],
  ['interpretaci', Lightbulb],
  ['hipótesis', Lightbulb],
  ['decisi', CheckCircle2],
  ['avance', TrendingUp],
  ['próximos pasos', ArrowRightCircle],
];

export function getSectionIcon(heading: string): LucideIcon {
  const lower = heading.toLowerCase();
  for (const [keyword, Icon] of RULES) {
    if (lower.includes(keyword)) return Icon;
  }
  return FileText;
}
