import { useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmentado } from '@/components/payments/Segmentado';
import { PERIODOS } from '../../lib/indicadores/reclutamiento';
import {
  SUJETO_BASE, SUJETO_TODOS, conteoCero, mesesDelRango, primerMesConDatos, resumenDe, serieMensual, sumarEn,
  type DatosReclutadores, type Periodo, type Reclutador,
} from '../../lib/indicadores/reclutadores';
import { fmtNum, fmtPct } from './formato';
import { BarrasApiladasMes, LineasMes, etiquetaMes, etiquetaMesLarga, type SerieGrafica, type SerieLinea } from './graficas';
import {
  COLORES_TRAMOS_EVOLUCION, COLOR_COMPARTIDO, COLOR_ENTRARON_ELEGIBLES, COLOR_ENTRARON_NO_ELEGIBLES, COLOR_NUEVA, COLOR_PCT_ENTRO, COLOR_PCT_NO_ELEGIBLES, COLOR_PCT_REPETIDAS,
} from './reclutadoresColores';

// Los colores salen de reclutadoresColores.ts (los mismos tonos de la barra de cada reclutador y de las rampas de elegibles y no elegibles), medidos para daltonismo:
// ver «Colores y daltonismo» en docs/reclutadores.md y server/scripts/test-colores-reclutadores.ts. Las repetidas se juntan en 4 tramos (1, 2 o 3, 4 a 7, 8 o más) para que el apilado
// no sea una tira de ocho cafés.
const SERIES_RESPUESTAS: SerieGrafica[] = [
  { clave: 'nuevas', nombre: 'Nuevas', color: COLOR_NUEVA },
  { clave: 'r1', nombre: 'Repetidas con 1 proyecto antes', color: COLORES_TRAMOS_EVOLUCION[0] },
  { clave: 'r23', nombre: 'Repetidas con 2 o 3', color: COLORES_TRAMOS_EVOLUCION[1] },
  { clave: 'r47', nombre: 'Repetidas con 4 a 7', color: COLORES_TRAMOS_EVOLUCION[2] },
  { clave: 'r8', nombre: 'Repetidas con 8 o más', color: COLORES_TRAMOS_EVOLUCION[3] },
  { clave: 'comp', nombre: 'Contacto compartido', color: COLOR_COMPARTIDO },
];
const SERIES_ENTRARON: SerieGrafica[] = [
  { clave: 'eleg', nombre: 'Entraron siendo elegibles', color: COLOR_ENTRARON_ELEGIBLES },
  { clave: 'noeleg', nombre: 'Entraron siendo no elegibles', color: COLOR_ENTRARON_NO_ELEGIBLES },
];
const SERIES_CALIDAD: SerieLinea[] = [
  { clave: 'rep', nombre: '% repetidas', color: COLOR_PCT_REPETIDAS, marcador: 'circulo' },
  { clave: 'noeleg', nombre: '% no elegibles al recibirse', color: COLOR_PCT_NO_ELEGIBLES, marcador: 'cuadro' },
  { clave: 'entro', nombre: '% que entró a un grupo', color: COLOR_PCT_ENTRO, marcador: 'rombo' },
];

function Bloque({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{ayuda}</p>
      <div className="overflow-x-auto"><div className="min-w-[600px]">{children}</div></div>
    </section>
  );
}

/**
 * La evolución mes por mes de un reclutador (o de todos): cuántas respuestas trajo y de qué tipo, cuántas entraron a un grupo (elegibles y no elegibles) y cómo van los
 * porcentajes, con una tabla debajo con los mismos números. Cada respuesta cae en el mes de inicio del proyecto donde se recibió. Se arma con lo ya guardado (versión 3): no consulta nada.
 */
