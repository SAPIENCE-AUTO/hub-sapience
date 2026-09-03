import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getPreworkRespuestas, getPreworkMisiones, getPreworkTags, getPreworkPerfilesEstudio, analizarPreworkEstudio } from 'zite-endpoints-sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { getGroupColor } from '@/components/table/tableUtils';
import { RespuestaDetailDialog, type Respuesta } from './RespuestaDetailDialog';
import { useRealtimePreworkModerador } from '@/hooks/useRealtimePrework';

interface MisionOpt { id: string; titulo: string }
interface TagOpt { id: string; nombre: string }
interface Perfil { participanteId: string; genero?: string; edad?: string; nse?: string; region?: string }

type Dimension = 'genero' | 'edad' | 'nse' | 'region';
const DIMENSIONES: { key: Dimension; label: string }[] = [
  { key: 'genero', label: 'Género' }, { key: 'edad', label: 'Edad' },
  { key: 'nse', label: 'NSE' }, { key: 'region', label: 'Región' },
];

const ESTADO_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  pendiente: 'secondary', entregada: 'default', revisada: 'outline',
};

const SENTIMIENTO_COLOR: Record<string, string> = {
  positivo: 'hsl(var(--primary))', neutral: 'hsl(var(--muted-foreground))', negativo: 'hsl(var(--destructive))',
};

// Colores para valores de perfil (género/edad/NSE/región) — no vienen de
// Reclutamiento con un colorId propio (eso solo existe para grupos de
// tablero), así que se asignan de esta paleta ya validada en la app
// (GROUP_COLORS/getGroupColor, la misma que usan Gantt/Timeline) en orden
// fijo de aparición, nunca ciclados al azar.
const PERFIL_COLOR_IDS = ['blue-2', 'orange-2', 'green-2', 'purple-2', 'red-2', 'yellow-2', 'blue-4', 'orange-4', 'green-4', 'purple-4'];

const ALL = '__all__';
const SIN_COMPARAR = '__none__';

function BarList({ items, colorFor }: { items: { label: string; count: number }[]; colorFor?: (label: string) => string }) {
  const max = Math.max(1, ...items.map(i => i.count));
  if (items.length === 0) return <p className="text-xs text-muted-foreground">Sin datos todavía.</p>;
  return (
    <div className="space-y-1">
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-20 truncate text-muted-foreground" title={i.label}>{i.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${(i.count / max) * 100}%`, background: colorFor ? colorFor(i.label) : 'hsl(var(--primary))' }}
            />
          </div>
          <span className="w-6 text-right tabular-nums text-muted-foreground">{i.count}</span>
        </div>
      ))}
    </div>
  );
}

