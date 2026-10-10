// Pruebas de la lógica de la pantalla de pagos (src/lib/payments): grupos por urgencia, totales por moneda,
// tarjetas, orden, búsqueda por ODC y formato de montos. Datos inventados con la forma de los reales.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-lista.ts
import assert from 'node:assert/strict';
import { diasEntre, etiquetaMes, fmtFechaCorta, hoyLocalISO, nombreMes, soloFecha, sumaDias } from '../../src/lib/payments/fechas';
import { agrupaPorUrgencia, claveGrupo, resumenTarjetas, textoRelativo, totalesPorMoneda } from '../../src/lib/payments/urgencia';
import { claveOdc, coincideBusqueda, contarPorPestana, filtraPorPestana, opcionesMes, ordenaPagos, ordenPorDefecto } from '../../src/lib/payments/lista';
import { fmtMonto, fmtTotales, nombreSinCorreo } from '../../src/lib/payments/formato';
import { motivoDelError } from '../../src/lib/payments/errores';
import { fechaHoyMx, motivoPagoInvalido } from '../../src/serverUtils/paymentRules';
import type { PagoBase } from '../../src/lib/payments/types';

const HOY = '2026-10-09';
const sinNbsp = (s: string) => s.replace(/ /g, ' ');
const pago = (id: string, extra: Partial<PagoBase> = {}): PagoBase => ({ id, paymentId: id, status: 'Programado', currency: 'MXN', ...extra });

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

