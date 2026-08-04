import { useState, useEffect, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList } from 'recharts';
import { analyzeRecruitmentStatus, getLastAnalysis, saveProject, AnalyzeRecruitmentStatusOutputType } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RefreshCw, AlertTriangle, CheckCircle2, Clock, Users, BarChart3,
  Sparkles, TrendingUp, ChevronDown, Save, XCircle, ClipboardList,
} from 'lucide-react';
import { toast } from 'sonner';

type Analysis = AnalyzeRecruitmentStatusOutputType;
type GroupAnalysis = Analysis['groups'][0];
type CriterionItem = GroupAnalysis['criteria'][0];
type DistributionItem = Analysis['globalDistributions'][0];
type ParticipantItem = GroupAnalysis['participants'][0];

const COLORS = [
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
  'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'cumple' | 'revisar' | 'no_cumple' }) {
  if (status === 'cumple') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-400/30 whitespace-nowrap">
      <CheckCircle2 className="w-3 h-3" /> Cumple
    </span>
  );
  if (status === 'no_cumple') return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/30 whitespace-nowrap">
      <XCircle className="w-3 h-3" /> No cumple
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-400/30 whitespace-nowrap">
      <Clock className="w-3 h-3" /> Revisar
    </span>
  );
}

// ─── Mini charts ──────────────────────────────────────────────────────────────

