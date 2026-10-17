import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { calcularIndicadoresReclutamiento, getIndicadoresReclutamiento, saveIndicadorMeta } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmentado } from '@/components/payments/Segmentado';
import { CLASE_BOTON_SUAVE, ESTILO_BOTON_PRIMARIO } from '@/components/payments/estilos';
import { TarjetaIndicador } from '@/components/indicadores/TarjetaIndicador';
import { TendenciaTrimestral } from '@/components/indicadores/TendenciaTrimestral';
import { TablaProyectos } from '@/components/indicadores/TablaProyectos';
import { fmtInstante, fmtNum } from '@/components/indicadores/formato';
import {
  INDICADORES, OPCIONES_PREVIAS, PERIODOS, claveMeta, enPeriodo, porTrimestre, resumir, valorDe,
  type DatosReclutamiento, type Periodo, type Previas,
} from '@/lib/indicadores/reclutamiento';
import { TEAL } from '@/lib/toolColors';

// Función cosmética: el candado de verdad está en el servidor (serverUtils/indicadores/acceso.ts).
const PERMITIDOS = ['sergio@sapience.com.mx'];

// Hoy por ahora hay un área; las demás (Comercial, Operación, Finanzas) se suman aquí como pestañas nuevas.
const AREAS = [{ id: 'reclutamiento', etiqueta: 'Reclutamiento' }] as const;

const AYUDA: Record<string, (previas: Previas) => string> = {
  noElegibles: () => 'Personas que ya habían participado con el mismo cliente, o en cualquier proyecto en los 6 meses anteriores al inicio de este, y aun así quedaron en un grupo.',
  detectados: () => 'De las personas marcadas «no elegible», cuántas no llegaron a entrar a un grupo: el filtro las detuvo.',
  repetidores: (previas) => `Personas que entraron con ${previas} o más participaciones previas en otros proyectos.`,
  duplicados: () => 'Personas que entraron y aparecen en más de una fila de un mismo tablero.',
};

const hoyLocal = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la zona de quien mira

const mensaje = (e: unknown, defecto: string) => (e instanceof Error && e.message && e.message !== 'Error interno' ? e.message : defecto);