// ── fechas ───────────────────────────────────────────────────────────────────
prueba('hoy local: a las 11:59 pm sigue siendo el mismo día (toISOString lo adelantaría en México)', () => {
  assert.equal(hoyLocalISO(new Date(2026, 9, 9, 23, 59)), '2026-10-09');
  assert.equal(hoyLocalISO(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  assert.equal(hoyLocalISO(new Date(2026, 11, 31, 18, 40)), '2026-12-31');
});
prueba('sumar días cruza mes y año, y resta', () => {
  assert.equal(sumaDias('2026-10-09', 7), '2026-10-16');
  assert.equal(sumaDias('2026-12-30', 3), '2027-01-02');
  assert.equal(sumaDias('2026-03-01', -1), '2026-02-28');
});
prueba('días entre fechas: del 26 de junio al 9 de octubre son 105', () => {
  assert.equal(diasEntre('2026-06-26', '2026-10-09'), 105);
  assert.equal(diasEntre('2026-10-09', '2026-10-09'), 0);
  assert.equal(diasEntre('2026-10-09', '2026-10-06'), -3);
});
prueba('soloFecha quita la hora y rechaza lo que no es fecha', () => {
  assert.equal(soloFecha('2026-10-09T00:00:00.000Z'), '2026-10-09');
  assert.equal(soloFecha('2026-10-09'), '2026-10-09');
  assert.equal(soloFecha(undefined), null);
  assert.equal(soloFecha(''), null);
  assert.equal(soloFecha('basura'), null);
});
prueba('fecha corta: sin año si es el año en curso', () => {
  assert.equal(fmtFechaCorta('2026-06-26', HOY), '26 jun');
  assert.equal(fmtFechaCorta('2025-12-03', HOY), '3 dic 2025');
  assert.equal(fmtFechaCorta(undefined, HOY), '—');
});
prueba('nombre y etiqueta de mes', () => {
  assert.equal(nombreMes('2026-10-09'), 'octubre');
  assert.equal(etiquetaMes('2026-09'), 'Septiembre 2026');
});

// ── grupos por urgencia ──────────────────────────────────────────────────────
prueba('los límites de cada grupo: ayer, hoy, mañana, hoy+7, hoy+8, sin fecha', () => {
  assert.equal(claveGrupo('2026-10-08', HOY), 'vencidos');
  assert.equal(claveGrupo('2026-10-09', HOY), 'hoy');
  assert.equal(claveGrupo('2026-10-10', HOY), 'proximos');
  assert.equal(claveGrupo('2026-10-16', HOY), 'proximos');
  assert.equal(claveGrupo('2026-10-17', HOY), 'adelante');
  assert.equal(claveGrupo(undefined, HOY), 'sinFecha');
  assert.equal(claveGrupo('', HOY), 'sinFecha');
});
prueba('una fecha con hora cuenta igual que sin hora', () => {
  assert.equal(claveGrupo('2026-10-09T00:00:00.000Z', HOY), 'hoy');
});
prueba('agrupar: orden de urgencia, sin grupos vacíos y sin traslapes', () => {
  const pagos = [
    pago('1', { dueDate: '2026-11-20' }),
    pago('2', { dueDate: '2026-06-26' }),
    pago('3', { dueDate: '2026-10-09' }),
    pago('4', { dueDate: '2026-10-12' }),
    pago('5'),
    pago('6', { dueDate: '2026-10-05' }),
  ];
  const grupos = agrupaPorUrgencia(pagos, HOY);
  assert.deepEqual(grupos.map(g => g.clave), ['vencidos', 'hoy', 'proximos', 'adelante', 'sinFecha']);
  assert.deepEqual(grupos.map(g => g.pagos.map(p => p.id)), [['2', '6'], ['3'], ['4'], ['1'], ['5']]);
  assert.equal(grupos.reduce((s, g) => s + g.pagos.length, 0), pagos.length);
  assert.deepEqual(agrupaPorUrgencia([pago('1', { dueDate: '2026-10-09' })], HOY).map(g => g.clave), ['hoy']);
  assert.deepEqual(agrupaPorUrgencia([], HOY), []);
});
prueba('agrupar respeta el orden en que vienen los pagos (así el orden elegido vale dentro de cada grupo)', () => {
  const g = agrupaPorUrgencia([pago('9', { dueDate: '2026-10-08' }), pago('2', { dueDate: '2026-10-01' }), pago('5', { dueDate: '2026-10-07' })], HOY);
  assert.deepEqual(g[0].pagos.map(p => p.id), ['9', '2', '5']);
});
prueba('totales por moneda: pesos y dólares separados, sin moneda cuenta como pesos, centavos bien sumados', () => {
  const t = totalesPorMoneda([
    pago('1', { amount: 6543.21 }),
    pago('2', { amount: 2718.18 }),
    pago('3', { amount: 450, currency: 'USD' }),
    pago('4', { amount: 100, currency: undefined }),
    pago('5'),
  ]);
  assert.deepEqual(t.MXN, { n: 4, total: 9361.39 });
  assert.deepEqual(t.USD, { n: 1, total: 450 });
  assert.deepEqual(totalesPorMoneda([]), {});
});
prueba('texto relativo', () => {
  assert.deepEqual(textoRelativo('2026-06-26', HOY), { texto: 'hace 105 días', tono: 'vencido' });
  assert.deepEqual(textoRelativo('2026-10-08', HOY), { texto: 'hace 1 día', tono: 'vencido' });
  assert.deepEqual(textoRelativo('2026-10-09', HOY), { texto: 'hoy', tono: 'hoy' });
  assert.deepEqual(textoRelativo('2026-10-10', HOY), { texto: 'mañana', tono: 'futuro' });
  assert.deepEqual(textoRelativo('2026-10-12', HOY), { texto: 'en 3 días', tono: 'futuro' });
  assert.equal(textoRelativo(undefined, HOY), null);
});
prueba('tarjetas: por pagar, vencido (solo programados) y pagado del mes (por fecha real de pago)', () => {
  const pagos = [
    pago('1', { amount: 100, dueDate: '2026-10-05' }),
    pago('2', { amount: 50, currency: 'USD', dueDate: '2026-06-26' }),
    pago('3', { amount: 300, dueDate: '2026-10-20' }),
    pago('4', { amount: 999, status: 'Realizado', dueDate: '2026-09-01', paymentDate: '2026-10-02' }),
    pago('5', { amount: 777, status: 'Realizado', dueDate: '2026-10-01', paymentDate: '2026-09-30' }),
    pago('6', { amount: 5, status: 'Cancelado', dueDate: '2026-01-01' }),
    pago('7', { amount: 10, status: 'Realizado', currency: 'USD', paymentDate: '2026-10-08' }),
  ];
  const r = resumenTarjetas(pagos, HOY);
  assert.equal(r.porPagar.n, 3);
  assert.deepEqual(r.porPagar.totales, { MXN: { n: 2, total: 400 }, USD: { n: 1, total: 50 } });
  assert.equal(r.vencido.n, 2);
  assert.deepEqual(r.vencido.totales, { MXN: { n: 1, total: 100 }, USD: { n: 1, total: 50 } });
  assert.equal(r.vencidoMasViejo, '2026-06-26');
  assert.equal(r.pagadoMes.n, 2);
  assert.deepEqual(r.pagadoMes.totales, { MXN: { n: 1, total: 999 }, USD: { n: 1, total: 10 } });
  assert.equal(r.nombreMes, 'octubre');
});
prueba('tarjetas sin nada vencido', () => {
  const r = resumenTarjetas([pago('1', { amount: 100, dueDate: '2026-10-20' })], HOY);
  assert.equal(r.vencido.n, 0);
  assert.equal(r.vencidoMasViejo, null);
});

// ── pestañas y orden ─────────────────────────────────────────────────────────
const variados = [
  pago('1'),
  pago('2', { status: 'Realizado' }),
  pago('3', { status: 'Realizado' }),
  pago('4', { status: 'Cancelado' }),
];
prueba('pestañas: filtran por estado y cuentan', () => {
  assert.deepEqual(filtraPorPestana(variados, 'porPagar').map(p => p.id), ['1']);
  assert.deepEqual(filtraPorPestana(variados, 'pagados').map(p => p.id), ['2', '3']);
  assert.deepEqual(filtraPorPestana(variados, 'cancelados').map(p => p.id), ['4']);
  assert.equal(filtraPorPestana(variados, 'todos').length, 4);
  assert.deepEqual(contarPorPestana(variados), { porPagar: 1, pagados: 2, cancelados: 1, todos: 4 });
});
prueba('orden por defecto: por pagar lo más urgente primero; las demás lo más reciente primero', () => {
  assert.deepEqual(ordenPorDefecto('porPagar'), { clave: 'fecha', dir: 'asc' });
  assert.deepEqual(ordenPorDefecto('pagados'), { clave: 'fecha', dir: 'desc' });
  assert.deepEqual(ordenPorDefecto('todos'), { clave: 'fecha', dir: 'desc' });
});
prueba('orden por fecha: los sin fecha van al final en los dos sentidos', () => {
  const l = [pago('1', { dueDate: '2026-10-12' }), pago('2'), pago('3', { dueDate: '2026-06-26' })];
  assert.deepEqual(ordenaPagos(l, { clave: 'fecha', dir: 'asc' }, 'porPagar').map(p => p.id), ['3', '1', '2']);
  assert.deepEqual(ordenaPagos(l, { clave: 'fecha', dir: 'desc' }, 'porPagar').map(p => p.id), ['1', '3', '2']);
});
prueba('orden por fecha en pagados usa la fecha real de pago, no la comprometida', () => {
  const l = [
    pago('1', { status: 'Realizado', dueDate: '2026-04-22', paymentDate: '2026-10-01' }),
    pago('2', { status: 'Realizado', dueDate: '2026-09-01', paymentDate: '2026-05-12' }),
  ];
  assert.deepEqual(ordenaPagos(l, { clave: 'fecha', dir: 'desc' }, 'pagados').map(p => p.id), ['1', '2']);
  assert.deepEqual(ordenaPagos(l, { clave: 'fecha', dir: 'desc' }, 'todos').map(p => p.id), ['2', '1']);
});
prueba('orden por ODC: los números se comparan como números', () => {
  const l = [pago('1', { poNumber: 'RI-09317' }), pago('2', { poNumber: 'RI-09240' }), pago('3'), pago('4', { poNumber: 'LG-09038' })];
  assert.deepEqual(ordenaPagos(l, { clave: 'odc', dir: 'asc' }, 'porPagar').map(p => p.id), ['4', '2', '1', '3']);
  assert.deepEqual(ordenaPagos(l, { clave: 'odc', dir: 'desc' }, 'porPagar').map(p => p.id), ['1', '2', '4', '3']);
});
prueba('orden por monto: pesos con pesos y dólares con dólares', () => {
  const l = [
    pago('1', { amount: 6543.21 }),
    pago('2', { amount: 450, currency: 'USD' }),
    pago('3', { amount: 900 }),
    pago('4', { amount: 18250, currency: 'USD' }),
    pago('5'),
  ];
  assert.deepEqual(ordenaPagos(l, { clave: 'monto', dir: 'asc' }, 'porPagar').map(p => p.id), ['3', '1', '2', '4', '5']);
  assert.deepEqual(ordenaPagos(l, { clave: 'monto', dir: 'desc' }, 'porPagar').map(p => p.id), ['4', '2', '1', '3', '5']);
});
prueba('orden: si empatan, desempata por fecha, ODC y número de pago, y no toca la lista original', () => {
  const l = [
    pago('12', { poNumber: 'RI-09670', dueDate: '2026-10-09' }),
    pago('10', { poNumber: 'RI-09346', dueDate: '2026-10-09' }),
    pago('11', { poNumber: 'RI-09346', dueDate: '2026-10-09' }),
  ];
  const copia = l.map(p => p.id);
  assert.deepEqual(ordenaPagos(l, { clave: 'fecha', dir: 'asc' }, 'porPagar').map(p => p.id), ['10', '11', '12']);
  assert.deepEqual(l.map(p => p.id), copia);
});

// ── búsqueda ─────────────────────────────────────────────────────────────────
prueba('clave de ODC: todas las formas de escribirla dan lo mismo', () => {
  for (const s of ['RI-09240', 'ODC-RI-09240', 'odc ri 09240', 'ri 9240', 'RI9240', 'ri-9240']) assert.equal(claveOdc(s), 'ri9240', s);
  assert.equal(claveOdc('MD-00123'), 'md123');
  assert.equal(claveOdc(undefined), '');
  assert.equal(claveOdc('odc'), '');
});
prueba('buscar por ODC como sale en el concepto del banco', () => {
  const p = pago('216', { poNumber: 'RI-09240', supplierName: 'ESTUDIOS DEL NORTE', projectCode: 'PROYECTO ALFA' });
  assert.ok(coincideBusqueda(p, 'RI 9240'));
  assert.ok(coincideBusqueda(p, 'ODC-RI-09240'));
  assert.ok(coincideBusqueda(p, 'ri-0924'));
  assert.ok(coincideBusqueda(p, '9240'));
  assert.ok(!coincideBusqueda(p, 'RI 9241'));
  assert.ok(!coincideBusqueda(p, 'LG 9240'));
});
prueba('buscar por proveedor sin acentos ni mayúsculas, por proyecto y por número de pago', () => {
  const p = pago('309', { supplierName: 'María de los Ángeles Pérez', projectCode: 'PROYECTO BETA', poNumber: 'RI-09629' });
  assert.ok(coincideBusqueda(p, 'maria de los angeles'));
  assert.ok(coincideBusqueda(p, 'proyecto beta'));
  assert.ok(coincideBusqueda(p, '309'));
  assert.ok(!coincideBusqueda(p, 'gamma'));
  assert.ok(coincideBusqueda(p, ''));
  assert.ok(coincideBusqueda(p, '   '));
});

// ── meses de pagados ─────────────────────────────────────────────────────────
prueba('meses con pagos realizados: del más reciente al más viejo y con su conteo', () => {
  const l = [
    pago('1', { status: 'Realizado', paymentDate: '2026-10-02' }),
    pago('2', { status: 'Realizado', paymentDate: '2026-10-08' }),
    pago('3', { status: 'Realizado', paymentDate: '2026-05-12' }),
    pago('4', { status: 'Realizado', paymentDate: '2026-09-30' }),
    pago('5', { status: 'Programado', paymentDate: '2026-11-01' }),
    pago('6', { status: 'Realizado' }),
  ];
  assert.deepEqual(opcionesMes(l), [
    { valor: '2026-10', etiqueta: 'Octubre 2026', n: 2 },
    { valor: '2026-09', etiqueta: 'Septiembre 2026', n: 1 },
    { valor: '2026-05', etiqueta: 'Mayo 2026', n: 1 },
  ]);
});

// ── formato de montos ────────────────────────────────────────────────────────
prueba('montos: centavos solo si los hay, USD con su prefijo', () => {
  assert.equal(sinNbsp(fmtMonto(6543.21, 'MXN')), '$6,543.21');
  assert.equal(sinNbsp(fmtMonto(900, 'MXN')), '$900');
  assert.equal(sinNbsp(fmtMonto(900)), '$900');
  assert.equal(sinNbsp(fmtMonto(450, 'USD')), 'USD 450');
  assert.equal(sinNbsp(fmtMonto(17700.5, 'USD')), 'USD 17,700.50');
  assert.equal(fmtMonto(undefined, 'MXN'), '—');
  assert.equal(fmtMonto(null), '—');
});
prueba('montos de totales: sin centavos', () => {
  assert.equal(sinNbsp(fmtMonto(446512.37, 'MXN', { centavos: 'nunca' })), '$446,512');
});
prueba('totales de un grupo: pesos y dólares', () => {
  assert.equal(sinNbsp(fmtTotales({ MXN: { n: 5, total: 12345 }, USD: { n: 7, total: 6789 } })), '$12,345 + USD 6,789');
  assert.equal(sinNbsp(fmtTotales({ MXN: { n: 15, total: 54321 } })), '$54,321');
  assert.equal(sinNbsp(fmtTotales({ USD: { n: 1, total: 6628 } })), 'USD 6,628');
  assert.equal(fmtTotales({}), '$0');
});

// ── servidor: fecha de México y pago nuevo ───────────────────────────────────
prueba('hoy en México: a las 7 pm del 9 de octubre (01:00 UTC del 10) sigue siendo el 9', () => {
  assert.equal(fechaHoyMx(new Date('2026-10-10T01:00:00Z')), '2026-10-09');
  assert.equal(fechaHoyMx(new Date('2026-10-10T00:40:00Z')), '2026-10-09');
  assert.equal(fechaHoyMx(new Date('2026-10-10T05:59:00Z')), '2026-10-09');
  assert.equal(fechaHoyMx(new Date('2026-10-10T06:00:00Z')), '2026-10-10');
  assert.equal(fechaHoyMx(new Date('2026-01-01T03:00:00Z')), '2025-12-31');
});
prueba('un pago nuevo a mano necesita ODC y monto mayor a cero', () => {
  assert.equal(motivoPagoInvalido({ poId: 'abc', amount: 100 }), null);
  assert.equal(motivoPagoInvalido({ poId: 'abc', amount: 0.01 }), null);
  assert.equal(motivoPagoInvalido({ amount: 100 }), 'Elige la ODC del pago.');
  assert.equal(motivoPagoInvalido({ poId: '', amount: 100 }), 'Elige la ODC del pago.');
  assert.equal(motivoPagoInvalido({ poId: 'abc' }), 'Escribe un monto mayor a cero.');
  assert.equal(motivoPagoInvalido({ poId: 'abc', amount: 0 }), 'Escribe un monto mayor a cero.');
  assert.equal(motivoPagoInvalido({ poId: 'abc', amount: -5 }), 'Escribe un monto mayor a cero.');
  assert.equal(motivoPagoInvalido({}), 'Elige la ODC del pago.');
});

// ── pantalla: el motivo de un error ──────────────────────────────────────────
prueba('el motivo del servidor llega a la pantalla; «Error interno» y los códigos no', () => {
  assert.equal(motivoDelError(new Error('Elige la ODC del pago.'), 'No se pudo guardar'), 'Elige la ODC del pago.');
  assert.equal(motivoDelError(new Error('Error interno'), 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(motivoDelError(new Error('savePayment falló (500)'), 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(motivoDelError(new Error('  '), 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(motivoDelError('texto suelto', 'No se pudo guardar'), 'No se pudo guardar');
  assert.equal(motivoDelError(undefined, 'No se pudo guardar'), 'No se pudo guardar');
});

prueba('nombre del proveedor sin el correo pegado', () => {
  assert.equal(nombreSinCorreo('Casa Estudios Norte - ana.lopez@ejemplo.test'), 'Casa Estudios Norte');
  assert.equal(nombreSinCorreo('Persona Uno - persona.uno@ejemplo.test'), 'Persona Uno');
  assert.equal(nombreSinCorreo('ESTUDIOS Y ASESORIAS EN MERCADOTECNIA LIMITADA'), 'ESTUDIOS Y ASESORIAS EN MERCADOTECNIA LIMITADA');
  assert.equal(nombreSinCorreo('Ana - Maria Lopez'), 'Ana - Maria Lopez');
  assert.equal(nombreSinCorreo('- a@ejemplo.test'), '- a@ejemplo.test');
  assert.equal(nombreSinCorreo(undefined), '—');
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