export function EvolucionReclutador({ sujetoInicial, periodoInicial, datos, reclutadores, clavesPorReclutador, onCerrar }: {
  sujetoInicial: string;
  periodoInicial: Periodo;
  datos: DatosReclutadores;
  reclutadores: ReadonlyArray<Reclutador>;
  clavesPorReclutador: ReadonlyMap<string, ReadonlyArray<string>>;
  onCerrar: () => void;
}) {
  const [sujeto, setSujeto] = useState(sujetoInicial);
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial);

  const opciones = useMemo(() => [
    { id: SUJETO_TODOS, nombre: 'Todos los reclutadores' },
    ...[...reclutadores].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    { id: SUJETO_BASE, nombre: 'Toda la base, con y sin nombre' },
  ], [reclutadores]);
  const nombreSujeto = opciones.find((o) => o.id === sujeto)?.nombre ?? 'Todos los reclutadores';

  const meses = useMemo(() => mesesDelRango(datos.hoy, periodo, primerMesConDatos(datos)), [datos, periodo]);
  const serie = useMemo(() => {
    const claves = sujeto === SUJETO_BASE ? 'todas' as const : sujeto === SUJETO_TODOS ? [...clavesPorReclutador.values()].flat() : [...(clavesPorReclutador.get(sujeto) ?? [])];
    return serieMensual(datos, claves, meses, { incluirSinNombre: sujeto === SUJETO_BASE });
  }, [datos, meses, sujeto, clavesPorReclutador]);
  const filas = useMemo(() => serie.map(({ mes, conteo }) => ({ mes, r: resumenDe(conteo) })), [serie]);
  const total = useMemo(() => {
    const suma = conteoCero();
    for (const s of serie) sumarEn(suma, s.conteo);
    return resumenDe(suma);
  }, [serie]);

  const respuestas = filas.map(({ r }) => {
    const t = r.repetidasPorTramo;
    return [r.nuevas, t[0], t[1] + t[2], t[3] + t[4] + t[5] + t[6], t[7], r.compartido];
  });
  const valoresRespuestas = SERIES_RESPUESTAS.map((_, k) => respuestas.map((v) => v[k]));
  const valoresEntraron = [filas.map(({ r }) => Math.max(0, r.entraron - r.avisosQueEntraron)), filas.map(({ r }) => r.avisosQueEntraron)];
  const valoresCalidad = [filas.map(({ r }) => r.pctRepetidas), filas.map(({ r }) => r.pctAvisos), filas.map(({ r }) => r.pctEntraron)];
  const notasMes = filas.map(({ r }) => `${fmtNum(r.total)} ${r.total === 1 ? 'respuesta' : 'respuestas'} ese mes`);

  const mesEnCurso = meses[meses.length - 1];
  const primeroDeLaLista = meses[0];
  const rango = `${etiquetaMesLarga(primeroDeLaLista)} a ${etiquetaMesLarga(mesEnCurso)}`;
  const descripcion = (queMuestra: string) => `${queMuestra}. ${nombreSujeto}, ${rango}.`;

  return (
    <Dialog open onOpenChange={(abierto) => { if (!abierto) onCerrar(); }}>
      <DialogContent className="max-h-[92vh] w-[95vw] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>Evolución mes por mes</DialogTitle>
          <DialogDescription>Cada respuesta cuenta en el mes en que empezó el proyecto donde se recibió. El último mes va incompleto.</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-xs font-semibold">
            Ver a
            <select aria-label="Ver la evolución de" value={sujeto} onChange={(e) => setSujeto(e.target.value)} className="max-w-[16rem] rounded-[10px] border bg-card px-2.5 py-1.5 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#0F3D4D]/40">
              {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </label>
          <Segmentado<Periodo> etiqueta="Periodo" valor={periodo} onCambio={setPeriodo} opciones={PERIODOS.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))} />
        </div>

        {total.total === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-10 text-center text-xs text-muted-foreground">No hay respuestas de «{nombreSujeto}» en este periodo. Prueba con uno más largo.</p>
        ) : (
          <div className="min-w-0 space-y-6">
            <Bloque titulo="Respuestas que trajo" ayuda="De gente nueva y de gente que ya había llenado otro filtro; entre más oscuro el café, más proyectos antes.">
              <BarrasApiladasMes meses={meses} series={SERIES_RESPUESTAS} valores={valoresRespuestas} nombreTotal="Respuestas" descripcion={descripcion('Respuestas por mes, nuevas y repetidas')} />
            </Bloque>

            <Bloque titulo="Respuestas que entraron a un grupo" ayuda="Las que terminaron en un grupo, separadas en elegibles y no elegibles. En los meses recientes todavía pueden subir, porque la gente sigue entrando a grupos.">
              <BarrasApiladasMes meses={meses} series={SERIES_ENTRARON} valores={valoresEntraron} nombreTotal="Entraron a un grupo" descripcion={descripcion('Respuestas que entraron a un grupo por mes, elegibles y no elegibles')} />
            </Bloque>

            <Bloque titulo="Calidad de lo que trae" ayuda="Repetidas: sobre nuevas y repetidas. No elegibles: sobre todas menos el contacto compartido. Entró a un grupo: sobre todas, y en los meses recientes todavía sube. Con pocas respuestas en un mes el porcentaje salta mucho: al pasar el cursor sale cuántas fueron.">
              <LineasMes meses={meses} series={SERIES_CALIDAD} valores={valoresCalidad} notas={notasMes} descripcion={descripcion('Porcentaje de repetidas, de no elegibles y de las que entraron a un grupo, por mes')} />
            </Bloque>

            <section>
              <h3 className="text-sm font-semibold">Los números</h3>
              <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Lo mismo de las gráficas, del mes más reciente al más antiguo.</p>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full border-collapse text-xs tabular-nums" style={{ minWidth: 760 }}>
                  <caption className="sr-only">{descripcion('Números de cada mes')}</caption>
                  <thead className="border-b bg-muted/30 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" rowSpan={2} className="px-3 py-2 text-left">Mes</th>
                      <th scope="col" rowSpan={2} className="px-3 py-2 text-right">Respuestas</th>
                      <th scope="col" rowSpan={2} className="px-3 py-2 text-right">Nuevas</th>
                      <th scope="colgroup" colSpan={4} className="border-b border-border/60 px-3 pt-2 pb-1 text-center">Repetidas, con cuántos proyectos antes</th>
                      <th scope="col" rowSpan={2} className="px-3 py-2 text-right">Contacto compartido</th>
                      <th scope="col" rowSpan={2} className="px-3 py-2 text-right">No elegibles</th>
                      <th scope="col" rowSpan={2} className="px-3 py-2 text-right">Entraron a un grupo</th>
                    </tr>
                    <tr>
                      <th scope="col" className="whitespace-nowrap px-3 pb-2 text-right">1</th>
                      <th scope="col" className="whitespace-nowrap px-3 pb-2 text-right">2 o 3</th>
                      <th scope="col" className="whitespace-nowrap px-3 pb-2 text-right">4 a 7</th>
                      <th scope="col" className="whitespace-nowrap px-3 pb-2 text-right">8 o más</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filas.keys()].reverse().map((i) => {
                      const { mes, r } = filas[i];
                      const [, n1, n23, n47, n8] = respuestas[i];
                      return (
                        <tr key={mes} className="border-b last:border-b-0 hover:bg-muted/40">
                          <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-semibold">{etiquetaMes(mes)}{mes === mesEnCurso && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">en curso</span>}</th>
                          <td className="px-3 py-1.5 text-right">{fmtNum(r.total)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(r.nuevas)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(n1)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(n23)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(n47)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(n8)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(r.compartido)}</td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(r.avisos)}<span className="ml-1 text-muted-foreground">{r.pctAvisos === null ? '' : `(${fmtPct(r.pctAvisos)})`}</span></td>
                          <td className="px-3 py-1.5 text-right">{fmtNum(r.entraron)}<span className="ml-1 text-muted-foreground">{r.pctEntraron === null ? '' : `(${fmtPct(r.pctEntraron)})`}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t bg-muted/30 font-semibold">
                    <tr>
                      <th scope="row" className="px-3 py-2 text-left">Todo el periodo</th>
                      <td className="px-3 py-2 text-right">{fmtNum(total.total)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.nuevas)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.repetidasPorTramo[0])}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.repetidasPorTramo[1] + total.repetidasPorTramo[2])}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.repetidasPorTramo[3] + total.repetidasPorTramo[4] + total.repetidasPorTramo[5] + total.repetidasPorTramo[6])}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.repetidasPorTramo[7])}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.compartido)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.avisos)}<span className="ml-1 font-normal text-muted-foreground">{total.pctAvisos === null ? '' : `(${fmtPct(total.pctAvisos)})`}</span></td>
                      <td className="px-3 py-2 text-right">{fmtNum(total.entraron)}<span className="ml-1 font-normal text-muted-foreground">{total.pctEntraron === null ? '' : `(${fmtPct(total.pctEntraron)})`}</span></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
