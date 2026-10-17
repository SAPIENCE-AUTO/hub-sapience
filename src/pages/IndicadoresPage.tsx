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
import { TarjetaVeces } from '@/components/indicadores/TarjetaVeces';
import { TendenciaTrimestral } from '@/components/indicadores/TendenciaTrimestral';
import { TablaProyectos } from '@/components/indicadores/TablaProyectos';
import { colorVeces } from '@/components/indicadores/colores';
import { fmtInstante, fmtNum } from '@/components/indicadores/formato';
import {
  INDICADORES, OPCIONES_GRAFICA, PERIODOS, VECES, claveVeces, enPeriodo, etiquetaVeces, fraseIndicador, porTrimestre, resumir, valorDe,
  valorPrimeraVez, valorVeces, type ClaveGrafica, type DatosReclutamiento, type Grupo, type Periodo,
} from '@/lib/indicadores/reclutamiento';
import { TEAL } from '@/lib/toolColors';

// Función cosmética: el candado de verdad está en el servidor (serverUtils/indicadores/acceso.ts).
const PERMITIDOS = ['sergio@sapience.com.mx'];

// Hoy por ahora hay un área; las demás (Comercial, Operación, Finanzas) se suman aquí como pestañas nuevas.
const AREAS = [{ id: 'reclutamiento', etiqueta: 'Reclutamiento' }] as const;

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
  const [graficar, setGraficar] = useState<ClaveGrafica>('noElegibles');

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
  const resumen = useMemo(() => resumir(enElPeriodo), [enElPeriodo]);
  const trimestres = useMemo(() => porTrimestre(enElPeriodo, graficar), [enElPeriodo, graficar]);
  const opcionGrafica = OPCIONES_GRAFICA.find((o) => o.clave === graficar)!;
  const gruposGrafica = [...new Set(OPCIONES_GRAFICA.map((o) => o.grupo))];
  const primeraVez = valorPrimeraVez(resumen);

  const cajitas = (grupo: Grupo) => VECES.map((v) => {
    const valor = valorVeces(resumen, grupo, v);
    const clave = claveVeces(grupo, v);
    return (
      <TarjetaVeces
        key={clave}
        etiqueta={etiquetaVeces(v)}
        nombreMeta={`${grupo === 'noElegibles' ? 'no elegibles' : 'elegibles'} con ${etiquetaVeces(v)}`}
        color={colorVeces(grupo, v)}
        pct={valor.pct}
        detalle={valor.total > 0 ? `${fmtNum(valor.parte)} de ${fmtNum(valor.total)}` : 'Sin personas'}
        meta={metas[clave]}
        onMeta={(m) => guardarMeta(clave, m)}
      />
    );
  });

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-[190px] rounded-xl" />)}</div>
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
            <span className="ml-auto text-xs text-muted-foreground">
              {fmtNum(resumen.proyectos)} proyectos · {fmtNum(resumen.participaron)} personas que entraron a un grupo
            </span>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {INDICADORES.map((ind) => {
              const v = valorDe(resumen, ind.clave);
              return (
                <TarjetaIndicador
                  key={ind.clave}
                  etiqueta={ind.etiqueta}
                  frase={fraseIndicador(ind.clave, v)}
                  pct={v.pct}
                  mejor={ind.mejor}
                  meta={metas[ind.clave]}
                  onMeta={(valor) => guardarMeta(ind.clave, valor)}
                />
              );
            })}
          </div>

          <div className="mb-4 rounded-xl border bg-muted/30 p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">No elegibles que entraron: {fmtNum(resumen.noElegibles)} personas</h2>
              <p className="text-xs text-muted-foreground">¿Cuántas veces ya habían participado antes? Cada persona cae en un solo tramo, y los porcentajes son de estas {fmtNum(resumen.noElegibles)}.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{cajitas('noElegibles')}</div>
          </div>

          <div className="mb-5 rounded-xl border bg-muted/30 p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Elegibles que entraron: {fmtNum(resumen.elegibles)} personas</h2>
              <p className="text-xs text-muted-foreground">Las que no traían aviso: ¿entraron por primera vez o ya habían participado? Los porcentajes son de estas {fmtNum(resumen.elegibles)}.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <TarjetaVeces etiqueta="Primera vez" pct={primeraVez.pct} detalle={primeraVez.total > 0 ? `${fmtNum(primeraVez.parte)} de ${fmtNum(primeraVez.total)}` : 'Sin personas'} />
              {cajitas('elegibles')}
            </div>
          </div>

          <div className="mb-5 rounded-xl border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{opcionGrafica.etiqueta}, por trimestre</h2>
              <select
                aria-label="Indicador de la gráfica"
                value={graficar}
                onChange={(e) => setGraficar(e.target.value as ClaveGrafica)}
                className="max-w-full rounded-[10px] border bg-muted px-2.5 py-1.5 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-[#0F3D4D]/40"
              >
                {gruposGrafica.map((g) => (
                  <optgroup key={g} label={g}>
                    {OPCIONES_GRAFICA.filter((o) => o.grupo === g).map((o) => <option key={o.clave} value={o.clave}>{o.etiqueta}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <TendenciaTrimestral puntos={trimestres} meta={metas[opcionGrafica.meta]} mejor={opcionGrafica.mejor} />
          </div>

          <div className="mb-5">
            <h2 className="mb-2 text-sm font-semibold">Por proyecto</h2>
            <TablaProyectos proyectos={enElPeriodo} metaNoElegibles={metas.noElegibles} />
          </div>

          <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <p><b>Aviso («no elegible»):</b> la persona ya había participado con el mismo cliente, o en cualquier proyecto en los 6 meses anteriores al inicio de este. <b>Elegible:</b> entró sin ese aviso. <b>Entró a un grupo:</b> asistió, o está en un grupo con estatus vacío, pendiente o confirmado. <b>Seguimiento:</b> tiene un estatus distinto de «Pendiente» o vacío. Cada cifra se mide contra la fecha de inicio de su proyecto.</p>
            <p><b>Veces que ya habían participado:</b> solo se cuentan los proyectos anteriores, sin contar el actual; los tramos 1, 2, 3 y 4 son exactos y el último es «5 o más», así que suman el grupo. <b>Avisos respetados:</b> de las personas con aviso a las que el equipo dio seguimiento, cuántas se frenaron en vez de terminar en un grupo; las que se quedan en «Pendiente» sin que nadie las toque no cuentan. Las filas repetidas son la misma persona más de una vez en un mismo tablero.</p>
            {datos.proyectos.some((p) => p.inferida) && <p>* El proyecto no tiene fecha de inicio: se usó la de su última actividad.</p>}
            {datos.sinFecha > 0 && <p>{fmtNum(datos.sinFecha)} registros persona-proyecto quedaron fuera por no haber ninguna fecha del proyecto.</p>}
          </div>
        </>
      )}
    </div>
  );
}
