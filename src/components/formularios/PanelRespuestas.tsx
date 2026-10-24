import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  getFormularioRespuesta, exportFormularioRespuestas,
  getTablerosReclutamiento, vincularFormularioTablero, pasarFormularioAlReclutamiento, crearTableroParaFormulario,
} from 'zite-endpoints-sdk';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowRightLeft, Copy, Download, ExternalLink, Eye, Link2, Loader2, Plus, RefreshCw, Trash2, TriangleAlert, Users } from 'lucide-react';
import { TEAL, EXITO, PELIGRO, ALERTA, GRIS, INFO } from '@/lib/toolColors';
import { describir } from '@/lib/formularios/motor';
import { reglaVigente } from '@/lib/formularios/nse';
import { descargarExcel } from '@/lib/formularios/excel';
import type { Definicion, Respuestas, Resultado } from '@/lib/formularios/tipos';
import type { Generador } from '@/lib/formularios/generador';

export interface RespuestaRow {
  id: string; createdAt: string; esPrueba: boolean; nombre?: string; telefono?: string; edad?: string; genero?: string; nse?: string;
  /** Frentes donde entró aunque su NSE no es el que pide el frente: alerta, no descarte. */
  nseFueraDe: string[];
  califica: boolean; frentes: string[]; motivo?: string; alertas: string[]; incompleto: boolean; duplicado: boolean; duracionSeg?: number;
  enReclutamiento: boolean;
}
export interface Detalle {
  id: string; codigo: string; titulo: string; estado: string; definicion: Definicion; revision?: number;
  tablero?: { id: string; nombre: string }; respuestas: RespuestaRow[];
  /** Fase 3: el generador con IA, si el filtro se hizo con él, y el uso de IA de la última hora. */
  generador?: Generador; usoIA?: { usadas: number; limite: number };
  /** En vivo: la copia de trabajo con los cambios sin publicar. */
  cambios?: Definicion;
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function PillResultado({ r }: { r: RespuestaRow }) {
  return (
    <>
      <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white" style={{ backgroundColor: r.califica ? EXITO : r.incompleto ? GRIS : PELIGRO }}>
        {r.califica ? 'Califica' : r.incompleto ? 'Incompleta' : 'No califica'}
      </span>
      {r.alertas.length > 0 && <TriangleAlert className="ml-1.5 inline h-3.5 w-3.5" style={{ color: ALERTA }} />}
      {r.enReclutamiento && <span className="ml-1.5 whitespace-nowrap text-[10px] font-semibold" style={{ color: INFO }}>En reclutamiento</span>}
    </>
  );
}

function Nse({ r }: { r: RespuestaRow }) {
  return (
    <span className="whitespace-nowrap" style={{ color: r.nseFueraDe.length ? ALERTA : undefined }} title={r.nseFueraDe.length ? 'No es el NSE que pide su perfil (no descarta)' : undefined}>
      {r.nse ?? '—'}{r.nseFueraDe.length > 0 && <TriangleAlert className="ml-1 inline h-3 w-3" />}
    </span>
  );
}

const Prueba = () => <span className="ml-1.5 rounded bg-[#F4C025]/30 px-1 text-[10px] font-semibold text-[#7a5d00]">PRUEBA</span>;

/**
 * Modo Reclutar de un filtro: el enlace y el tablero arriba, las cuotas con su
 * avance y la lista de respuestas, cada una con «Ver» para su detalle con
 * fotos. En pantallas angostas las respuestas van en tarjetas.
 */
export function PanelRespuestas({ detalle, proyectoId, enlace, onRecargar, onBorrarPruebas }: {
  detalle: Detalle;
  proyectoId?: string;
  /** El enlace que se comparte con los participantes. */
  enlace: string;
  onRecargar: () => void;
  onBorrarPruebas: () => void;
}) {
  const def = detalle.definicion;
  const frentes = def.frentes ?? [];
  const nombreFrente = (id: string) => frentes.find((f) => f.id === id)?.nombre ?? id;
  const hayPruebas = detalle.respuestas.some((r) => r.esPrueba);
  const [descargando, setDescargando] = useState(false);
  const [ver, setVer] = useState<RespuestaRow | null>(null);

  const descargar = async () => {
    setDescargando(true);
    try {
      const r = await exportFormularioRespuestas({ formularioId: detalle.id });
      if (r.found) await descargarExcel(r.titulo, r.definicion, r.filas);
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo armar el Excel.');
    }
    setDescargando(false);
  };

  const cuotas = useMemo(() => frentes.map((f) => {
    const filas = detalle.respuestas.filter((r) => r.califica && r.frentes.includes(f.id));
    return {
      ...f, califican: filas.length, nseDistinto: filas.filter((r) => r.nseFueraDe.includes(f.id)).length,
      mujeres: filas.filter((r) => r.genero === 'Mujer').length, hombres: filas.filter((r) => r.genero === 'Hombre').length,
    };
  }), [frentes, detalle.respuestas]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <TarjetaEnlace enlace={enlace} estado={detalle.estado} />
        {/* key: al cambiar de formulario se reinicia (el nombre propuesto para un tablero nuevo es el del formulario). */}
        <TarjetaReclutamiento key={detalle.id} detalle={detalle} proyectoId={proyectoId} onCambio={onRecargar} />
      </div>

      {frentes.length > 0 && (
        <div className="rounded-xl border bg-white px-4 py-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: TEAL }}>Cuotas</h3>
            <span className="text-xs text-muted-foreground">
              {cuotas.reduce((a, c) => a + Math.min(c.califican, c.meta), 0)} de {cuotas.reduce((a, c) => a + c.meta, 0)} · {detalle.respuestas.length} {detalle.respuestas.length === 1 ? 'contestó' : 'contestaron'}
            </span>
          </div>
          <ul className="space-y-2.5">
            {cuotas.map((c) => {
              const lleno = c.califican >= c.meta;
              return (
                <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(140px,220px)_minmax(0,1fr)_auto]">
                  <span className="min-w-0 truncate font-medium" title={c.nombre}>{c.nombre}</span>
                  <span className="order-3 col-span-2 h-2 rounded-full bg-[#EDEDF0] sm:order-none sm:col-span-1">
                    <span className="block h-2 rounded-full" style={{ width: `${Math.min(100, c.meta ? (c.califican / c.meta) * 100 : 0)}%`, backgroundColor: lleno ? EXITO : TEAL }} />
                  </span>
                  <span className="whitespace-nowrap text-right text-xs">
                    <span className="font-semibold" style={{ color: lleno ? EXITO : undefined }}>{c.califican} / {c.meta}{lleno ? ' ✓' : ''}</span>
                    <span className="ml-2 text-muted-foreground">{c.mujeres} M · {c.hombres} H</span>
                    {c.nseDistinto > 0 && <span className="ml-2" style={{ color: ALERTA }}>{c.nseDistinto} NSE distinto</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: TEAL }}>Respuestas ({detalle.respuestas.length})</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={onRecargar}><RefreshCw className="mr-1 h-3.5 w-3.5" />Actualizar</Button>
            <Button size="sm" variant="outline" onClick={descargar} disabled={descargando || detalle.respuestas.length === 0}>
              {descargando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}Excel
            </Button>
            {hayPruebas && <Button size="sm" variant="outline" onClick={onBorrarPruebas}><Trash2 className="mr-1 h-3.5 w-3.5" />Borrar pruebas</Button>}
          </div>
        </div>
        {detalle.respuestas.length === 0
          ? <p className="text-sm text-muted-foreground">Todavía no hay respuestas.</p>
          : (
            <>
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Edad</th>
                      <th className="px-3 py-2">NSE</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2">Perfil o motivo</th><th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.respuestas.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/40">
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{fecha(r.createdAt)}{r.esPrueba && <Prueba />}</td>
                        <td className="px-3 py-2">
                          {r.nombre ?? '—'}
                          {r.duplicado && <span className="ml-1.5 text-[10px] font-semibold" style={{ color: ALERTA }}>tel. repetido</span>}
                        </td>
                        <td className="px-3 py-2">{r.edad ?? '—'}{r.genero ? ` · ${r.genero}` : ''}</td>
                        <td className="px-3 py-2"><Nse r={r} /></td>
                        <td className="px-3 py-2"><PillResultado r={r} /></td>
                        <td className="px-3 py-2 text-xs">{r.califica ? r.frentes.map(nombreFrente).join(', ') : r.motivo}</td>
                        <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" className="h-7" onClick={() => setVer(r)}><Eye className="mr-1 h-3.5 w-3.5" />Ver</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="grid gap-2 md:hidden">
                {detalle.respuestas.map((r) => (
                  <li key={r.id} className="rounded-lg border px-3 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {r.nombre ?? 'Sin nombre'}
                          {r.duplicado && <span className="ml-1.5 text-[10px] font-semibold" style={{ color: ALERTA }}>tel. repetido</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{fecha(r.createdAt)}{r.esPrueba && <Prueba />}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 flex-shrink-0" onClick={() => setVer(r)}><Eye className="mr-1 h-3.5 w-3.5" />Ver</Button>
                    </div>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <PillResultado r={r} />
                      <span className="text-muted-foreground">{r.edad ?? '—'}{r.genero ? ` · ${r.genero}` : ''} · NSE <Nse r={r} /></span>
                    </p>
                    <p className="mt-1 text-xs">{r.califica ? r.frentes.map(nombreFrente).join(', ') : r.motivo}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
      </div>

      {ver && (
        <RespuestaDialog
          formularioId={detalle.id}
          definicion={def}
          tablero={detalle.tablero}
          fila={ver}
          onClose={() => setVer(null)}
          onPasada={() => { setVer(null); onRecargar(); }}
        />
      )}
    </div>
  );
}

/** Si los puntos del NSE están por confirmar, o si el filtro trae una regla que ya no es la vigente del país. */
export function AvisoRegla({ def }: { def: Definicion }) {
  const vigente = reglaVigente(def.pais);
  const texto = def.nse?.porConfirmar ? 'puntos por confirmar'
    : vigente && def.nse?.regla && def.nse.regla !== vigente ? `la vigente es ${vigente}` : undefined;
  return texto ? <span style={{ color: ALERTA }}> ({texto})</span> : null;
}

function TarjetaEnlace({ enlace, estado }: { enlace: string; estado: string }) {
  return (
    <Card>
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4" style={{ color: TEAL }} />
          <span className="text-sm font-semibold" style={{ color: TEAL }}>Enlace para participantes</span>
        </div>
        <p className="truncate rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[13px]" title={enlace}>{enlace.replace(/^https?:\/\//, '')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => { void navigator.clipboard.writeText(enlace); toast.success('Enlace copiado'); }}><Copy className="mr-1 h-3.5 w-3.5" />Copiar</Button>
          <Button size="sm" variant="outline" onClick={() => window.open(enlace, '_blank')}><ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir</Button>
          {estado === 'prueba' && <span className="text-xs text-muted-foreground">En prueba: lo que entra queda marcado como prueba.</span>}
          {estado === 'cerrado' && <span className="text-xs text-muted-foreground">Cerrado: ya no recibe respuestas.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function TarjetaReclutamiento({ detalle, proyectoId, onCambio }: { detalle: Detalle; proyectoId?: string; onCambio: () => void }) {
  const [tableros, setTableros] = useState<{ id: string; nombre: string }[] | null>(null);
  const [elegido, setElegido] = useState('');
  const [cambiando, setCambiando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState(detalle.titulo);
  const [trabajando, setTrabajando] = useState(false);
  const pendientes = detalle.respuestas.filter((r) => r.califica && !r.enReclutamiento).length;
  const mostrarSelector = !detalle.tablero || cambiando;

  useEffect(() => {
    if (!proyectoId || !mostrarSelector || tableros) return;
    getTablerosReclutamiento({ proyectoId }).then((r) => {
      setTableros(r.tableros ?? []);
      setElegido(detalle.tablero?.id ?? r.tableros?.[0]?.id ?? '');
    });
  }, [proyectoId, mostrarSelector, tableros, detalle.tablero?.id]);

  const vincular = async () => {
    if (!elegido) return;
    setTrabajando(true);
    try {
      const r = await vincularFormularioTablero({ formularioId: detalle.id, boardId: elegido });
      if (r.columnasCreadas) toast.success(`Se agregaron ${r.columnasCreadas} columnas al tablero`);
      setCambiando(false);
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setTrabajando(false);
  };

  // Mismo efecto que «+ Tablero» en la pestaña Reclutamiento, pero ya queda vinculado.
  const crear = async () => {
    if (!nombreNuevo.trim()) return;
    setTrabajando(true);
    try {
      const r = await crearTableroParaFormulario({ formularioId: detalle.id, nombre: nombreNuevo.trim() });
      toast.success(`Tablero «${r.nombre}» creado y vinculado, con ${r.columnasCreadas} columnas`);
      setCreando(false);
      setCambiando(false);
      setTableros(null);
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setTrabajando(false);
  };

  const pasar = async () => {
    setTrabajando(true);
    try {
      const r = await pasarFormularioAlReclutamiento({ formularioId: detalle.id });
      toast.success(r.pasadas
        ? `${r.pasadas === 1 ? '1 persona pasó' : `${r.pasadas} personas pasaron`} al tablero «${r.tablero}»`
        : 'No había respuestas nuevas que califiquen');
      onCambio();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setTrabajando(false);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" style={{ color: TEAL }} />
          <span className="text-sm font-semibold" style={{ color: TEAL }}>Tablero de Reclutamiento</span>
        </div>
        {mostrarSelector && (creando || tableros?.length === 0) ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Nombre del tablero nuevo</span>
            <Input className="h-8 w-64" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
            <Button size="sm" onClick={crear} disabled={trabajando || !nombreNuevo.trim()}>
              {trabajando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Crear y vincular
            </Button>
            {(creando || cambiando) && <Button size="sm" variant="ghost" onClick={() => { setCreando(false); if (tableros?.length === 0) setCambiando(false); }}>Cancelar</Button>}
          </div>
        ) : mostrarSelector ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Tablero al que pasan las respuestas</span>
            {tableros === null && <Loader2 className="h-4 w-4 animate-spin" />}
            {!!tableros?.length && (
              <>
                <select className="rounded-md border px-2 py-1.5 text-sm" value={elegido} onChange={(e) => setElegido(e.target.value)}>
                  {tableros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                <Button size="sm" onClick={vincular} disabled={trabajando || !elegido}>Vincular</Button>
                <Button size="sm" variant="outline" onClick={() => setCreando(true)}><Plus className="mr-1 h-3.5 w-3.5" />Crear tablero nuevo</Button>
                {cambiando && <Button size="sm" variant="ghost" onClick={() => setCambiando(false)}>Cancelar</Button>}
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Vinculado al tablero <strong>«{detalle.tablero!.nombre}»</strong></span>
            <Button size="sm" onClick={pasar} disabled={trabajando || pendientes === 0}>
              {trabajando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />}
              Pasar las que califican ({pendientes})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setTableros(null); setCambiando(true); }}>Cambiar tablero</Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Quien pasa entra como «Pendiente», con todas las preguntas como columnas. Pasar dos veces no duplica.</p>
      </CardContent>
    </Card>
  );
}

function RespuestaDialog({ formularioId, definicion, tablero, fila, onClose, onPasada }: {
  formularioId: string;
  definicion: Definicion;
  tablero?: { id: string; nombre: string };
  fila: RespuestaRow;
  onClose: () => void;
  onPasada: () => void;
}) {
  const [datos, setDatos] = useState<{ respuestas: Respuestas; resultado: Resultado; fotos: Record<string, string> } | null>(null);
  const [pasando, setPasando] = useState(false);

  // A mano se puede pasar a cualquiera, califique o no: el equipo decide si lo revisa.
  const pasar = async () => {
    setPasando(true);
    try {
      await pasarFormularioAlReclutamiento({ formularioId, respuestaIds: [fila.id] });
      toast.success(`${fila.nombre ?? 'La respuesta'} pasó al tablero «${tablero?.nombre}»`);
      onPasada();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setPasando(false);
  };

  useEffect(() => {
    getFormularioRespuesta({ respuestaId: fila.id }).then((r) => r.found && setDatos(r));
  }, [fila.id]);

  const nombreFrente = (id: string) => definicion.frentes?.find((f) => f.id === id)?.nombre ?? id;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{fila.nombre ?? 'Respuesta'}{fila.esPrueba ? ' · prueba' : ''}</DialogTitle></DialogHeader>
        {tablero && (
          fila.enReclutamiento
            ? <p className="text-xs" style={{ color: INFO }}>Ya está en el tablero «{tablero.nombre}» de Reclutamiento.</p>
            : (
              <Button size="sm" variant="outline" className="self-start" onClick={pasar} disabled={pasando}>
                {pasando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />}
                Pasar al tablero «{tablero.nombre}»
              </Button>
            )
        )}
        {!datos && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
        {datos && (
          <div className="space-y-5 text-sm">
            <div className="rounded-lg border p-3">
              <p>
                <span className="font-semibold" style={{ color: fila.califica ? EXITO : PELIGRO }}>{fila.califica ? 'Califica' : 'No califica'}</span>
                {datos.resultado.frentes.length > 0 && ` · ${datos.resultado.frentes.map(nombreFrente).join(', ')}`}
                {datos.resultado.nse && ` · NSE ${datos.resultado.nse.nivel} (${datos.resultado.nse.puntos} puntos${definicion.nse?.regla ? `, ${definicion.nse.regla}` : ''}${definicion.nse?.porConfirmar ? ' por confirmar' : ''})`}
                {fila.duracionSeg !== undefined && ` · ${Math.round(fila.duracionSeg / 60)} min`}
              </p>
              {fila.motivo && <p className="mt-1 text-muted-foreground">{fila.motivo}</p>}
              {datos.resultado.alertas.map((a) => <p key={a} className="mt-1" style={{ color: ALERTA }}>⚠ {a}</p>)}
            </div>
            {describir(definicion, datos.respuestas).map((s, i) => (
              <div key={`${s.titulo}-${i}`}>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.titulo}</h4>
                <dl className="space-y-1.5">
                  {s.lineas.map((l, j) => (
                    <div key={j}>
                      <dt className="text-xs text-muted-foreground">{l.texto}</dt>
                      {l.fotos
                        ? (
                          <dd className="mt-1 flex flex-wrap gap-2">
                            {l.fotos.map((f) => datos.fotos[f.ruta]
                              ? <a key={f.ruta} href={datos.fotos[f.ruta]} target="_blank" rel="noreferrer"><img src={datos.fotos[f.ruta]} alt={f.nombre} className="h-28 w-28 rounded-md border object-cover" /></a>
                              : <span key={f.ruta} className="text-xs text-muted-foreground">{f.nombre} (no se pudo abrir)</span>)}
                          </dd>
                        )
                        : <dd>{l.valor}</dd>}
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
