import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ESTILO_BOTON_PRIMARIO } from '@/components/payments/estilos';
import type { Escritura, GrupoSugerido } from '../../lib/indicadores/reclutadores';
import { fmtNum } from './formato';

/** Con al menos tantas respuestas, un grupo sugerido viene marcado de entrada: con menos, hay que marcarlo a propósito. */
const MIN_RESPUESTAS_MARCADO = 100;
const MAX_GRUPOS = 80;

/** «MATEO MEDINA» o «mateo medina» → «Mateo Medina»; si ya trae mayúsculas y minúsculas mezcladas, se respeta. */
export function nombreBonito(texto: string): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, esp: string, letra: string) => esp + letra.toUpperCase());
}

interface Estado { incluir: boolean; nombre: string; claves: Set<string> }

/** Propone reclutadores con los nombres que todavía no tienen dueño: se revisa, se corrige el nombre, se desmarca lo que no es, y se crean de una vez. */
export function SugerenciasReclutadores({ abierto, grupos, escrituras, onCerrar, onCrear }: {
  abierto: boolean;
  grupos: GrupoSugerido[];
  escrituras: ReadonlyMap<string, Escritura>;
  onCerrar: () => void;
  onCrear: (grupos: Array<{ nombre: string; claves: string[] }>) => Promise<boolean>;
}) {
  const mostrados = useMemo(() => grupos.slice(0, MAX_GRUPOS), [grupos]);
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setEstado(Object.fromEntries(mostrados.map((g) => [g.ancla, {
      incluir: g.total >= MIN_RESPUESTAS_MARCADO,
      nombre: nombreBonito(escrituras.get(g.ancla)?.nombre ?? g.ancla),
      claves: new Set(g.miembros.filter((m) => !m.ambiguo).map((m) => m.clave)),
    }])));
    setAbiertos(new Set());
  }, [abierto, mostrados, escrituras]);

  const elegidos = mostrados.filter((g) => estado[g.ancla]?.incluir && estado[g.ancla].claves.size > 0 && estado[g.ancla].nombre.trim());
  const formas = elegidos.reduce((s, g) => s + estado[g.ancla].claves.size, 0);
  const cambiar = (ancla: string, cambio: Partial<Estado>) => setEstado((e) => ({ ...e, [ancla]: { ...e[ancla], ...cambio } }));

  const crear = async () => {
    setCreando(true);
    const ok = await onCrear(elegidos.map((g) => ({ nombre: estado[g.ancla].nombre.trim(), claves: [...estado[g.ancla].claves] })));
    setCreando(false);
    if (ok) onCerrar();
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o && !creando) onCerrar(); }}>
      <DialogContent className="sm:max-w-3xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Sugerencias de reclutadores</DialogTitle>
        </DialogHeader>
        {mostrados.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No hay nada que sugerir: lo que falta por asignar aparece solo una o dos veces.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Cada renglón junta las formas parecidas de escribir un nombre bajo la más usada. Revisa el nombre, abre el renglón para desmarcar lo que no sea de esa persona
              (lo dudoso viene sin marcar) y crea los que sí. Lo que no crees queda en «Sin asignar».
            </p>
            <div className="max-h-[56vh] overflow-auto rounded-lg border">
              {mostrados.map((g) => {
                const s = estado[g.ancla];
                if (!s) return null;
                const abierta = abiertos.has(g.ancla);
                const dudosos = g.miembros.filter((m) => m.ambiguo).length;
                return (
                  <div key={g.ancla} className="border-b last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <input type="checkbox" aria-label={`Crear a ${s.nombre}`} checked={s.incluir} onChange={(e) => cambiar(g.ancla, { incluir: e.target.checked })} className="h-4 w-4 accent-[#0F3D4D]" />
                      <input
                        aria-label={`Nombre del reclutador para «${g.ancla}»`}
                        value={s.nombre}
                        maxLength={60}
                        onChange={(e) => cambiar(g.ancla, { nombre: e.target.value })}
                        className="w-56 rounded-md border bg-background px-2 py-1 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
                      />
                      <button type="button" onClick={() => setAbiertos((a) => { const n = new Set(a); if (n.has(g.ancla)) n.delete(g.ancla); else n.add(g.ancla); return n; })} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        {abierta ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {s.claves.size} de {g.miembros.length} {g.miembros.length === 1 ? 'forma' : 'formas'}, {fmtNum(g.total)} respuestas
                      </button>
                      {dudosos > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">{dudosos} {dudosos === 1 ? 'dudosa' : 'dudosas'}</span>}
                    </div>
                    {abierta && (
                      <ul className="space-y-0.5 bg-muted/30 px-10 py-2 text-xs">
                        {g.miembros.map((m) => (
                          <li key={m.clave}>
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={s.claves.has(m.clave)}
                                onChange={(e) => { const n = new Set(s.claves); if (e.target.checked) n.add(m.clave); else n.delete(m.clave); cambiar(g.ancla, { claves: n }); }}
                                className="h-3.5 w-3.5 accent-[#0F3D4D]"
                              />
                              <span>{escrituras.get(m.clave)?.nombre ?? m.clave}</span>
                              <span className="text-muted-foreground">{fmtNum(m.n)} respuestas</span>
                              {m.ambiguo && <span className="text-amber-800">podría ser de otra persona con el mismo nombre</span>}
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            {grupos.length > MAX_GRUPOS && <p className="text-xs text-muted-foreground">Se muestran los {MAX_GRUPOS} grupos con más respuestas; al crearlos salen los siguientes.</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Se crearán {elegidos.length} {elegidos.length === 1 ? 'reclutador' : 'reclutadores'} con {formas} {formas === 1 ? 'forma' : 'formas'} de escribir el nombre.</span>
              <span className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={onCerrar} disabled={creando}>Cancelar</Button>
                <Button type="button" className="gap-1.5 rounded-[10px] px-4 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO} onClick={crear} disabled={creando || elegidos.length === 0}>
                  {creando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Crear {elegidos.length} {elegidos.length === 1 ? 'reclutador' : 'reclutadores'}
                </Button>
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
