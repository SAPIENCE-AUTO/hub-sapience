import {
  Target, Users, ClipboardList, CalendarClock, UserCheck, AlertTriangle,
  PackageCheck, ShieldAlert, Info, Search, Lightbulb, HelpCircle,
  CheckCircle2, TrendingUp, ArrowRightCircle, FileText, type LucideIcon,
} from 'lucide-react';

export interface SectionMeta {
  icon: LucideIcon;
  // Clases completas y literales (no interpoladas) — Tailwind solo
  // reconoce nombres de clase que aparecen tal cual en el código fuente.
  iconClass: string;
  bgClass: string;
}

// Un ícono Y un color por sección — "le falta color a esa página" (Sergio).
// Los 5 prompts de meetingSummaryPrompts.ts usan un set fijo y conocido de
// nombres de sección (no texto libre), así que emparejar por palabra clave
// es confiable en vez de adivinar. El color agrupa por categoría semántica
// (riesgo → ámbar, decisión → verde, etc.), no es decorativo al azar.
const RULES: [string, SectionMeta][] = [
  ['objetivo', { icon: Target, iconClass: 'text-blue-600 dark:text-blue-400', bgClass: 'bg-blue-100 dark:bg-blue-900/30' }],
  ['alcance', { icon: Users, iconClass: 'text-indigo-600 dark:text-indigo-400', bgClass: 'bg-indigo-100 dark:bg-indigo-900/30' }],
  ['público', { icon: Users, iconClass: 'text-indigo-600 dark:text-indigo-400', bgClass: 'bg-indigo-100 dark:bg-indigo-900/30' }],
  ['metodología', { icon: ClipboardList, iconClass: 'text-sky-600 dark:text-sky-400', bgClass: 'bg-sky-100 dark:bg-sky-900/30' }],
  ['plan de trabajo', { icon: ClipboardList, iconClass: 'text-sky-600 dark:text-sky-400', bgClass: 'bg-sky-100 dark:bg-sky-900/30' }],
  ['timeline', { icon: CalendarClock, iconClass: 'text-violet-600 dark:text-violet-400', bgClass: 'bg-violet-100 dark:bg-violet-900/30' }],
  ['presupuesto', { icon: CalendarClock, iconClass: 'text-violet-600 dark:text-violet-400', bgClass: 'bg-violet-100 dark:bg-violet-900/30' }],
  ['roles', { icon: UserCheck, iconClass: 'text-fuchsia-600 dark:text-fuchsia-400', bgClass: 'bg-fuchsia-100 dark:bg-fuchsia-900/30' }],
  ['responsables', { icon: UserCheck, iconClass: 'text-fuchsia-600 dark:text-fuchsia-400', bgClass: 'bg-fuchsia-100 dark:bg-fuchsia-900/30' }],
  ['riesgo', { icon: AlertTriangle, iconClass: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-100 dark:bg-amber-900/30' }],
  ['obstáculo', { icon: AlertTriangle, iconClass: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-100 dark:bg-amber-900/30' }],
  ['bloqueo', { icon: AlertTriangle, iconClass: 'text-amber-600 dark:text-amber-400', bgClass: 'bg-amber-100 dark:bg-amber-900/30' }],
  ['duda', { icon: HelpCircle, iconClass: 'text-orange-600 dark:text-orange-400', bgClass: 'bg-orange-100 dark:bg-orange-900/30' }],
  ['desacuerdo', { icon: HelpCircle, iconClass: 'text-orange-600 dark:text-orange-400', bgClass: 'bg-orange-100 dark:bg-orange-900/30' }],
  ['entregable', { icon: PackageCheck, iconClass: 'text-teal-600 dark:text-teal-400', bgClass: 'bg-teal-100 dark:bg-teal-900/30' }],
  ['restricci', { icon: ShieldAlert, iconClass: 'text-rose-600 dark:text-rose-400', bgClass: 'bg-rose-100 dark:bg-rose-900/30' }],
  ['contexto', { icon: Info, iconClass: 'text-slate-600 dark:text-slate-400', bgClass: 'bg-slate-100 dark:bg-slate-800' }],
  ['hallazgo', { icon: Search, iconClass: 'text-cyan-600 dark:text-cyan-400', bgClass: 'bg-cyan-100 dark:bg-cyan-900/30' }],
  ['interpretaci', { icon: Lightbulb, iconClass: 'text-yellow-600 dark:text-yellow-400', bgClass: 'bg-yellow-100 dark:bg-yellow-900/30' }],
  ['hipótesis', { icon: Lightbulb, iconClass: 'text-yellow-600 dark:text-yellow-400', bgClass: 'bg-yellow-100 dark:bg-yellow-900/30' }],
  ['decisi', { icon: CheckCircle2, iconClass: 'text-emerald-600 dark:text-emerald-400', bgClass: 'bg-emerald-100 dark:bg-emerald-900/30' }],
  ['avance', { icon: TrendingUp, iconClass: 'text-green-600 dark:text-green-400', bgClass: 'bg-green-100 dark:bg-green-900/30' }],
  ['próximos pasos', { icon: ArrowRightCircle, iconClass: 'text-purple-600 dark:text-purple-400', bgClass: 'bg-purple-100 dark:bg-purple-900/30' }],
];

const FALLBACK: SectionMeta = {
  icon: FileText,
  iconClass: 'text-muted-foreground',
  bgClass: 'bg-muted',
};

export function getSectionMeta(heading: string): SectionMeta {
  const lower = heading.toLowerCase();
  for (const [keyword, meta] of RULES) {
    if (lower.includes(keyword)) return meta;
  }
  return FALLBACK;
}
