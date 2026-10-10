// Pruebas del calendario de pagos (src/lib/payments/calendario.ts y las fechas que usa): en qué día cae cada pago,
// semanas de lunes a viernes, calor de cada día, vencidos fuera de vista, agrupación por proveedor y dónde abre.
// Todos los datos son inventados, con la forma de un mes real: 53 pagos por pagar repartidos en 13 días de octubre de 2026,
// en pesos y dólares. Los totales esperados se calcularon aparte, sumando en centavos.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-calendario.ts
import assert from 'node:assert/strict';
import {
  diaDeLaSemana, diasDelMes, fmtFechaLarga, lunesDe, mesesEntre, nombreDia, nombreDiaCorto, nombreMesCorto, sumaMeses,
} from '../../src/lib/payments/fechas';
import {
  agrupaPorProveedor, calor, columnasDelMes, construyeMes, construyeSemana, diaCercano, diaDelPanel, diaPorDefecto, estadoVisual,
  indexaPorDia, mesInicial, mezclaConBlanco, PORCENTAJE_CALOR, sentidoDe, textoResumen, tituloSemana, vencidosPrevios,
} from '../../src/lib/payments/calendario';
import { fmtTotales, nombreLegible, nombreProveedor, plural } from '../../src/lib/payments/formato';
import { totalesPorMoneda } from '../../src/lib/payments/urgencia';
import type { PagoBase } from '../../src/lib/payments/types';

const HOY = '2026-10-09'; // viernes
const sinNbsp = (s: string) => s.replace(/\u00a0/g, ' '); // Intl separa «USD» de la cifra con un espacio no separable
const tot = (t: Parameters<typeof fmtTotales>[0]) => sinNbsp(fmtTotales(t));
const resumen = (...a: Parameters<typeof textoResumen>) => sinNbsp(textoResumen(...a));
const CTX = { pestana: 'porPagar' as const, hoy: HOY };