export default function IndicadoresPage() {
  const { user } = useAuth();
  const permitido = PERMITIDOS.includes(((user as { email?: string } | undefined)?.email ?? '').toLowerCase());

  const [datos, setDatos] = useState<DatosReclutamiento | undefined>();
  const [calculadoEn, setCalculadoEn] = useState<string | undefined>();
  const [metas, setMetas] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>('12m');
  const [previas, setPrevias] = useState<Previas>(3);

  const aplicar = (r: { datos?: DatosReclutamiento; calculadoEn?: string; metas?: Record<string, number> }) => {
    setDatos(r.datos);
    setCalculadoEn(r.calculadoEn);
    setMetas(r.metas ?? {});
  };

  const cargar = useCallback(async () => {
    try {
      aplicar(await getIndicadoresReclutamiento({}));
    } catch (e) {
      toast.error(mensaje(e, 'No se pudieron cargar los indicadores'));
    }
    setCargando(false);
  }, []);

  useEffect(() => { if (permitido) void cargar(); else setCargando(false); }, [permitido, cargar]);

  const calcular = async () => {
    setCalculando(true);
    try {
      aplicar(await calcularIndicadoresReclutamiento({}));
      toast.success('Indicadores actualizados');
    } catch (e) {
      toast.error(mensaje(e, 'No se pudieron calcular los indicadores'));
    }
    setCalculando(false);
  };

  const guardarMeta = async (indicador: string, valor: number | null) => {
    const antes = metas;
    setMetas((m) => {
      const { [indicador]: _quitar, ...resto } = m;
      return valor === null ? resto : { ...resto, [indicador]: valor };
    });
    try {
      await saveIndicadorMeta({ area: 'reclutamiento', indicador, valor });
    } catch (e) {
      setMetas(antes);
      toast.error(mensaje(e, 'No se pudo guardar la meta'));
    }
  };

  const hoy = hoyLocal();
  const enElPeriodo = useMemo(() => (datos ? enPeriodo(datos.proyectos, periodo, hoy) : []), [datos, periodo, hoy]);
  const resumen = useMemo(() => resumir(enElPeriodo, previas), [enElPeriodo, previas]);
  const trimestres = useMemo(() => porTrimestre(enElPeriodo), [enElPeriodo]);

  if (!permitido) {
    return <div className="p-6 text-sm text-muted-foreground">Esta sección no está habilitada para tu usuario.</div>;
  }

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">Metas por área</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {cargando ? 'Cargando…' : calculadoEn ? `Calculado el ${fmtInstante(calculadoEn)}` : 'Todavía sin calcular'}
          </p>
        </div>
        {datos && (
          <button type="button" onClick={calcular} disabled={calculando} className={CLASE_BOTON_SUAVE}>
            {calculando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {calculando ? 'Calculando… hasta 1 minuto' : 'Actualizar'}
          </button>
        )}
      </div>

      <div role="tablist" className="mb-4 flex items-end gap-6 border-b">
        {AREAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected
            className="-mb-px inline-flex items-center border-b-2 pb-2.5 pt-1 text-[13px] font-semibold"
            style={{ borderColor: TEAL, color: TEAL }}
          >
            {a.etiqueta}
          </button>
        ))}
      </div>

      {cargando && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[150px] rounded-xl" />)}</div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {!cargando && !datos && (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: TEAL }}><Target className="h-5 w-5 text-white" /></div>
          <p className="text-sm font-semibold">Todavía no se han calculado los indicadores de Reclutamiento</p>
          <p className="max-w-md text-xs text-muted-foreground">Se cuentan con los datos de todos los proyectos y se guardan, para que esta pantalla abra al instante. Tarda hasta un minuto.</p>
          <Button className="gap-1.5 rounded-[10px] px-4 hover:brightness-110" style={ESTILO_BOTON_PRIMARIO} onClick={calcular} disabled={calculando}>
            {calculando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {calculando ? 'Calculando…' : 'Calcular ahora'}
          </Button>
        </div>
      )}

      {!cargando && datos && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <Segmentado<Periodo> etiqueta="Periodo" valor={periodo} onCambio={setPeriodo} opciones={PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Repetidores: con
              <Segmentado<`${Previas}`>
                etiqueta="Participaciones previas para contar a un repetidor"
                valor={`${previas}`}
                onCambio={(v) => setPrevias(Number(v) as Previas)}
                opciones={OPCIONES_PREVIAS.map((k) => ({ valor: `${k}` as `${Previas}`, etiqueta: `${k}+` }))}
              />
              participaciones previas
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {fmtNum(resumen.proyectos)} proyectos · {fmtNum(resumen.participaron)} personas que entraron
            </span>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INDICADORES.map((ind) => {
              const v = valorDe(resumen, ind.clave);
              const clave = claveMeta(ind.clave, previas);
              return (
                <TarjetaIndicador
                  key={clave}
                  etiqueta={ind.clave === 'repetidores' ? `Repetidores (${previas}+ previas)` : ind.etiqueta}
                  ayuda={AYUDA[ind.clave](previas)}
                  pct={v.pct} parte={v.parte} total={v.total} de={v.de}
                  mejor={ind.mejor}
                  meta={metas[clave]}
                  onMeta={(valor) => guardarMeta(clave, valor)}
                />
              );
            })}
          </div>

          <div className="mb-5 rounded-xl border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">No elegibles que entran, por trimestre</h2>
            <TendenciaTrimestral puntos={trimestres} meta={metas.noElegibles} />
          </div>

          <div className="mb-5">
            <h2 className="mb-2 text-sm font-semibold">Por proyecto</h2>
            <TablaProyectos proyectos={enElPeriodo} previas={previas} metaNoElegibles={metas.noElegibles} />
          </div>

          <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <p><b>No elegible:</b> ya había participado con el mismo cliente, o en cualquier proyecto en los 6 meses anteriores al inicio del proyecto. <b>Entró:</b> asistió, o está en un grupo con estatus vacío, pendiente o confirmado. Cada cifra se mide contra la fecha de inicio de su proyecto.</p>
            <p>A los repetidores se les cuentan solo las participaciones en proyectos anteriores. Los duplicados son filas repetidas dentro de un mismo tablero (la misma persona llenó el filtro más de una vez).</p>
            {datos.proyectos.some((p) => p.inferida) && <p>* El proyecto no tiene fecha de inicio: se usó la de su última actividad.</p>}
            {datos.sinFecha > 0 && <p>{fmtNum(datos.sinFecha)} registros persona-proyecto quedaron fuera por no haber ninguna fecha del proyecto.</p>}
          </div>
        </>
      )}
    </div>
  );
}