export function PreworkRespuestasTab({ estudioId }: { estudioId?: string }) {
  const [respuestas, setRespuestas] = useState<Respuesta[]>([]);
  const [misiones, setMisiones] = useState<MisionOpt[]>([]);
  const [tags, setTags] = useState<TagOpt[]>([]);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [loading, setLoading] = useState(true);
  const [misionId, setMisionId] = useState(ALL);
  const [estado, setEstado] = useState(ALL);
  const [tagId, setTagId] = useState(ALL);
  const [selected, setSelected] = useState<Respuesta | null>(null);
  const [analizandoProyecto, setAnalizandoProyecto] = useState(false);
  const [analisisProyecto, setAnalisisProyecto] = useState<{ resumenGeneral: string; temasPrincipales: { tema: string; detalle: string }[]; alertas: string[] } | null>(null);

  const [filtroPerfil, setFiltroPerfil] = useState<Record<Dimension, Set<string>>>({
    genero: new Set(), edad: new Set(), nse: new Set(), region: new Set(),
  });
  const [compararPor, setCompararPor] = useState<Dimension | typeof SIN_COMPARAR>(SIN_COMPARAR);

  const load = async (syncSelectedId?: string) => {
    if (!estudioId) return;
    setLoading(true);
    try {
      const res = await getPreworkRespuestas({
        estudioId,
        misionId: misionId !== ALL ? misionId : undefined,
        estado: estado !== ALL ? estado : undefined,
        tagId: tagId !== ALL ? tagId : undefined,
      });
      const nuevas: Respuesta[] = res.respuestas ?? [];
      setRespuestas(nuevas);
      if (syncSelectedId) setSelected(nuevas.find(r => r.id === syncSelectedId) ?? null);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [estudioId, misionId, estado, tagId]);

  useEffect(() => {
    if (!estudioId) return;
    getPreworkMisiones({ estudioId }).then(res => setMisiones((res.misiones ?? []).map((m: { id: string; titulo: string }) => ({ id: m.id, titulo: m.titulo }))));
    getPreworkTags({ estudioId }).then(res => setTags(res.tags ?? []));
    getPreworkPerfilesEstudio({ estudioId }).then(res => setPerfiles(res.perfiles ?? []));
  }, [estudioId]);

  useRealtimePreworkModerador({ estudioId, onRespuestaNueva: () => load() });

  const perfilPorParticipante = useMemo(() => new Map(perfiles.map(p => [p.participanteId, p])), [perfiles]);

  const valoresPorDimension = useMemo(() => {
    const result: Record<Dimension, string[]> = { genero: [], edad: [], nse: [], region: [] };
    const vistos: Record<Dimension, Set<string>> = { genero: new Set(), edad: new Set(), nse: new Set(), region: new Set() };
    for (const r of respuestas) {
      const p = perfilPorParticipante.get(r.participanteId);
      if (!p) continue;
      for (const { key } of DIMENSIONES) {
        const valor = p[key];
        if (valor && !vistos[key].has(valor)) { vistos[key].add(valor); result[key].push(valor); }
      }
    }
    return result;
  }, [respuestas, perfilPorParticipante]);

  const colorForValor = (dim: Dimension, valor: string) => {
    const idx = valoresPorDimension[dim].indexOf(valor);
    return getGroupColor(PERFIL_COLOR_IDS[idx % PERFIL_COLOR_IDS.length]);
  };

  const toggleFiltroPerfil = (dim: Dimension, valor: string) => {
    setFiltroPerfil(prev => {
      const next = new Set(prev[dim]);
      if (next.has(valor)) next.delete(valor); else next.add(valor);
      return { ...prev, [dim]: next };
    });
  };

  const respuestasFiltradas = useMemo(() => respuestas.filter(r => {
    const p = perfilPorParticipante.get(r.participanteId);
    for (const { key } of DIMENSIONES) {
      const activos = filtroPerfil[key];
      if (activos.size === 0) continue;
      if (!p?.[key] || !activos.has(p[key]!)) return false;
    }
    return true;
  }), [respuestas, perfilPorParticipante, filtroPerfil]);

  const porTag = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of respuestasFiltradas) for (const t of r.tags) counts.set(t.nombre, (counts.get(t.nombre) ?? 0) + 1);
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [respuestasFiltradas]);

  const porSentimiento = useMemo(() => {
    const counts: Record<string, number> = { positivo: 0, neutral: 0, negativo: 0 };
    for (const r of respuestasFiltradas) {
      const s = r.analisisAi?.sentimiento;
      if (s && s in counts) counts[s]++;
    }
    return (['positivo', 'neutral', 'negativo'] as const).map(label => ({ label, count: counts[label] }));
  }, [respuestasFiltradas]);

  const comparacion = useMemo(() => {
    if (compararPor === SIN_COMPARAR) return null;
    const grupos = new Map<string, Respuesta[]>();
    for (const r of respuestasFiltradas) {
      const valor = perfilPorParticipante.get(r.participanteId)?.[compararPor];
      if (!valor) continue;
      if (!grupos.has(valor)) grupos.set(valor, []);
      grupos.get(valor)!.push(r);
    }
    return [...grupos.entries()].map(([valor, rs]) => {
      const sent: Record<string, number> = { positivo: 0, neutral: 0, negativo: 0 };
      const tagCounts = new Map<string, number>();
      for (const r of rs) {
        const s = r.analisisAi?.sentimiento;
        if (s && s in sent) sent[s]++;
        for (const t of r.tags) tagCounts.set(t.nombre, (tagCounts.get(t.nombre) ?? 0) + 1);
      }
      const topTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        valor,
        totalRespuestas: rs.length,
        participantesUnicos: new Set(rs.map(r => r.participanteId)).size,
        sentimiento: sent,
        topTag,
      };
    }).sort((a, b) => b.totalRespuestas - a.totalRespuestas);
  }, [compararPor, respuestasFiltradas, perfilPorParticipante]);

  const dimensionesComparables = DIMENSIONES.filter(d => valoresPorDimension[d.key].length >= 2);

  const handleAnalizarProyecto = async () => {
    if (!estudioId) return;
    setAnalizandoProyecto(true);
    try {
      const res = await analizarPreworkEstudio({ estudioId });
      setAnalisisProyecto(res);
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo generar el análisis');
    } finally {
      setAnalizandoProyecto(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Select value={misionId} onValueChange={setMisionId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Misión" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las misiones</SelectItem>
              {misiones.map(m => <SelectItem key={m.id} value={m.id}>{m.titulo}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="entregada">Entregada</SelectItem>
              <SelectItem value="revisada">Revisada</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tagId} onValueChange={setTagId}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Tag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los tags</SelectItem>
              {tags.map(t => <SelectItem key={t.id} value={t.id}>{t.nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" onClick={handleAnalizarProyecto} disabled={analizandoProyecto}>
          {analizandoProyecto ? 'Analizando…' : 'Análisis IA del estudio'}
        </Button>
      </div>

      {analisisProyecto && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/20">
          <p className="text-sm font-medium">{analisisProyecto.resumenGeneral}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {analisisProyecto.temasPrincipales.map(t => (
              <div key={t.tema} className="text-xs">
                <span className="font-semibold">{t.tema}: </span>
                <span className="text-muted-foreground">{t.detalle}</span>
              </div>
            ))}
          </div>
          {analisisProyecto.alertas.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-amber-600">
              {analisisProyecto.alertas.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
        </div>
      )}

      {DIMENSIONES.some(d => valoresPorDimension[d.key].length > 0) && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground">Segmentar por perfil (de Reclutamiento)</p>
          {DIMENSIONES.filter(d => valoresPorDimension[d.key].length > 0).map(d => (
            <div key={d.key} className="flex flex-wrap items-center gap-1.5">
              <span className="w-14 text-xs text-muted-foreground">{d.label}</span>
              {valoresPorDimension[d.key].map(valor => {
                const color = colorForValor(d.key, valor);
                const active = filtroPerfil[d.key].has(valor);
                return (
                  <button
                    key={valor}
                    onClick={() => toggleFiltroPerfil(d.key, valor)}
                    className="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
                    style={active ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color, color }}
                  >
                    {valor}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Por tag ({respuestasFiltradas.length} respuestas)</p>
          <BarList items={porTag} />
        </div>
        <div className="rounded-md border p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Por sentimiento (análisis IA)</p>
          <BarList items={porSentimiento} colorFor={(l) => SENTIMIENTO_COLOR[l] ?? 'hsl(var(--muted-foreground))'} />
        </div>
      </div>

      {dimensionesComparables.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground">Comparar por:</p>
            <Select value={compararPor} onValueChange={(v) => setCompararPor(v as Dimension | typeof SIN_COMPARAR)}>
              <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_COMPARAR}>Sin comparar</SelectItem>
                {dimensionesComparables.map(d => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {comparacion && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {comparacion.map(c => (
                <div key={c.valor} className="rounded-md border p-3">
                  <p className="text-sm font-semibold" style={{ color: colorForValor(compararPor as Dimension, c.valor) }}>{c.valor}</p>
                  <p className="text-xs text-muted-foreground">{c.totalRespuestas} respuesta(s) · {c.participantesUnicos} participante(s)</p>
                  {c.topTag && <p className="text-xs text-muted-foreground">Tag más frecuente: {c.topTag}</p>}
                  <div className="mt-1.5">
                    <BarList
                      items={(['positivo', 'neutral', 'negativo'] as const).map(l => ({ label: l, count: c.sentimiento[l] }))}
                      colorFor={(l) => SENTIMIENTO_COLOR[l] ?? 'hsl(var(--muted-foreground))'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {!loading && respuestasFiltradas.length === 0 && <p className="text-sm text-muted-foreground">No hay respuestas con estos filtros.</p>}

      <div className="rounded-md border divide-y">
        {respuestasFiltradas.map(r => (
          <button
            key={r.id}
            onClick={() => setSelected(r)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{r.misionTitulo} <span className="font-normal text-muted-foreground">· {r.participanteNombre}</span></p>
              <p className="text-xs text-muted-foreground truncate">
                {r.contenido?.texto || (r.archivos?.length ? `${r.archivos.length} archivo(s)` : 'Sin contenido de texto')}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {r.tags.slice(0, 3).map(t => <Badge key={t.id} variant="secondary" className="text-[10px]">{t.nombre}</Badge>)}
            </div>
            <Badge variant={ESTADO_VARIANT[r.estado] ?? 'default'}>{r.estado}</Badge>
          </button>
        ))}
      </div>

      <RespuestaDetailDialog
        respuesta={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        estudioId={estudioId ?? ''}
        onUpdated={() => { if (selected) load(selected.id); }}
      />
    </div>
  );
}
