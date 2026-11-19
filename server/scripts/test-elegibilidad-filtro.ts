// Pruebas del filtro de «Elegibilidad» del tablero de Reclutamiento por ícono (triángulo, calendario o sin ícono) en lugar de Sí/No. Corren el filtro de verdad
// (el hook useTableFilters, que se ejecuta con el render del servidor de React) sobre 9 personas inventadas, una por cada combinación de íconos, sin base de datos.
// Revisa: que una persona con los dos íconos salga tanto con «Triángulo» como con «Calendario»; que «Sin ícono» sea justo quien no muestra ninguno; que la lista del filtro
// salga en orden y solo con lo que hay; que las columnas de siempre (texto, selección) se comporten igual que antes; y que las vistas guardadas con Sí/No (4 en producción,
// todas con «No») se abran mostrando lo mismo que antes y que las demás vistas ni se toquen.
// uso: node server/node_modules/.bin/tsx server/scripts/test-elegibilidad-filtro.ts
import assert from 'node:assert/strict';
import { createElement, useRef } from 'react';
import { renderToString } from 'react-dom/server';
import {
  celdaEnFiltro, coincideSeleccion, textoDeCelda, useTableFilters, valoresDeCelda, valoresUnicosDeColumna,
  type FilterColumn, type FilterRule,
} from '../../src/hooks/useTableFilters';
import {
  ELEG_CALENDARIO, ELEG_SIN_ICONO, ELEG_TRIANGULO, OPCIONES_ELEGIBILIDAD,
  iconosElegibilidad, migrarFiltroElegibilidad, valoresElegibilidad, type InsigniaElegibilidad,
} from '../../src/lib/elegibilidad';

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).message : (e as Error).message.split('\n')[0]}`);
  }
}

// ─── Nueve personas inventadas, una por combinación ───
const insignias: Record<string, InsigniaElegibilidad | undefined> = {
  Ana:  { hasHighRisk: true,  signals: ['same_client'], participatedSameClient: true,  participatedLast6Months: false }, // solo triángulo
  Beto: { hasHighRisk: true,  signals: ['recent'],      participatedSameClient: false, participatedLast6Months: true },  // solo calendario
  Carla:{ hasHighRisk: true,  signals: ['same_client'], participatedSameClient: true,  participatedLast6Months: true },  // los dos
  Diego:{ hasHighRisk: false, signals: [],              participatedSameClient: false, participatedLast6Months: false }, // ninguno
  Elena:{ hasHighRisk: false, signals: ['old'],         participatedSameClient: false, participatedLast6Months: false }, // participó hace más de 6 meses: sin ícono de elegibilidad
  Fer:  { hasHighRisk: true,  signals: ['same_client'] },                                                                // servidor sin las banderas nuevas: se deduce de las señales
  Gabo: { hasHighRisk: true,  signals: ['recent'] },
  Hugo: undefined,                                                                                                         // todavía sin información de íconos
  Irma: { hasHighRisk: true,  signals: [], participatedSameClient: false, participatedLast6Months: false },               // datos que no cuadran: no muestra ningún ícono
};
const nombres = Object.keys(insignias);
const filas = nombres.map((nombre, i) => ({
  id: `f${i}`,
  participantName: nombre,
  status: i % 2 === 0 ? 'Confirmado' : 'Nuevo',
  _dupRisk: valoresElegibilidad(insignias[nombre]),
}));
const columnas: FilterColumn[] = [
  { key: 'participantName', label: 'Participante', type: 'text' },
  { key: 'status', label: 'Estado', type: 'select', options: ['Nuevo', 'Confirmado'] },
  { key: '_dupRisk', label: 'Elegibilidad', type: 'select', options: OPCIONES_ELEGIBILIDAD },
];

// ─── Ejecuta el hook de verdad: las actualizaciones hechas durante el render las repite el render del servidor con el estado nuevo ───
type Api = ReturnType<typeof useTableFilters<any>>;
function conFiltros<T extends object>(data: T[], cols: FilterColumn[], preparar: (api: Api) => void = () => {}): Api {
  let ultimo!: Api;
  function Sonda() {
    const api = useTableFilters(data, cols);
    const listo = useRef(false);
    if (!listo.current) { listo.current = true; preparar(api); }
    ultimo = api;
    return null;
  }
  renderToString(createElement(Sonda));
  return ultimo;
}
const quienes = (api: Api) => (api.filteredData as typeof filas).map((f) => f.participantName);
const conMarcados = (...marcados: string[]) => quienes(conFiltros(filas, columnas, (api) => api.setColFilter('_dupRisk', new Set(marcados))));
const regla = (r: Partial<FilterRule> & Pick<FilterRule, 'operator'>): FilterRule => ({ id: `r-${Math.random()}`, column: '_dupRisk', value: '', ...r });
const conReglas = (reglas: FilterRule[], modo: 'and' | 'or' = 'and') =>
  quienes(conFiltros(filas, columnas, (api) => { api.setAdvancedFilters(reglas); api.setFilterMode(modo); }));
const igualSinOrden = (a: string[], b: string[]) => assert.deepEqual([...a].sort(), [...b].sort());

// ═══ Qué íconos tiene cada persona ═══
await prueba('cada persona muestra los íconos que le tocan (los dos a la vez, uno, o ninguno) y el filtro usa la misma regla', () => {
  const esperado: Record<string, [boolean, boolean, string[]]> = {
    Ana:   [true,  false, [ELEG_TRIANGULO]],
    Beto:  [false, true,  [ELEG_CALENDARIO]],
    Carla: [true,  true,  [ELEG_TRIANGULO, ELEG_CALENDARIO]],
    Diego: [false, false, [ELEG_SIN_ICONO]],
    Elena: [false, false, [ELEG_SIN_ICONO]],
    Fer:   [true,  false, [ELEG_TRIANGULO]],
    Gabo:  [false, true,  [ELEG_CALENDARIO]],
    Hugo:  [false, false, [ELEG_SIN_ICONO]],
    Irma:  [false, false, [ELEG_SIN_ICONO]],
  };
  for (const [nombre, [triangulo, calendario, valores]] of Object.entries(esperado)) {
    assert.deepEqual(iconosElegibilidad(insignias[nombre]), { mismoCliente: triangulo, ultimos6Meses: calendario }, nombre);
    assert.deepEqual(valoresElegibilidad(insignias[nombre]), valores, nombre);
  }
});

// ═══ El filtro de la columna (el embudo del encabezado) ═══
await prueba('«Triángulo» muestra a todos los que tienen el triángulo, también a quien tiene además el calendario', () => {
  igualSinOrden(conMarcados(ELEG_TRIANGULO), ['Ana', 'Carla', 'Fer']);
});
await prueba('«Calendario» muestra a todos los que tienen el calendario, también a quien tiene además el triángulo', () => {
  igualSinOrden(conMarcados(ELEG_CALENDARIO), ['Beto', 'Carla', 'Gabo']);
});
await prueba('«Sin ícono» muestra solo a quien no muestra ninguno de los dos', () => {
  igualSinOrden(conMarcados(ELEG_SIN_ICONO), ['Diego', 'Elena', 'Hugo', 'Irma']);
});
await prueba('marcar varias opciones junta a las personas (sin repetir a nadie), y las tres opciones juntas muestran a todos', () => {
  igualSinOrden(conMarcados(ELEG_TRIANGULO, ELEG_CALENDARIO), ['Ana', 'Beto', 'Carla', 'Fer', 'Gabo']);
  igualSinOrden(conMarcados(ELEG_TRIANGULO, ELEG_SIN_ICONO), ['Ana', 'Carla', 'Diego', 'Elena', 'Fer', 'Hugo', 'Irma']);
  igualSinOrden(conMarcados(...OPCIONES_ELEGIBILIDAD), nombres);
});
await prueba('sin ningún filtro salen todos, y limpiar el filtro de la columna los devuelve', () => {
  assert.equal(quienes(conFiltros(filas, columnas)).length, 9);
  assert.equal(conMarcados().length, 9);
});

// ═══ La lista de opciones del embudo ═══
await prueba('la lista del filtro sale en el orden triángulo, calendario, sin ícono (no alfabético) y solo con lo que hay', () => {
  assert.deepEqual(conFiltros(filas, columnas).colUniqueValues('_dupRisk'), [ELEG_TRIANGULO, ELEG_CALENDARIO, ELEG_SIN_ICONO]);
  const sinCalendario = filas.filter((f) => !f._dupRisk.includes(ELEG_CALENDARIO));
  assert.deepEqual(conFiltros(sinCalendario, columnas).colUniqueValues('_dupRisk'), [ELEG_TRIANGULO, ELEG_SIN_ICONO]);
  const soloSinIcono = filas.filter((f) => f._dupRisk[0] === ELEG_SIN_ICONO);
  assert.deepEqual(conFiltros(soloSinIcono, columnas).colUniqueValues('_dupRisk'), [ELEG_SIN_ICONO]);
});

// ═══ El filtro avanzado ═══
await prueba('filtro avanzado: «es Triángulo» y «no es Triángulo» se reparten a todos sin repetir', () => {
  const con = conReglas([regla({ operator: 'es', value: ELEG_TRIANGULO })]);
  const sin = conReglas([regla({ operator: 'no_es', value: ELEG_TRIANGULO })]);
  igualSinOrden(con, ['Ana', 'Carla', 'Fer']);
  igualSinOrden(sin, ['Beto', 'Diego', 'Elena', 'Gabo', 'Hugo', 'Irma']);
  igualSinOrden([...con, ...sin], nombres);
});
await prueba('filtro avanzado: «es alguno de» triángulo y calendario, y «no es ninguno de» esos dos (que es lo mismo que sin ícono)', () => {
  igualSinOrden(conReglas([regla({ operator: 'es_alguno', selectedValues: [ELEG_TRIANGULO, ELEG_CALENDARIO] })]), ['Ana', 'Beto', 'Carla', 'Fer', 'Gabo']);
  igualSinOrden(conReglas([regla({ operator: 'no_es_ninguno', selectedValues: [ELEG_TRIANGULO, ELEG_CALENDARIO] })]), ['Diego', 'Elena', 'Hugo', 'Irma']);
});
await prueba('filtro avanzado: solo calendario (con calendario y sin triángulo) y los dos íconos a la vez se pueden pedir combinando reglas', () => {
  igualSinOrden(conReglas([regla({ operator: 'es', value: ELEG_CALENDARIO }), regla({ operator: 'no_es', value: ELEG_TRIANGULO })]), ['Beto', 'Gabo']);
  igualSinOrden(conReglas([regla({ operator: 'es', value: ELEG_CALENDARIO }), regla({ operator: 'es', value: ELEG_TRIANGULO })]), ['Carla']);
  igualSinOrden(conReglas([regla({ operator: 'es', value: ELEG_CALENDARIO }), regla({ operator: 'es', value: ELEG_TRIANGULO })], 'or'), ['Ana', 'Beto', 'Carla', 'Fer', 'Gabo']);
});
await prueba('filtro avanzado: «está vacío» no atrapa a nadie en esta columna (siempre trae un valor) y «no está vacío» a todos', () => {
  assert.deepEqual(conReglas([regla({ operator: 'vacio' })]), []);
  assert.equal(conReglas([regla({ operator: 'no_vacio' })]).length, 9);
});

// ═══ Lo que ya existía no cambia ═══
await prueba('una celda de un solo texto se comporta igual que antes en las cuatro operaciones de selección y en el filtro de columna', () => {
  assert.deepEqual(valoresDeCelda('Nuevo'), ['Nuevo']);
  assert.deepEqual(valoresDeCelda(undefined), ['']);
  assert.deepEqual(valoresDeCelda(null), ['']);
  assert.deepEqual(valoresDeCelda(7), ['7']);
  assert.equal(textoDeCelda('Nuevo'), 'Nuevo');
  assert.equal(coincideSeleccion('Nuevo', { operator: 'es', value: 'Nuevo' }), true);
  assert.equal(coincideSeleccion('Nuevo', { operator: 'es', value: 'Confirmado' }), false);
  assert.equal(coincideSeleccion('Nuevo', { operator: 'no_es', value: 'Confirmado' }), true);
  assert.equal(coincideSeleccion('Nuevo', { operator: 'es_alguno', value: '', selectedValues: ['Confirmado', 'Nuevo'] }), true);
  assert.equal(coincideSeleccion('Nuevo', { operator: 'no_es_ninguno', value: '', selectedValues: ['Confirmado', 'Nuevo'] }), false);
  assert.equal(coincideSeleccion('Nuevo', { operator: 'raro', value: 'x' }), true); // un operador desconocido no filtra, como antes
  assert.equal(celdaEnFiltro('Nuevo', new Set(['Nuevo'])), true);
  assert.equal(celdaEnFiltro('Nuevo', new Set(['Confirmado'])), false);
  assert.equal(celdaEnFiltro(undefined, new Set([''])), true); // la opción «(vacío)»
});
await prueba('las demás columnas filtran igual: «Estado» por selección y «Participante» por texto', () => {
  const porEstado = quienes(conFiltros(filas, columnas, (api) => api.setColFilter('status', new Set(['Nuevo']))));
  assert.deepEqual(porEstado, nombres.filter((_, i) => i % 2 === 1));
  const porTexto = quienes(conFiltros(filas, columnas, (api) => api.setAdvancedFilters([regla({ column: 'participantName', operator: 'contiene', selectedValues: ['ar'], value: 'ar' })])));
  assert.deepEqual(porTexto, ['Carla']);
  const porSeleccion = quienes(conFiltros(filas, columnas, (api) => api.setAdvancedFilters([regla({ column: 'status', operator: 'es_alguno', selectedValues: ['Confirmado'] })])));
  assert.deepEqual(porSeleccion, nombres.filter((_, i) => i % 2 === 0));
});
await prueba('la lista de valores de una columna normal sigue siendo alfabética y con «(vacío)» al final, aunque la columna traiga su propio orden de opciones', () => {
  assert.deepEqual(valoresUnicosDeColumna(['Nuevo', 'Confirmado', '', 'Nuevo', undefined]), ['Confirmado', 'Nuevo', '']);
  assert.deepEqual(valoresUnicosDeColumna(['Nuevo', 'Confirmado'], ['Nuevo', 'Confirmado']), ['Confirmado', 'Nuevo']);
  assert.deepEqual(conFiltros(filas, columnas).colUniqueValues('status'), ['Confirmado', 'Nuevo']);
  assert.deepEqual(valoresUnicosDeColumna([['Calendario'], ['Triángulo', 'Calendario'], []], OPCIONES_ELEGIBILIDAD), [ELEG_TRIANGULO, ELEG_CALENDARIO, '']);
});

// ═══ Vistas guardadas con el filtro de antes ═══
const vista = (extra: Record<string, unknown>) => JSON.stringify({ filterRules: [], filterMode: 'and', columnFilters: {}, hiddenColumns: ['phone'], sortColumn: null, sortDirection: 'asc', ...extra });
/** Lo que mostraba el filtro de antes: «Sí» si tenía alguna alerta, «No» si no (con datos que cuadran: sin Irma). */
const antes = (nombre: string) => (iconosElegibilidad(insignias[nombre]).mismoCliente || iconosElegibilidad(insignias[nombre]).ultimos6Meses ? 'Sí' : 'No');
const consistentes = nombres.filter((x) => x !== 'Irma');

await prueba('una vista guardada con «No» (las 4 que hay en producción) se abre mostrando a los mismos que antes; sin traducirla no mostraría a nadie', () => {
  const guardada = vista({ columnFilters: { _dupRisk: ['No'] } });
  const sinTraducir = quienes(conFiltros(filas, columnas, (api) => api.applyViewFilters(guardada)));
  assert.deepEqual(sinTraducir, [], 'el «No» viejo ya no es ninguna opción: por eso se traduce al abrir la vista');
  const traducida = migrarFiltroElegibilidad(guardada);
  const ahora = quienes(conFiltros(filas, columnas, (api) => api.applyViewFilters(traducida))).filter((x) => consistentes.includes(x));
  igualSinOrden(ahora, consistentes.filter((x) => antes(x) === 'No'));
});
await prueba('una vista guardada con «Sí» o con ambos se abre mostrando a los mismos que antes', () => {
  const siguen = (guardada: string, valores: string[]) => {
    const ahora = quienes(conFiltros(filas, columnas, (api) => api.applyViewFilters(migrarFiltroElegibilidad(guardada)))).filter((x) => consistentes.includes(x));
    igualSinOrden(ahora, consistentes.filter((x) => valores.includes(antes(x))));
  };
  siguen(vista({ columnFilters: { _dupRisk: ['Sí'] } }), ['Sí']);
  siguen(vista({ columnFilters: { _dupRisk: ['Sí', 'No'] } }), ['Sí', 'No']);
});
await prueba('la traducción cambia solo ese filtro: lo demás de la vista queda igual, con las claves en el mismo orden', () => {
  const guardada = vista({ columnFilters: { status: ['Nuevo'], _dupRisk: ['No'], _dupBoard: ['Sí'] }, hiddenColumns: ['phone', '_dupHistory'], sortColumn: 'participantName' });
  const esperada = vista({ columnFilters: { status: ['Nuevo'], _dupRisk: [ELEG_SIN_ICONO], _dupBoard: ['Sí'] }, hiddenColumns: ['phone', '_dupHistory'], sortColumn: 'participantName' });
  assert.equal(migrarFiltroElegibilidad(guardada), esperada);
});
await prueba('una vista que solo muestra u oculta la columna (casi todas) o que no la menciona no se toca: sale el mismo texto, sin volver a escribirlo', () => {
  const ocultando = vista({ hiddenColumns: ['_dupRisk', 'phone'] });
  assert.equal(migrarFiltroElegibilidad(ocultando), ocultando);
  const sinMencionar = vista({ columnFilters: { status: ['Nuevo'] } });
  assert.equal(migrarFiltroElegibilidad(sinMencionar), sinMencionar);
  // Una vista que ya usa las opciones nuevas tampoco.
  const nueva = vista({ columnFilters: { _dupRisk: [ELEG_TRIANGULO, ELEG_SIN_ICONO] } });
  assert.equal(migrarFiltroElegibilidad(nueva), nueva);
});
await prueba('traducir dos veces da lo mismo que una, y un texto que no es una vista válida se deja como está', () => {
  const unaVez = migrarFiltroElegibilidad(vista({ columnFilters: { _dupRisk: ['Sí', 'No'] } }));
  assert.equal(migrarFiltroElegibilidad(unaVez), unaVez);
  assert.deepEqual(JSON.parse(unaVez).columnFilters._dupRisk, [ELEG_TRIANGULO, ELEG_CALENDARIO, ELEG_SIN_ICONO]);
  for (const raro of ['', 'no es json _dupRisk', 'null', '"_dupRisk"', '[1,2] _dupRisk', '{"columnFilters":{"_dupRisk":"No"}}']) assert.equal(migrarFiltroElegibilidad(raro), raro);
  // Una vista sin filtro guardado (vacío en la base): no truena, igual que no tronaba antes de esta función.
  assert.equal(migrarFiltroElegibilidad(undefined as unknown as string), undefined);
  assert.equal(migrarFiltroElegibilidad(null as unknown as string), null);
});
await prueba('las reglas del filtro avanzado escritas con Sí/No se traducen con el mismo significado (las cuatro operaciones), y las de otras columnas no se tocan', () => {
  const casos: Array<[Partial<FilterRule>, string]> = [
    [{ operator: 'es', value: 'No' }, 'No'],
    [{ operator: 'no_es', value: 'No' }, 'Sí'],
    [{ operator: 'es', value: 'Sí' }, 'Sí'],
    [{ operator: 'no_es', value: 'Sí' }, 'No'],
    [{ operator: 'es_alguno', value: '', selectedValues: ['Sí'] }, 'Sí'],
    [{ operator: 'es_alguno', value: '', selectedValues: ['No'] }, 'No'],
    [{ operator: 'no_es_ninguno', value: '', selectedValues: ['Sí'] }, 'No'],
    [{ operator: 'no_es_ninguno', value: '', selectedValues: ['No'] }, 'Sí'],
  ];
  for (const [r, mostrabaAntes] of casos) {
    const guardada = vista({ filterRules: [regla(r as any)] });
    const ahora = quienes(conFiltros(filas, columnas, (api) => api.applyViewFilters(migrarFiltroElegibilidad(guardada)))).filter((x) => consistentes.includes(x));
    igualSinOrden(ahora, consistentes.filter((x) => antes(x) === mostrabaAntes));
  }
  // Menciona la columna (la tiene oculta) y trae una regla con «Sí», pero esa regla es de «Este filtro»: no se toca. Una regla vacía (null) tampoco rompe nada.
  const deOtraColumna = vista({ filterRules: [{ id: 'x', column: '_dupBoard', operator: 'es', value: 'Sí' }, null], hiddenColumns: ['_dupRisk'] });
  assert.equal(migrarFiltroElegibilidad(deOtraColumna), deOtraColumna);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