let n = 0;
let fallas = 0;
function prueba(nombre: string, fn: () => void) {
  n++;
  try {
    fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`);
  }
}

// Los 53 pagos por pagar de octubre: por día, [monto] en pesos o [monto, 'USD'].
const OCTUBRE: Record<string, Array<[number] | [number, 'USD']>> = {
  '2026-10-05': [[1000]],
  '2026-10-06': [[2000], [500.5]],
  '2026-10-08': [[1500], [750.25]],
  '2026-10-09': [[9800], [7600], [6400], [5200], [4800.75], [4100], [3900.4], [3500], [3100], [2700], [2200], [1800], [1400], [1100], [900]],
  '2026-10-12': [[4300], [2600.8], [1900]],
  '2026-10-14': [[3200, 'USD']],
  '2026-10-15': [[6100], [450, 'USD']],
  '2026-10-19': [[8700]],
  '2026-10-21': [[12000], [7000], [4000], [4000], [2500.3]],
  '2026-10-23': [[6900], [5400.1], [1200], [950, 'USD']],
  '2026-10-26': [[5000], [4700], [3300.6], [2100], [1500], [800]],
  '2026-10-28': [[11000], [4900], [4200], [2900], [2400], [1300], [700.9]],
  '2026-10-30': [[10500], [1800], [1600], [1100.2]],
};

let secuencia = 0;
const pago = (extra: Partial<PagoBase> = {}): PagoBase => {
  secuencia++;
  return { id: `p${secuencia}`, paymentId: secuencia, status: 'Programado', currency: 'MXN', poNumber: `RI-${String(3000 + secuencia).padStart(5, '0')}`, ...extra };
};
const pagosOctubre = (): PagoBase[] =>
  Object.entries(OCTUBRE).flatMap(([f, lista]) => lista.map(([monto, moneda]) => pago({ dueDate: f, amount: monto, currency: moneda ?? 'MXN' })));

// Siete vencidos de antes de octubre, todos en dólares: USD 12,000, el más viejo del 26 de junio.
const VIEJOS: Array<[string, number]> = [
  ['2026-06-26', 2400], ['2026-07-10', 2100], ['2026-07-30', 1900], ['2026-08-14', 1700], ['2026-08-28', 1500], ['2026-09-11', 1300], ['2026-09-25', 1100],
];
const pagosViejos = (): PagoBase[] => VIEJOS.map(([f, monto]) => pago({ dueDate: f, amount: monto, currency: 'USD' }));

// ── fechas ───────────────────────────────────────────────────────────────────
prueba('día de la semana, nombre y lunes de cada semana', () => {
  assert.equal(diaDeLaSemana('2026-10-09'), 5);
  assert.equal(diaDeLaSemana('2026-10-11'), 0);
  assert.equal(nombreDia('2026-10-09'), 'viernes');
  assert.equal(nombreDiaCorto('2026-10-12'), 'lun');
  assert.equal(lunesDe('2026-10-09'), '2026-10-05');
  assert.equal(lunesDe('2026-10-05'), '2026-10-05');
  assert.equal(lunesDe('2026-10-11'), '2026-10-05'); // el domingo es el último día de su semana
  assert.equal(lunesDe('2026-10-01'), '2026-09-28');
  assert.equal(lunesDe('2027-01-01'), '2026-12-28');
});
prueba('sumar meses cruza el año; meses entre dos meses', () => {
  assert.equal(sumaMeses('2026-10', 1), '2026-11');
  assert.equal(sumaMeses('2026-12', 1), '2027-01');
  assert.equal(sumaMeses('2026-01', -1), '2025-12');
  assert.equal(sumaMeses('2026-10', 14), '2027-12');
  assert.equal(mesesEntre('2026-10', '2026-09'), -1);
  assert.equal(mesesEntre('2026-10', '2027-01'), 3);
});
prueba('días del mes, también en bisiesto', () => {
  assert.equal(diasDelMes('2026-10'), 31);
  assert.equal(diasDelMes('2026-02'), 28);
  assert.equal(diasDelMes('2028-02'), 29);
  assert.equal(diasDelMes('2026-11'), 30);
});
prueba('fecha larga: sin año si es el año en curso', () => {
  assert.equal(fmtFechaLarga('2026-06-26', HOY), '26 de junio');
  assert.equal(fmtFechaLarga('2025-12-03', HOY), '3 de diciembre de 2025');
  assert.equal(fmtFechaLarga(undefined, HOY), '—');
  assert.equal(nombreMesCorto('2026-10-09'), 'oct');
});

// ── textos y colores ─────────────────────────────────────────────────────────
prueba('plural', () => {
  assert.equal(plural(1, 'pago'), '1 pago');
  assert.equal(plural(0, 'pago'), '0 pagos');
  assert.equal(plural(53, 'pago'), '53 pagos');
});
prueba('calor de un día: 0, 1, 2–3, 4–7 y 8 o más', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 20].map(calor), [0, 1, 2, 2, 3, 3, 4, 4]);
});
prueba('mezcla con blanco: lo mismo que color-mix(in srgb, color X%, white)', () => {
  assert.equal(mezclaConBlanco('#1795D3', 0), '#ffffff');
  assert.equal(mezclaConBlanco('#1795D3', 100), '#1795d3');
  assert.equal(mezclaConBlanco('#1795D3', 52), '#86c8e8');
  assert.equal(mezclaConBlanco('#000000', 50), '#808080');
  assert.deepEqual(Object.values(PORCENTAJE_CALOR), [0, 9, 18, 32, 52]);
});
prueba('estado visual: vencido, hoy, por venir, pagado, cancelado', () => {
  assert.equal(estadoVisual(pago(), '2026-10-08', HOY), 'vencido');
  assert.equal(estadoVisual(pago(), HOY, HOY), 'hoy');
  assert.equal(estadoVisual(pago(), '2026-10-12', HOY), 'porVenir');
  assert.equal(estadoVisual(pago(), null, HOY), 'porVenir');
  assert.equal(estadoVisual(pago({ status: 'Realizado' }), '2026-09-01', HOY), 'pagado');
  assert.equal(estadoVisual(pago({ status: 'Cancelado' }), '2026-09-01', HOY), 'cancelado');
});
prueba('resumen del periodo, en singular y plural según la pestaña', () => {
  const t = totalesPorMoneda(pagosOctubre());
  assert.equal(resumen(53, t, 'porPagar', 'mes'), '53 pagos por pagar · $190,655 + USD 4,600');
  assert.equal(resumen(1, totalesPorMoneda([pago({ amount: 6543.21 })]), 'porPagar', 'mes'), '1 pago por pagar · $6,543');
  assert.equal(resumen(1, t, 'pagados', 'semana'), '1 pago realizado · $190,655 + USD 4,600');
  assert.equal(resumen(2, t, 'pagados', 'mes'), '2 pagos realizados · $190,655 + USD 4,600');
  assert.equal(resumen(2, t, 'cancelados', 'mes'), '2 pagos cancelados · $190,655 + USD 4,600');
  assert.equal(resumen(3, t, 'todos', 'mes'), '3 pagos · $190,655 + USD 4,600');
  assert.equal(resumen(0, {}, 'porPagar', 'mes'), 'Sin pagos este mes');
  assert.equal(resumen(0, {}, 'pagados', 'semana'), 'Sin pagos esta semana');
});

// ── nombres de proveedor ─────────────────────────────────────────────────────
prueba('nombre legible: solo cambia los que vienen todo en mayúsculas', () => {
  assert.equal(nombreLegible('ROSA ELENA VARGAS MONTIEL'), 'Rosa Elena Vargas Montiel');
  assert.equal(nombreLegible('ESTUDIOS Y ASESORIAS EN MERCADOTECNIA DEL BAJIO LIMITADA'), 'Estudios y Asesorias en Mercadotecnia del Bajio Limitada');
  assert.equal(nombreLegible('ACME SERVICIOS S DE RL DE CV'), 'Acme Servicios S de RL de CV');
  assert.equal(nombreLegible('DE LA ROSA'), 'De la Rosa'); // la primera palabra siempre empieza con mayúscula
  assert.equal(nombreLegible('María de los Ángeles Pérez Ruiz'), 'María de los Ángeles Pérez Ruiz');
  assert.equal(nombreLegible('Ana LUISA'), 'Ana LUISA');
  assert.equal(nombreLegible('Casa Estudios Norte'), 'Casa Estudios Norte');
  assert.equal(nombreLegible('—'), '—');
  assert.equal(nombreLegible('123'), '123');
});
prueba('nombre de proveedor en pantalla: sin correo y sin gritar', () => {
  assert.equal(nombreProveedor('ESTUDIOS DEL CENTRO - contacto@ejemplo.test'), 'Estudios del Centro');
  assert.equal(nombreProveedor('Rosa Elena Vargas - rosa@ejemplo.test'), 'Rosa Elena Vargas');
  assert.equal(nombreProveedor(undefined), '—');
});

// ── índice por día ───────────────────────────────────────────────────────────
prueba('índice: cada pago en su día, ordenado por ODC; los que no tienen fecha aparte', () => {
  const sinFecha = pago({ amount: 100 });
  const a = pago({ dueDate: '2026-10-09T00:00:00.000Z', poNumber: 'RI-03110' });
  const b = pago({ dueDate: '2026-10-09', poNumber: 'RI-03099' });
  const c = pago({ dueDate: '2026-10-12' });
  const ix = indexaPorDia([a, sinFecha, c, b], 'porPagar');
  assert.deepEqual(ix.porDia.get('2026-10-09')!.map(p => p.poNumber), ['RI-03099', 'RI-03110']); // 3099 antes que 3110, no por letras
  assert.deepEqual(ix.fechas, ['2026-10-09', '2026-10-12']);
  assert.deepEqual(ix.sinFecha.map(p => p.id), [sinFecha.id]);
});
prueba('índice en «Pagados»: cuenta la fecha del pago real, no la comprometida', () => {
  const p = pago({ status: 'Realizado', dueDate: '2026-09-30', paymentDate: '2026-10-02' });
  const sinPago = pago({ status: 'Realizado', dueDate: '2026-09-30' });
  const ix = indexaPorDia([p, sinPago], 'pagados');
  assert.deepEqual(ix.fechas, ['2026-10-02']);
  assert.deepEqual(ix.sinFecha.map(x => x.id), [sinPago.id]);
  assert.deepEqual(indexaPorDia([p, sinPago], 'todos').fechas, ['2026-09-30']);
});

// ── el mes ───────────────────────────────────────────────────────────────────
prueba('octubre 2026: lunes a viernes, cinco semanas, la primera partida desde el 28 de septiembre', () => {
  const m = construyeMes(indexaPorDia(pagosOctubre(), 'porPagar'), '2026-10', CTX);
  assert.deepEqual(m.columnas, [1, 2, 3, 4, 5]);
  assert.deepEqual(m.semanas.map(s => s.lunes), ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(m.semanas.map(s => s.etiqueta), ['1–2 oct', '5–9 oct', '12–16 oct', '19–23 oct', '26–30 oct']);
  assert.ok(m.semanas.every(s => s.dias.length === 5));
  assert.deepEqual(m.semanas[0].dias.map(d => d.enMes), [false, false, false, true, true]);
  assert.ok(m.semanas.slice(1).every(s => s.dias.every(d => d.enMes)));
});
prueba('octubre 2026: los totales del mes y de cada semana son los esperados', () => {
  const m = construyeMes(indexaPorDia(pagosOctubre(), 'porPagar'), '2026-10', CTX);
  assert.equal(m.n, 53);
  assert.equal(tot(m.totales), '$190,655 + USD 4,600');
  assert.deepEqual(m.semanas.map(s => s.n), [0, 20, 6, 10, 17]);
  assert.deepEqual(m.semanas.map(s => tot(s.totales)), ['$0', '$64,252', '$14,901 + USD 3,650', '$51,700 + USD 950', '$59,802']);
  assert.equal(m.semanas.reduce((suma, s) => suma + s.n, 0), m.n); // las semanas suman el mes
});
prueba('la carga de cada semana es frente a la más cargada', () => {
  const m = construyeMes(indexaPorDia(pagosOctubre(), 'porPagar'), '2026-10', CTX);
  assert.deepEqual(m.semanas.map(s => s.carga), [0, 1, 0.3, 0.5, 0.85]);
});
prueba('calor de cada día de octubre', () => {
  const m = construyeMes(indexaPorDia(pagosOctubre(), 'porPagar'), '2026-10', CTX);
  const calores = Object.fromEntries(m.semanas.flatMap(s => s.dias).filter(d => d.pagos.length).map(d => [d.fecha.slice(8), d.calor]));
  assert.deepEqual(calores, { '05': 1, '06': 2, '08': 2, '09': 4, '12': 2, '14': 1, '15': 2, '19': 1, '21': 3, '23': 3, '26': 3, '28': 3, '30': 3 });
});
prueba('el día de hoy, y los vencidos de cada día', () => {
  const m = construyeMes(indexaPorDia(pagosOctubre(), 'porPagar'), '2026-10', CTX);
  const dias = m.semanas.flatMap(s => s.dias);
  assert.deepEqual(dias.filter(d => d.esHoy).map(d => d.fecha), [HOY]);
  const vencidos = Object.fromEntries(dias.filter(d => d.vencidos).map(d => [d.fecha.slice(8), d.vencidos]));
  assert.deepEqual(vencidos, { '05': 1, '06': 2, '08': 2 }); // hoy y lo que viene no está vencido
});
prueba('en un mes con pagos en sábado o domingo aparecen esas columnas', () => {
  const ix = (extra: PagoBase[]) => indexaPorDia([...pagosOctubre(), ...extra], 'porPagar');
  assert.deepEqual(columnasDelMes(ix([]), '2026-10'), [1, 2, 3, 4, 5]);
  assert.deepEqual(columnasDelMes(ix([pago({ dueDate: '2026-10-31' })]), '2026-10'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(columnasDelMes(ix([pago({ dueDate: '2026-10-25' })]), '2026-10'), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual(columnasDelMes(ix([pago({ dueDate: '2026-10-25' }), pago({ dueDate: '2026-10-10' })]), '2026-10'), [1, 2, 3, 4, 5, 6, 0]);
  // un sábado de otro mes no cuenta para octubre
  assert.deepEqual(columnasDelMes(ix([pago({ dueDate: '2026-11-07' })]), '2026-10'), [1, 2, 3, 4, 5]);
  const m = construyeMes(ix([pago({ dueDate: '2026-10-31' })]), '2026-10', CTX);
  assert.equal(m.n, 54); // ningún pago se queda sin día
  assert.deepEqual(m.semanas[4].dias.map(d => d.fecha), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
});
prueba('un mes que empieza en sábado no pinta una semana vacía', () => {
  // agosto 2026 empieza en sábado: la semana del 27 de julio no tiene ningún día de agosto de lunes a viernes
  const sin = construyeMes(indexaPorDia([], 'porPagar'), '2026-08', CTX);
  assert.deepEqual(sin.semanas.map(s => s.lunes), ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);
  assert.equal(sin.semanas[4].etiqueta, '31 ago');
  // con un pago ese sábado, la semana aparece con su columna
  const con = construyeMes(indexaPorDia([pago({ dueDate: '2026-08-01', amount: 500 })], 'porPagar'), '2026-08', CTX);
  assert.equal(con.semanas[0].lunes, '2026-07-27');
  assert.equal(con.semanas[0].etiqueta, '1 ago');
  assert.equal(con.n, 1);
});
prueba('un mes sin pagos: todo en cero, sin tronar', () => {
  const m = construyeMes(indexaPorDia([], 'porPagar'), '2026-12', CTX);
  assert.equal(m.n, 0);
  assert.equal(tot(m.totales), '$0');
  assert.ok(m.semanas.every(s => s.n === 0 && s.carga === 0));
});

// ── la semana ────────────────────────────────────────────────────────────────
prueba('semana: lunes a viernes aunque cruce de mes, con los pagos de cada día', () => {
  const ix = indexaPorDia([...pagosOctubre(), ...pagosViejos(), pago({ dueDate: '2026-09-29', amount: 100 })], 'porPagar');
  const s = construyeSemana(ix, '2026-10-05', CTX);
  assert.deepEqual(s.dias.map(d => d.fecha), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.equal(s.n, 20);
  assert.equal(tot(s.totales), '$64,252');
  const partida = construyeSemana(ix, '2026-09-28', CTX);
  assert.equal(partida.dias[1].pagos.length, 1); // el 29 de septiembre sí se ve en la vista de semana
  assert.ok(partida.dias.every(d => d.enMes));
});
prueba('semana: sábado o domingo solo si esa semana tiene pagos ahí', () => {
  const ix = indexaPorDia([...pagosOctubre(), pago({ dueDate: '2026-10-11', amount: 10 })], 'porPagar');
  assert.equal(construyeSemana(ix, '2026-10-05', CTX).dias.length, 6);
  assert.equal(construyeSemana(ix, '2026-10-05', CTX).dias[5].fecha, '2026-10-11');
  assert.equal(construyeSemana(ix, '2026-10-12', CTX).dias.length, 5);
  assert.equal(construyeSemana(ix, '2026-10-05', CTX).n, 21);
});

// ── vencidos fuera de vista ──────────────────────────────────────────────────
prueba('vencidos de meses anteriores: los 7 de antes de octubre, USD 12,000, el más viejo del 26 de junio', () => {
  const v = vencidosPrevios([...pagosOctubre(), ...pagosViejos()], '2026-10-01', CTX);
  assert.equal(v.n, 7);
  assert.equal(tot(v.totales), 'USD 12,000');
  assert.equal(v.masViejo, '2026-06-26');
});
prueba('vencidos fuera de vista: al ver un mes futuro cuentan también los de octubre que ya pasaron', () => {
  const todos = [...pagosOctubre(), ...pagosViejos()];
  const v = vencidosPrevios(todos, '2026-11-01', CTX);
  assert.equal(v.n, 12); // los 7 viejos + los del 5, 6 y 8 de octubre; lo de hoy y lo que viene no
  assert.equal(tot(v.totales), '$5,751 + USD 12,000');
});
prueba('vencidos fuera de vista: al ver un mes pasado solo cuentan los anteriores a ese mes', () => {
  const v = vencidosPrevios([...pagosOctubre(), ...pagosViejos()], '2026-09-01', CTX);
  assert.equal(v.n, 5);
  assert.equal(tot(v.totales), 'USD 9,600');
});
prueba('vencidos fuera de vista: en la vista de semana el corte es el lunes', () => {
  const v = vencidosPrevios([...pagosOctubre(), ...pagosViejos()], '2026-10-05', CTX);
  assert.equal(v.n, 7);
  assert.equal(vencidosPrevios([...pagosOctubre(), ...pagosViejos()], '2026-10-12', CTX).n, 12);
});
prueba('vencidos fuera de vista: un pago ya realizado o cancelado no es vencido', () => {
  const l = [pago({ dueDate: '2026-08-01', status: 'Realizado' }), pago({ dueDate: '2026-08-02', status: 'Cancelado' }), pago({ dueDate: '2026-08-03' })];
  assert.equal(vencidosPrevios(l, '2026-10-01', { pestana: 'todos', hoy: HOY }).n, 1);
  assert.equal(vencidosPrevios(l, '2026-10-01', { pestana: 'pagados', hoy: HOY }).n, 0);
});

// ── el día: por proveedor ────────────────────────────────────────────────────
prueba('por proveedor: del que más recibe al que menos; dólares después de pesos; empates por nombre', () => {
  const dia = [
    pago({ supplierName: 'Beta', amount: 6000, poNumber: 'RI-03702' }),
    pago({ supplierName: 'Alfa', amount: 5000, poNumber: 'RI-03710' }),
    pago({ supplierName: 'Alfa', amount: 1000, poNumber: 'RI-03700' }),
    pago({ supplierName: 'Gamma USD', amount: 6150, currency: 'USD' }),
    pago({ supplierName: 'DELTA', amount: 20000 }),
  ];
  const g = agrupaPorProveedor(dia);
  assert.deepEqual(g.map(x => x.nombre), ['Delta', 'Alfa', 'Beta', 'Gamma USD']);
  assert.deepEqual(g[1].pagos.map(p => p.poNumber), ['RI-03700', 'RI-03710']); // dentro del proveedor, por ODC
  assert.equal(tot(g[1].totales), '$6,000');
  assert.equal(g[3].totales.USD?.total, 6150);
});
prueba('por proveedor: sin nombre, y dos personas con el mismo nombre y distinto correo no se juntan', () => {
  const g = agrupaPorProveedor([
    pago({ supplierName: 'Ana Pérez - ana@uno.test', amount: 10 }),
    pago({ supplierName: 'Ana Pérez - ana@dos.test', amount: 20 }),
    pago({ amount: 5 }),
  ]);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map(x => x.nombre), ['Ana Pérez', 'Ana Pérez', 'Sin proveedor']);
  assert.deepEqual(g.map(x => x.clave), ['Ana Pérez - ana@dos.test', 'Ana Pérez - ana@uno.test', '']);
});
prueba('día de octubre con 15 pagos: reparto entre proveedores', () => {
  // las 15 del 9 de octubre, repartidas entre 7 proveedores
  const proveedores = ['A', 'B', 'B', 'C', 'A', 'D', 'E', 'F', 'D', 'G', 'F', 'A', 'C', 'G', 'F'];
  const dia = OCTUBRE['2026-10-09'].map(([monto], i) => pago({ dueDate: '2026-10-09', amount: monto, supplierName: `Proveedor ${proveedores[i]}` }));
  const g = agrupaPorProveedor(dia);
  assert.equal(g.length, 7);
  assert.equal(g.reduce((s, x) => s + x.pagos.length, 0), 15);
  assert.equal(tot(totalesPorMoneda(dia)), '$58,501');
  // de mayor a menor total
  for (let i = 1; i < g.length; i++) assert.ok((g[i - 1].totales.MXN?.total ?? 0) >= (g[i].totales.MXN?.total ?? 0));
});

// ── dónde abre ───────────────────────────────────────────────────────────────
prueba('el día con pagos más cercano, hacia adelante o hacia atrás, sin contar el mismo día', () => {
  const ix = indexaPorDia(pagosOctubre(), 'porPagar');
  assert.equal(diaCercano(ix, '2026-10-09', 'adelante')!.fecha, '2026-10-12');
  assert.equal(diaCercano(ix, '2026-10-10', 'adelante')!.fecha, '2026-10-12');
  assert.equal(diaCercano(ix, '2026-10-01', 'adelante')!.fecha, '2026-10-05');
  assert.equal(diaCercano(ix, '2026-10-30', 'adelante'), null);
  assert.equal(diaCercano(ix, '2026-10-12', 'atras')!.fecha, '2026-10-09');
  assert.equal(diaCercano(ix, '2026-10-05', 'atras'), null);
  const c = diaCercano(ix, '2026-10-12', 'atras')!;
  assert.equal(c.n, 15);
  assert.equal(tot(c.totales), '$58,501');
});
prueba('el sentido depende de la pestaña: pagados mira hacia atrás, las demás hacia adelante', () => {
  assert.equal(sentidoDe('pagados'), 'atras');
  assert.deepEqual((['porPagar', 'cancelados', 'todos'] as const).map(sentidoDe), ['adelante', 'adelante', 'adelante']);
});
prueba('título de la semana, también cuando cruza de mes', () => {
  const ix = indexaPorDia([], 'porPagar');
  assert.equal(tituloSemana(construyeSemana(ix, '2026-10-05', CTX).dias), 'Semana del 5 al 9 de octubre');
  assert.equal(tituloSemana(construyeSemana(ix, '2026-09-28', CTX).dias), 'Semana del 28 de septiembre al 2 de octubre');
  assert.equal(tituloSemana(construyeSemana(indexaPorDia([pago({ dueDate: '2026-10-11' })], 'porPagar'), '2026-10-05', CTX).dias), 'Semana del 5 al 11 de octubre');
});
prueba('mes inicial: el de hoy si tiene pagos; si no, el más cercano (empate: el futuro)', () => {
  const en = (...fechas: string[]) => indexaPorDia(fechas.map(f => pago({ dueDate: f })), 'porPagar');
  assert.equal(mesInicial(en('2026-10-20', '2026-03-01'), HOY), '2026-10');
  assert.equal(mesInicial(en('2026-09-10', '2026-12-10'), HOY), '2026-09'); // septiembre está a 1, diciembre a 2
  assert.equal(mesInicial(en('2026-09-10', '2026-11-10'), HOY), '2026-11'); // empate: el futuro
  assert.equal(mesInicial(en('2026-08-10', '2026-06-10'), HOY), '2026-08'); // todo pasado, p. ej. «Pagados»
  assert.equal(mesInicial(en(), HOY), '2026-10');
});
prueba('día por defecto: hoy si tiene pagos; en otro mes, el primero con pagos; sin pagos, nada', () => {
  const ix = indexaPorDia([...pagosOctubre(), pago({ dueDate: '2026-11-03' })], 'porPagar');
  const oct = construyeMes(ix, '2026-10', CTX);
  assert.equal(diaPorDefecto(oct, HOY, 'adelante'), '2026-10-09');
  assert.equal(diaPorDefecto(oct, HOY, 'atras'), '2026-10-09');
  assert.equal(diaPorDefecto(construyeMes(ix, '2026-11', CTX), HOY, 'adelante'), '2026-11-03');
  assert.equal(diaPorDefecto(construyeMes(ix, '2027-02', CTX), HOY, 'adelante'), null);
});
prueba('día por defecto: si hoy no tiene pagos, el día con pagos más cercano en el sentido de la pestaña', () => {
  // hoy (viernes 9) vacío; pagos el miércoles 7 y el martes 13
  const ix = indexaPorDia([pago({ dueDate: '2026-10-07' }), pago({ dueDate: '2026-10-13' })], 'porPagar');
  const oct = construyeMes(ix, '2026-10', CTX);
  assert.equal(diaPorDefecto(oct, HOY, 'adelante'), '2026-10-13'); // lo que viene
  assert.equal(diaPorDefecto(oct, HOY, 'atras'), '2026-10-07'); // lo último que pasó
  // si de un lado no hay nada, se va al otro
  const soloAntes = construyeMes(indexaPorDia([pago({ dueDate: '2026-10-07' })], 'porPagar'), '2026-10', CTX);
  assert.equal(diaPorDefecto(soloAntes, HOY, 'adelante'), '2026-10-07');
  const soloDespues = construyeMes(indexaPorDia([pago({ dueDate: '2026-10-13' })], 'porPagar'), '2026-10', CTX);
  assert.equal(diaPorDefecto(soloDespues, HOY, 'atras'), '2026-10-13');
});
prueba('día por defecto: hoy en fin de semana oculto, o a fin de mes, cae en el día con pagos más cercano', () => {
  const oct = construyeMes(indexaPorDia(pagosOctubre(), 'porPagar'), '2026-10', CTX);
  assert.equal(diaPorDefecto(oct, '2026-10-10', 'adelante'), '2026-10-12'); // sábado oculto → lunes
  assert.equal(diaPorDefecto(oct, '2026-10-10', 'atras'), '2026-10-09'); // sábado oculto → viernes
  assert.equal(diaPorDefecto(oct, '2026-10-31', 'adelante'), '2026-10-30'); // ya no hay nada después: el último
});
prueba('día por defecto: un mes sin ningún pago abre en hoy, vacío', () => {
  const oct = construyeMes(indexaPorDia([], 'porPagar'), '2026-10', CTX);
  assert.equal(diaPorDefecto(oct, HOY, 'adelante'), HOY);
  assert.equal(diaDelPanel(oct, null, HOY, 'adelante')!.pagos.length, 0);
  assert.equal(diaPorDefecto(oct, '2026-10-10', 'adelante'), '2026-10-12'); // sábado oculto: el siguiente día a la vista
});
prueba('día del panel: el elegido si sigue a la vista; si no, el de siempre', () => {
  const ix = indexaPorDia([...pagosOctubre(), pago({ dueDate: '2026-11-03' })], 'porPagar');
  const oct = construyeMes(ix, '2026-10', CTX);
  assert.equal(diaDelPanel(oct, '2026-10-12', HOY, 'adelante')!.fecha, '2026-10-12');
  assert.equal(diaDelPanel(oct, '2026-11-03', HOY, 'adelante')!.fecha, '2026-10-09'); // es de otro mes
  assert.equal(diaDelPanel(oct, '2026-10-10', HOY, 'adelante')!.fecha, '2026-10-09'); // sábado, columna oculta
  assert.equal(diaDelPanel(oct, '2026-09-29', HOY, 'adelante')!.fecha, '2026-10-09'); // día apagado de la semana partida
  const vacio = construyeMes(ix, '2027-02', CTX);
  assert.equal(diaDelPanel(vacio, null, HOY, 'adelante'), null); // mes sin pagos y sin día elegido: nada que mostrar
  assert.equal(diaDelPanel(vacio, '2027-02-03', HOY, 'adelante')!.pagos.length, 0); // un día elegido a propósito se muestra aunque esté vacío
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
