import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { actualizarCatalogoBusqueda, buscarGente, getCatalogoBusqueda } from 'zite-endpoints-sdk';
import { useAuth } from 'zite-auth-sdk';
import { puedeVerBuscador } from '@/lib/busqueda/acceso';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CLASE_BOTON_SUAVE, ESTILO_BOTON_PRIMARIO } from '@/components/payments/estilos';
import { GrupoResultado } from '@/components/buscador/GrupoResultado';
import { fmtInstante, fmtNum } from '@/components/indicadores/formato';
import type { GrupoHallado } from '@/lib/busqueda/agrupar';
import { TEAL } from '@/lib/toolColors';

interface Estado { existe: boolean; tableros: number; preguntas: number; respuestas: number; actualizado: string | null }
/** `termino` es el normalizado (sin acentos) con el que se busca; `escrito` es como lo escribió la persona. */
interface Resultado { termino: string; escrito: string; recortado: boolean; grupos: GrupoHallado[] }

const EJEMPLOS = ['corona', 'levité', 'victoria', 'cerveza', 'heineken'];
const mensaje = (e: unknown, defecto: string) => (e instanceof Error && e.message && e.message !== 'Error interno' ? e.message : defecto);

/**
 * «Buscar gente»: en qué preguntas y filtros anteriores se preguntó por una marca o un tema, cómo se preguntó y qué contestó la gente, para saber dónde hay consumidores o rechazadores de algo. Es un
 * reservorio: no depende de ningún proyecto. Busca en un catálogo que se arma leyendo los tableros (botón «Actualizar»), así que responde al instante.
 */
export default function BuscarGentePage() {
  const { user } = useAuth();
  // Cosmético: el candado de verdad está en el servidor (serverUtils/busqueda/acceso.ts). Hoy solo Sergio (lib/busqueda/acceso.ts).
  const permitido = puedeVerBuscador((user as { email?: string } | null | undefined)?.email);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [termino, setTermino] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [progreso, setProgreso] = useState('');

  const cargarEstado = useCallback(async () => {
    try {
      setEstado(await getCatalogoBusqueda({}));
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo ver el estado del buscador'));
    }
    setCargando(false);
  }, []);
  useEffect(() => { if (permitido) void cargarEstado(); else setCargando(false); }, [permitido, cargarEstado]);

  const buscar = async (texto = termino) => {
    const t = texto.trim();
    if (t.length < 2) { toast.info('Escribe al menos dos letras'); return; }
    setBuscando(true);
    try {
      setResultado({ ...(await buscarGente({ termino: t })), escrito: t });
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo buscar'));
    }
    setBuscando(false);
  };
  const enviar = (ev: FormEvent) => { ev.preventDefault(); void buscar(); };

  const actualizar = async () => {
    setActualizando(true);
    setProgreso('Empezando…');
    try {
      const flujo = actualizarCatalogoBusqueda({});
      for await (const ch of flujo) if (ch?.paso) setProgreso(ch.total ? `${ch.paso} ${ch.hechos} de ${ch.total}` : ch.paso);
      const r = await flujo;
      toast.success(r.leidos > 0 ? `Se leyeron ${fmtNum(r.leidos)} ${r.leidos === 1 ? 'tablero' : 'tableros'}` : 'Todo estaba al día');
      if (r.fallidos?.length) toast.warning(`${fmtNum(r.fallidos.length)} ${r.fallidos.length === 1 ? 'tablero no se pudo leer' : 'tableros no se pudieron leer'}`);
      await cargarEstado();
      if (resultado) await buscar(resultado.escrito);
    } catch (e) {
      toast.error(mensaje(e, 'No se pudo actualizar el buscador'));
    }
    setActualizando(false);
    setProgreso('');
  };

  const sinTablas = estado && !estado.existe;
  const vacio = estado?.existe && estado.tableros === 0;

  if (!permitido) {
    return <div className="p-6 text-sm text-muted-foreground">Esta sección no está habilitada para tu usuario.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight"><Users className="h-5 w-5" style={{ color: TEAL }} />Buscar gente</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Dónde se ha preguntado por una marca o un tema en los filtros anteriores, cómo se preguntó y qué contestó la gente. Sirve para saber en qué tableros hay consumidores o rechazadores de algo.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <button type="button" onClick={actualizar} disabled={actualizando || !!sinTablas} className={CLASE_BOTON_SUAVE}>
            {actualizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {actualizando ? (progreso || 'Actualizando…') : 'Actualizar'}
          </button>
          {estado?.existe && !actualizando && (
            <span className="text-[11px] text-muted-foreground">
              {estado.tableros > 0
                ? `${fmtNum(estado.tableros)} tableros y ${fmtNum(estado.preguntas)} preguntas, leídos el ${estado.actualizado ? fmtInstante(estado.actualizado) : '—'}`
                : 'Todavía no se ha leído ningún tablero'}
            </span>
          )}
        </div>
      </div>

      {sinTablas && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          El buscador todavía no está listo: faltan crear sus tablas en la base. Cuando estén, aquí se podrá actualizar y buscar.
        </div>
      )}
      {vacio && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          Todavía no se ha leído ningún tablero. Pulsa «Actualizar»: la primera vez tarda unos minutos y después solo lee lo que cambió.
        </div>
      )}

      <form onSubmit={enviar} className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Marca o palabra a buscar"
            placeholder="Escribe una marca o una palabra: corona, levité, cerveza…"
            value={termino}
            onChange={(e) => setTermino(e.target.value)}
            maxLength={80}
            disabled={!!sinTablas}
            className="w-full rounded-[10px] border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#0F3D4D]/40 disabled:opacity-50"
          />
        </label>
        <button type="submit" disabled={buscando || !!sinTablas || termino.trim().length < 2} className="inline-flex items-center gap-1.5 rounded-[10px] px-4 py-2 text-sm font-semibold hover:brightness-110 disabled:opacity-50" style={ESTILO_BOTON_PRIMARIO}>
          {buscando && <Loader2 className="h-4 w-4 animate-spin" />}Buscar
        </button>
      </form>

      {!resultado && !buscando && !sinTablas && (
        <p className="mb-6 text-xs text-muted-foreground">
          Prueba con{' '}
          {EJEMPLOS.map((e, i) => (
            <span key={e}>{i > 0 && ', '}<button type="button" onClick={() => { setTermino(e); void buscar(e); }} className="font-semibold text-foreground hover:underline">{e}</button></span>
          ))}.
        </p>
      )}

      {cargando && <Skeleton className="h-40 rounded-xl" />}

      {resultado && (
        <div className="mt-5">
          {resultado.grupos.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No encontré «{resultado.escrito}» en ninguna pregunta ni respuesta. Revisa cómo se escribe o prueba con otra palabra.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm">
                «{resultado.escrito}» sale de {fmtNum(resultado.grupos.length)} {resultado.grupos.length === 1 ? 'forma de preguntar' : 'formas de preguntar'}.
                <span className="text-muted-foreground"> Se cuentan filas de los tableros (una persona puede salir más de una vez), no personas distintas.</span>
              </p>
              {resultado.recortado && (
                <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">Hay muchísimas coincidencias y se muestran las que tienen más respuestas. Prueba con una palabra más precisa.</p>
              )}
              <div className="space-y-4">
                {resultado.grupos.map((g) => <GrupoResultado key={`${resultado.termino}|${g.donde}|${g.clave}`} grupo={g} termino={resultado.termino} escrito={resultado.escrito} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