function MiniDonut({ items }: { items: { label: string; count: number }[] }) {
  const data = items.map(d => ({ name: d.label, value: d.count }));
  if (!data.some(d => d.value > 0)) return null;
  return (
    <div className="flex items-center gap-2">
      <PieChart width={58} height={58}>
        <Pie data={data} cx="50%" cy="50%" innerRadius={14} outerRadius={26} dataKey="value" paddingAngle={2} strokeWidth={0}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip
          contentStyle={{ fontSize: '10px', padding: '3px 6px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '4px', boxShadow: 'none' }}
          formatter={(v: number, n: string) => [v, n]}
        />
      </PieChart>
      <div className="flex flex-col gap-0.5 min-w-0">
        {items.map((d, i) => {
          const total = items.reduce((s, x) => s + x.count, 0);
          return (
            <div key={i} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">{d.label}</span>
              <span className="text-[10px] font-bold text-foreground ml-auto pl-1 flex-shrink-0">
                {total > 0 ? Math.round((d.count / total) * 100) : 0}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isAgeDistribution(items: { label: string; count: number }[]): boolean {
  return (
    items.length > 4 &&
    items.some(d => d.count === 0) &&
    items.every(d => /^\d{2}$/.test(d.label))
  );
}

function AgeHistogram({ items }: { items: { label: string; count: number }[] }) {
  return (
    <div style={{ width: 190, height: 64 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} margin={{ top: 2, right: 2, left: 2, bottom: 2 }} barCategoryGap="10%">
          <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={1} />
          <Tooltip
            contentStyle={{ fontSize: '11px', padding: '3px 8px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', boxShadow: 'none' }}
            formatter={(v: number, _: string, props: any) => [`${v} participante${v !== 1 ? 's' : ''}`, `Edad ${props?.payload?.label}`]}
            labelFormatter={() => ''}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {items.map((entry, i) => (
              <Cell key={i} fill={entry.count === 0 ? 'hsl(var(--muted))' : 'hsl(var(--chart-1))'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniBar({ items }: { items: { label: string; count: number }[] }) {
  if (!items.length) return null;
  if (isAgeDistribution(items)) return <AgeHistogram items={items} />;
  const total = items.reduce((s, d) => s + d.count, 0);
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground w-10 truncate flex-shrink-0">{item.label}</span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${total > 0 ? (item.count / total) * 100 : 0}%`, background: COLORS[i % COLORS.length] }} />
          </div>
          <span className="text-[10px] font-bold text-foreground w-3 text-right flex-shrink-0">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Criteria scorecard (mini-cards) ─────────────────────────────────────────

function CriterionCard({ criterion }: { criterion: CriterionItem }) {
  const { status, distribution } = criterion;
  const hasChart = distribution && distribution.items.length > 0;

  const bgBorder =
    status === 'cumple' ? 'bg-emerald-500/5 border-emerald-400/20' :
    status === 'no_cumple' ? 'bg-destructive/5 border-destructive/20' :
    'bg-amber-500/5 border-amber-400/20';

  const Icon =
    status === 'cumple' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" /> :
    status === 'no_cumple' ? <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" /> :
    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />;

  return (
    <div className={`rounded-lg border ${bgBorder} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
        {Icon}
        <span className="text-xs font-semibold text-foreground flex-1 leading-none">{criterion.criterion}</span>
        <StatusBadge status={status} />
      </div>

      {/* Body */}
      <div className={`px-3 py-2 ${hasChart ? 'flex items-start gap-3' : ''}`}>
        {/* Text side */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="grid grid-cols-2 gap-x-2">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Esperado</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{criterion.expected}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Real</p>
              <p className="text-[11px] font-semibold text-foreground leading-snug">{criterion.actual}</p>
            </div>
          </div>
          {criterion.action && (
            <p className="text-[10px] text-amber-700 italic leading-snug border-t border-amber-400/20 pt-1 mt-1">
              → {criterion.action}
            </p>
          )}
        </div>

        {/* Chart side */}
        {hasChart && (
          <div className="flex-shrink-0">
            {distribution.chartType === 'donut'
              ? <MiniDonut items={distribution.items} />
              : <MiniBar items={distribution.items} />
            }
          </div>
        )}
      </div>
    </div>
  );
}

function CriteriaScorecard({ criteria }: { criteria: CriterionItem[] }) {
  if (!criteria.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <ClipboardList className="w-3 h-3" /> Evaluación de criterios
      </p>
      {criteria.map((c, i) => <CriterionCard key={i} criterion={c} />)}
    </div>
  );
}

// ─── Global distributions ─────────────────────────────────────────────────────



// ─── Participant table ────────────────────────────────────────────────────────

function detectFields(participants: ParticipantItem[]): string[] {
  const all = [...new Set(participants.flatMap(p => Object.keys(p.fields)))];
  const result: string[] = [];
  const age = all.find(k => /^edad$/i.test(k) || /rango.+edad/i.test(k) || /edad/i.test(k));
  const gender = all.find(k => /g[eé]nero|sexo/i.test(k));
  if (age) result.push(age);
  if (gender) result.push(gender);
  for (const k of all) {
    if (!result.includes(k) && result.length < 4 && k.length < 30) result.push(k);
  }
  return result.slice(0, 4);
}

function ParticipantTable({ participants }: { participants: ParticipantItem[] }) {
  const cols = detectFields(participants);
  return (
    <div className="overflow-auto max-h-[380px]">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground whitespace-nowrap border-b border-border/60">#</th>
            <th className="text-left py-1.5 px-2 font-semibold text-muted-foreground whitespace-nowrap border-b border-border/60">Nombre</th>
            {cols.map(c => (
              <th key={c} className="text-left py-1.5 px-2 font-semibold text-muted-foreground border-b border-border/60 max-w-[140px]">
                <span className="block truncate">{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {participants.map((p, i) => (
            <tr key={i} className="border-b border-border/20 hover:bg-muted/30 transition-colors">
              <td className="py-1.5 px-2 text-muted-foreground/50 font-mono">{i + 1}</td>
              <td className="py-1.5 px-2 font-medium text-foreground whitespace-nowrap">{p.name}</td>
              {cols.map(c => (
                <td key={c} className="py-1.5 px-2 text-muted-foreground max-w-[140px]">
                  <span className="block truncate">{p.fields[c] ?? '—'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Group card ───────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: GroupAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const participants = group.participants ?? [];
  const pct = group.requiredParticipants
    ? Math.min(100, Math.round((group.totalParticipants / group.requiredParticipants) * 100))
    : null;
  const barColor = pct == null ? 'hsl(var(--primary))' : pct >= 100 ? 'hsl(var(--chart-2))' : pct >= 70 ? 'hsl(var(--chart-4))' : 'hsl(var(--destructive))';

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-3 px-4 pt-3 pb-3 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm text-foreground leading-snug">{group.groupName}</h3>
          {group.complianceNote && <p className="text-xs text-muted-foreground mt-0.5 italic">{group.complianceNote}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          <StatusBadge status={group.status} />
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Progress bar */}
      <div className="px-4 pb-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Users className="w-3 h-3" /> Participantes
          </span>
          <span className="text-xs font-bold text-foreground">
            {group.totalParticipants}{group.requiredParticipants ? ` / ${group.requiredParticipants}` : ''}
            {pct !== null && <span className="font-normal text-muted-foreground ml-1">({pct}%)</span>}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct ?? Math.min(100, group.totalParticipants * 10)}%`, background: barColor }} />
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-border/60 grid grid-cols-2 divide-x divide-border/60">
          {/* Left: participants */}
          <div className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Users className="w-3 h-3" /> Lista de participantes
            </p>
            {participants.length > 0
              ? <ParticipantTable participants={participants} />
              : <p className="text-xs text-muted-foreground italic">Sin datos de participantes</p>
            }
          </div>

          {/* Right: criteria scorecard + alerts */}
          <div className="p-4 space-y-3 overflow-y-auto max-h-[460px]">
            {group.criteria.length > 0 && <CriteriaScorecard criteria={group.criteria} />}
            {group.alerts.length > 0 && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-400/20 px-3 py-2.5 space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">Alertas</p>
                {group.alerts.map((alert, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                    <span>{alert}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Global stats — visual dashboard ──────────────────────────────────────────

const STATUS_COLORS = {
  cumple: 'hsl(142 76% 36%)',
  revisar: 'hsl(38 92% 50%)',
  no_cumple: 'hsl(var(--destructive))',
};

/** Shorten a group name to ~20 chars for axis labels */
function shortName(name: string, max = 22): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

function RecruitmentBarChart({ groups }: { groups: GroupAnalysis[] }) {
  const data = groups.map(g => {
    const pct = g.requiredParticipants
      ? Math.min(100, Math.round((g.totalParticipants / g.requiredParticipants) * 100))
      : null;
    return {
      name: shortName(g.groupName),
      reclutados: g.totalParticipants,
      requeridos: g.requiredParticipants ?? g.totalParticipants,
      pct,
      status: g.status,
      label: `${g.totalParticipants}${g.requiredParticipants ? `/${g.requiredParticipants}` : ''}`,
    };
  });

  const barHeight = 28;
  const chartHeight = Math.max(160, data.length * (barHeight + 10) + 20);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }} barSize={barHeight - 8}>
        <XAxis type="number" hide domain={[0, (dataMax: number) => Math.max(dataMax, 6)]} />
        <YAxis
          type="category" dataKey="name" width={160}
          tick={{ fontSize: 11, fill: 'hsl(var(--foreground))', fontWeight: 500 }}
          tickLine={false} axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
          contentStyle={{ fontSize: '12px', padding: '6px 10px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', boxShadow: 'none' }}
          formatter={(v: number, _: string, props: any) => [
            `${v} reclutados${props.payload.requeridos ? ` de ${props.payload.requeridos}` : ''}`,
          ]}
          labelStyle={{ fontWeight: 600, marginBottom: 2, color: 'hsl(var(--foreground))' }}
        />
        <Bar dataKey="reclutados" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={
                entry.pct === null ? 'hsl(var(--primary))' :
                entry.pct >= 100 ? STATUS_COLORS.cumple :
                entry.pct >= 70 ? STATUS_COLORS.revisar :
                STATUS_COLORS.no_cumple
              }
            />
          ))}
          <LabelList
            dataKey="label"
            position="right"
            style={{ fontSize: 11, fontWeight: 700, fill: 'hsl(var(--foreground))' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DonutChart({ items, title }: { items: { label: string; count: number }[]; title: string }) {
  const data = items.filter(d => d.count > 0).map(d => ({ name: d.label, value: d.count }));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!data.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="flex items-center gap-3">
        <PieChart width={96} height={96}>
          <Pie data={data} cx="50%" cy="50%" innerRadius={26} outerRadius={44} dataKey="value" paddingAngle={2} strokeWidth={0}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ fontSize: '11px', padding: '4px 8px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', boxShadow: 'none' }}
            formatter={(v: number, n: string) => [`${v} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`, n]}
          />
        </PieChart>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-[11px] text-muted-foreground truncate flex-1">{d.name}</span>
              <span className="text-[11px] font-bold text-foreground flex-shrink-0">
                {total > 0 ? Math.round((d.value / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FullAgeHistogram({ items, title }: { items: { label: string; count: number }[]; title: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={items} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="8%">
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={1} />
          <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: '11px', padding: '4px 8px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', boxShadow: 'none' }}
            formatter={(v: number, _: string, props: any) => [`${v} participante${v !== 1 ? 's' : ''}`, `Edad ${props?.payload?.label}`]}
            labelFormatter={() => ''}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {items.map((entry, i) => (
              <Cell key={i} fill={entry.count === 0 ? 'hsl(var(--muted))' : 'hsl(var(--chart-1))'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HBarChart({ items, title }: { items: { label: string; count: number }[]; title: string }) {
  const visible = items.filter(d => d.count > 0);
  if (!visible.length) return null;
  const chartHeight = Math.max(100, visible.length * 32 + 16);
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={visible} layout="vertical" margin={{ top: 2, right: 32, left: 4, bottom: 2 }} barSize={16}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={80} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ fontSize: '11px', padding: '4px 8px', background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px', boxShadow: 'none' }}
            formatter={(v: number) => [v]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {visible.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            <LabelList dataKey="count" position="right" style={{ fontSize: 10, fontWeight: 700, fill: 'hsl(var(--foreground))' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function isAgeField(fieldName: string) {
  return /^edad$|rango.{0,8}edad|edad.{0,8}rango/i.test(fieldName);
}
function isNumericAgeItems(items: { label: string }[]) {
  return items.length > 4 && items.every(d => /^\d{2}$/.test(d.label));
}
function isDonutField(fieldName: string) {
  return /g[eé]nero|sexo|nse|nivel.{0,8}soci/i.test(fieldName);
}

function GlobalStats({ analysis }: { analysis: Analysis }) {
  const groups = analysis.groups ?? [];
  const globalDists = (analysis.globalDistributions ?? []).filter(d => d.items.filter(i => i.count > 0).length > 0);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3" /> Vista general por grupo
        </p>
        <div className="flex items-center gap-2">
          <span className="text-lg font-black text-foreground">{analysis.totalParticipants}</span>
          <span className="text-xs text-muted-foreground">participantes · {groups.length} grupos</span>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Recruitment progress chart */}
        {groups.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Users className="w-3 h-3" /> Reclutados por grupo
            </p>
            <RecruitmentBarChart groups={groups} />

            {/* Status badges row */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {groups.map((g, i) => {
                const Icon =
                  g.status === 'cumple' ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                  g.status === 'no_cumple' ? <XCircle className="w-3 h-3 text-destructive" /> :
                  <AlertTriangle className="w-3 h-3 text-amber-500" />;
                const bg =
                  g.status === 'cumple' ? 'bg-emerald-500/8 border-emerald-400/25 text-emerald-700' :
                  g.status === 'no_cumple' ? 'bg-destructive/8 border-destructive/25 text-destructive' :
                  'bg-amber-500/8 border-amber-400/25 text-amber-700';
                return (
                  <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${bg}`}>
                    {Icon} {shortName(g.groupName, 28)}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Global distributions grid */}
        {globalDists.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <BarChart3 className="w-3 h-3" /> Distribuciones globales
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {globalDists.map((dist, i) => {
                if (isAgeField(dist.fieldName) && isNumericAgeItems(dist.items)) {
                  return <FullAgeHistogram key={i} items={dist.items} title={dist.fieldName} />;
                }
                if (isDonutField(dist.fieldName)) {
                  return <DonutChart key={i} items={dist.items} title={dist.fieldName} />;
                }
                return <HBarChart key={i} items={dist.items} title={dist.fieldName} />;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Criteria definition section ──────────────────────────────────────────────

function CriteriaDefinitionSection({ projectId, projectCode, instructions, setInstructions }: {
  projectId: string; projectCode: string; instructions: string; setInstructions: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveProject({ id: projectId, projectCode, instruccionesDeAnalisis: instructions });
      toast.success('Criterios guardados');
    } catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ClipboardList className="w-3 h-3" />
          Criterios de evaluación
          {instructions.trim()
            ? <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold">Definidos</span>
            : <span className="ml-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px]">Sin definir (AI inferirá)</span>
          }
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-border/60 pt-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Define exactamente qué criterios evaluar en cada grupo. El AI los usará como checklist prioritario.
            Si no defines nada, el AI inferirá los criterios de la muestra.
          </p>
          <Textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder={`Define qué criterios evaluar por grupo. Ej:\nGénero (campo: Género, esperado: Mujer)\nEdad (campo: Edad, rango 25-45 años)\nMarca (campo: 'Marca favorita de lácteos', debe coincidir con nombre del grupo)\nRegión (campo: Región)\nNSE (campo: NSE, esperado: C+ o superior)`}
            className="text-xs min-h-[110px] resize-none bg-muted/30 font-mono"
          />
          <div className="flex justify-end">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={save} disabled={saving}>
              <Save className="w-3 h-3" />
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface RecruitmentStatusPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectCode: string;
  boardName: string;
  projectId?: string;
  projectName?: string;
  muestraImageUrl?: string;
  initialInstruccionesDeAnalisis?: string;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export default function RecruitmentStatusPanel({
  open, onOpenChange, projectCode, boardName, projectId, muestraImageUrl,
  initialInstruccionesDeAnalisis,
}: RecruitmentStatusPanelProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCached, setLoadingCached] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [instructions, setInstructions] = useState(initialInstruccionesDeAnalisis ?? '');
  const loadedKey = useRef<string | null>(null);

  const cacheKey = `${projectCode}-${boardName}`;

  // Load from DB when panel opens (if no analysis yet for this board)
  useEffect(() => {
    if (!open) return;
    if (loadedKey.current === cacheKey && analysis) return;
    setLoadingCached(true);
    getLastAnalysis({ projectCode, boardName }).then(res => {
      if (res.found && res.analysis) {
        setAnalysis(res.analysis as Analysis);
        setSavedAt(res.savedAt ?? null);
        loadedKey.current = cacheKey;
      }
    }).catch(() => {}).finally(() => setLoadingCached(false));
  }, [open, cacheKey]);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const result = await analyzeRecruitmentStatus({ projectCode, boardName });
      setAnalysis(result);
      setSavedAt(result.generatedAt);
      loadedKey.current = cacheKey;
    } catch { toast.error('Error al generar el análisis'); }
    setLoading(false);
  };

  const handleOpenChange = (v: boolean) => {
    onOpenChange(v);
  };

  const generatedAt = analysis?.generatedAt
    ? new Date(analysis.generatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2.5">
              <BarChart3 className="w-4 h-4 text-primary flex-shrink-0" />
              <div>
                <span className="font-bold text-base">Status de Reclutamiento</span>
                <p className="text-xs text-muted-foreground font-normal mt-0.5">{projectCode} · {boardName}</p>
              </div>
              {analysis && <div className="ml-2"><StatusBadge status={analysis.overallStatus} /></div>}
            </DialogTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              {savedAt && !loading && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Último análisis: {formatRelativeTime(savedAt)}
                </span>
              )}
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={runAnalysis} disabled={loading || loadingCached}>
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Analizando...' : 'Regenerar'}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-5 space-y-4">

            {/* Muestra image */}
            {((analysis?.muestra && !['Sin criterios definidos', '(criterios en imagen)'].includes(analysis.muestra)) || muestraImageUrl) && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary/70 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Criterios de muestra
                </p>
                {analysis?.muestra && !['Sin criterios definidos', '(criterios en imagen)'].includes(analysis.muestra) && (
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{analysis.muestra}</p>
                )}
                {muestraImageUrl && (
                  <img src={muestraImageUrl} alt="Propuesta de muestra" className="w-full rounded-lg border border-primary/20 object-contain max-h-48" />
                )}
              </div>
            )}

            {/* Criteria definition */}
            {projectId && (
              <CriteriaDefinitionSection
                projectId={projectId}
                projectCode={projectCode}
                instructions={instructions}
                setInstructions={setInstructions}
              />
            )}

            {/* Loading */}
            {(loading || loadingCached) && (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full rounded-xl" />
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            )}

            {/* Content */}
            {!loading && !loadingCached && analysis && (
              <>
                {analysis.groups.length > 0 && <GlobalStats analysis={analysis} />}

                {analysis.globalSummary && (
                  <div className="rounded-xl bg-card border border-border px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Resumen AI
                    </p>
                    <p className="text-sm text-foreground leading-relaxed">{analysis.globalSummary}</p>
                  </div>
                )}

                {analysis.groups.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Users className="w-3 h-3" /> Detalle por grupo — haz clic para expandir
                    </p>
                    {analysis.groups.map((group, i) => <GroupCard key={i} group={group} />)}
                  </div>
                ) : (
                  <div className="text-center py-10 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-medium">Sin participantes en grupos</p>
                    <p className="text-xs mt-1">Asigna participantes a grupos para ver el análisis.</p>
                  </div>
                )}

                {generatedAt && (
                  <p className="text-[11px] text-muted-foreground text-center pb-2">Generado hoy a las {generatedAt}</p>
                )}
              </>
            )}

            {!loading && !loadingCached && !analysis && (
              <div className="text-center py-16 text-muted-foreground">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">Sin análisis guardado</p>
                <p className="text-xs mt-1">Haz clic en "Regenerar" para generar el primer análisis.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
