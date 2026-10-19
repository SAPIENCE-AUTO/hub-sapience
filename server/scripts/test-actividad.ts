// Pruebas de la Actividad de uso del Hub (panel de Configuración, solo Sergio): las reglas del latido (src/lib/activityBeat.ts) con un reloj falso y
// varias ventanas, y los dos endpoints (trackActivity y getUserActivity) contra una base en memoria (PGlite) con el esquema real. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-actividad.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import {
  BEAT_MS, IDLE_MS, MAX_COBRO_S, MIN_COBRO_S, crearRastreadorDeUso, estaUsandoElHub, reiniciaElReloj, segundosACobrar,
} from '../../src/lib/activityBeat';
import trackActivity from '../../src/api/trackActivity';
import getUserActivity from '../../src/api/getUserActivity';

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

// ── el latido: reglas puras ──────────────────────────────────────────────────
const S = 1000;
const estado = (ahora: number, ultimoLatido: number, ultimaInteraccion: number, visible = true) => ({ ahora, ultimoLatido, ultimaInteraccion, visible });

await prueba('estaUsandoElHub: pestaña a la vista y algo tocado en los últimos 2 minutos; lo demás no es uso', () => {
  assert.equal(estaUsandoElHub({ ahora: 100 * S, ultimaInteraccion: 100 * S, visible: true }), true);
  assert.equal(estaUsandoElHub({ ahora: 100 * S + IDLE_MS, ultimaInteraccion: 100 * S, visible: true }), true); // justo en el límite
  assert.equal(estaUsandoElHub({ ahora: 100 * S + IDLE_MS + 1, ultimaInteraccion: 100 * S, visible: true }), false);
  assert.equal(estaUsandoElHub({ ahora: 100 * S, ultimaInteraccion: 100 * S, visible: false }), false);
});
await prueba('segundosACobrar: lo corrido desde el último latido (tope y mínimo); un hueco largo no se cobra y avisa con 0; sin uso, nada', () => {
  assert.equal(segundosACobrar(estado(60 * S, 0, 60 * S)), 60);
  assert.equal(segundosACobrar(estado(37 * S, 0, 37 * S)), 37); // un pedazo de minuto se cobra tal cual
  assert.equal(segundosACobrar(estado(MAX_COBRO_S * S, 0, MAX_COBRO_S * S)), MAX_COBRO_S);
  assert.equal(segundosACobrar(estado((MAX_COBRO_S + 1) * S, 0, (MAX_COBRO_S + 1) * S)), 0); // hueco: se avisa, no se cobra
  assert.equal(segundosACobrar(estado((MIN_COBRO_S - 1) * S, 0, (MIN_COBRO_S - 1) * S)), null); // otra ventana acaba de cobrar
  assert.equal(segundosACobrar(estado(MIN_COBRO_S * S, 0, MIN_COBRO_S * S)), MIN_COBRO_S);
  assert.equal(segundosACobrar(estado(60 * S, 0, 60 * S, false)), null); // pestaña oculta
  assert.equal(segundosACobrar(estado(300 * S, 240 * S, 100 * S)), null); // sin tocar nada hace más de 2 min
  assert.equal(segundosACobrar(estado(60 * S, 90 * S, 60 * S)), null); // reloj hacia atrás: nada
});
await prueba('reiniciaElReloj: solo tras un hueco de más del tope', () => {
  assert.equal(reiniciaElReloj(MAX_COBRO_S * S, 0), false);
  assert.equal(reiniciaElReloj(MAX_COBRO_S * S + 1, 0), true);
});

// Un mundo falso: reloj, el almacenamiento que comparten las ventanas del navegador y las ventanas con lo que mandan al servidor.
class Mundo {
  t = 1_000_000_000;
  reloj: number | null = null;
  conAlmacenamiento = true;
  ventanas: Array<{ r: ReturnType<typeof crearRastreadorDeUso>; enviados: Array<{ t: number; s: number }>; visible: boolean }> = [];
  ventana() {
    const v = { r: undefined as unknown as ReturnType<typeof crearRastreadorDeUso>, enviados: [] as Array<{ t: number; s: number }>, visible: true };
    v.r = crearRastreadorDeUso({
      ahora: () => this.t,
      visible: () => v.visible,
      leerReloj: () => (this.conAlmacenamiento ? this.reloj : null),
      guardarReloj: (t) => { if (this.conAlmacenamiento) this.reloj = t; },
      enviar: (s) => { v.enviados.push({ t: this.t, s }); },
    });
    this.ventanas.push(v);
    return v;
  }
  avanza(segundos: number) { this.t += segundos * S; }
  total() { return this.ventanas.reduce((suma, v) => suma + v.enviados.reduce((a, e) => a + e.s, 0), 0); }
}

await prueba('una ventana usada sin parar: cada minuto suma lo corrido y diez minutos suman diez minutos; al abrir avisa con 0', () => {
  const m = new Mundo();
  const a = m.ventana();
  a.r.abrir();
  assert.deepEqual(a.enviados, [{ t: m.t, s: 0 }]);
  for (let seg = 1; seg <= 600; seg++) { m.avanza(1); if (seg % 5 === 0) a.r.interaccion(); if (seg % 60 === 0) a.r.latido(); }
  assert.equal(m.total(), 600);
  assert.ok(a.enviados.slice(1).every((e) => e.s === 60));
});
await prueba('dos ventanas a la vista, las dos con uso (dos monitores): el tiempo se cuenta una sola vez, no doble', () => {
  const m = new Mundo();
  const a = m.ventana();
  const b = m.ventana();
  a.r.abrir(); b.r.abrir();
  for (let seg = 1; seg <= 600; seg++) {
    m.avanza(1);
    if (seg % 5 === 0) { a.r.interaccion(); b.r.interaccion(); }
    if (seg % 60 === 0) a.r.latido(); // la ventana A late en 0, 60, 120…
    if (seg % 60 === 30) b.r.latido(); // y la B a medio minuto, en otra fase
  }
  assert.equal(m.total(), 600); // exactamente el tiempo real (600 s): ni más ni menos, aunque lo cobren las dos ventanas por turnos
  assert.ok([...a.enviados, ...b.enviados].every((e) => e.s <= 60));
  // Sin el reloj compartido, cada ventana habría cobrado sus propios minutos: el doble.
  const sinCompartir = new Mundo(); sinCompartir.conAlmacenamiento = false;
  const c = sinCompartir.ventana(); const d = sinCompartir.ventana();
  c.r.abrir(); d.r.abrir();
  for (let seg = 1; seg <= 600; seg++) { sinCompartir.avanza(1); if (seg % 5 === 0) { c.r.interaccion(); d.r.interaccion(); } if (seg % 60 === 0) { c.r.latido(); d.r.latido(); } }
  assert.equal(sinCompartir.total(), 1200);
});
await prueba('tras un rato sin tocar nada no se cobra ese rato: al volver avisa con 0 y reinicia el reloj, y el siguiente minuto suma solo el minuto', () => {
  const m = new Mundo();
  const a = m.ventana();
  a.r.abrir();
  for (let seg = 1; seg <= 60; seg++) { m.avanza(1); if (seg === 1) a.r.interaccion(); if (seg % 60 === 0) a.r.latido(); }
  assert.equal(m.total(), 60);
  // 20 minutos con la pestaña a la vista pero sin tocar nada: pasan los latidos y no mandan nada (después de los 2 minutos de gracia).
  for (let seg = 1; seg <= 1200; seg++) { m.avanza(1); if (seg % 60 === 0) a.r.latido(); }
  const antes = m.total();
  assert.ok(antes <= 60 + 120, String(antes)); // a lo más los 2 minutos de gracia desde el último toque
  // Vuelve: avisa de inmediato (0) y reinicia el reloj.
  a.r.interaccion();
  assert.deepEqual(a.enviados.at(-1), { t: m.t, s: 0 });
  assert.equal(m.reloj, m.t);
  for (let seg = 1; seg <= 60; seg++) { m.avanza(1); if (seg % 5 === 0) a.r.interaccion(); if (seg % 60 === 0) a.r.latido(); }
  assert.equal(m.total() - antes, 60); // solo el minuto de ahora, no los 20 de antes
});
await prueba('al salir de la pestaña cobra el pedazo de minuto que llevaba, y al volver avisa (sin sumar tiempo hasta que toque algo)', () => {
  const m = new Mundo();
  const a = m.ventana();
  a.r.abrir();
  for (let seg = 1; seg <= 100; seg++) { m.avanza(1); if (seg % 5 === 0) a.r.interaccion(); if (seg === 60) a.r.latido(); }
  assert.equal(m.total(), 60);
  a.visible = false; a.r.visibilidad(false); // a los 100 s: lleva 40 s desde el último latido
  assert.equal(m.total(), 100);
  for (let seg = 1; seg <= 600; seg++) { m.avanza(1); if (seg % 60 === 0) a.r.latido(); } // oculta: nada
  assert.equal(m.total(), 100);
  a.visible = true; a.r.visibilidad(true); // regresa 10 minutos después: avisa de inmediato, con 0
  assert.deepEqual(a.enviados.at(-1), { t: m.t, s: 0 });
  m.avanza(60); a.r.latido(); // sigue sin tocar nada hace más de 2 minutos: no es uso
  assert.equal(m.total(), 100);
});
await prueba('un hueco largo con uso reciente (se durmió la compu) no se cobra: manda 0 y vuelve a contar desde ahora; sin localStorage también funciona', () => {
  const m = new Mundo(); m.conAlmacenamiento = false;
  const a = m.ventana();
  a.r.abrir();
  a.r.interaccion();
  m.avanza(60); a.r.interaccion(); a.r.latido();
  assert.equal(m.total(), 60);
  // El reloj del sistema da un salto de 5 minutos (suspensión) y justo al despertar la persona toca algo y el latido corre.
  m.avanza(300); a.r.interaccion(); // vuelve tras más de 2 minutos: avisa (0) y reinicia
  const despues = m.total();
  assert.equal(despues, 60);
  m.avanza(60); a.r.interaccion(); a.r.latido();
  assert.equal(m.total() - despues, 60);
});

// ── los endpoints, contra PGlite ─────────────────────────────────────────────
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);
const usuario = async (email: string, nombre: string, apellido: string) =>
  (await pg.query<{ id: string }>(`insert into users (email, first_name, last_name, "role") values ($1, $2, $3, 'Analista') returning id`, [email, nombre, apellido])).rows[0].id;
const ana = await usuario('ana@ejemplo.test', 'Ana', 'Prueba');
const beto = await usuario('beto@ejemplo.test', 'Beto', 'Prueba');
const carla = await usuario('carla@ejemplo.test', 'Carla', 'Prueba');
const yo = { user: { id: 'u0', email: 'sergio@sapience.com.mx' } } as any;
const comoAna = { user: { id: ana, email: 'ana@ejemplo.test' } } as any;
const latido = (usuarioId: string, seccion: string, segundos: number, haceSegundos: number, diasAtras = 0) =>
  pg.query(
    `insert into user_activity (user_id, day, section, seconds, updated_at)
     values ($1, (now() at time zone 'America/Mexico_City')::date - $5::int, $2, $3, now() - ($4 || ' seconds')::interval)`,
    [usuarioId, seccion, segundos, String(haceSegundos), diasAtras],
  );
const filaDe = (r: any, id: string) => r.users.find((u: any) => u.id === id);
const filas = async (id: string) => (await pg.query<any>(`select section, seconds::float8 as seconds from user_activity where user_id = $1 order by section`, [id])).rows;

await prueba('trackActivity: un aviso de 0 s crea la fila sin sumar tiempo; luego suma lo que llegue, con tope de 120 s por latido y sin negativos', async () => {
  await trackActivity.run({ section: 'Chat', seconds: 0 }, comoAna);
  assert.deepEqual(await filas(ana), [{ section: 'Chat', seconds: 0 }]);
  await trackActivity.run({ section: 'Chat', seconds: 37 }, comoAna);
  await trackActivity.run({ section: 'Chat', seconds: 60 }, comoAna);
  assert.deepEqual(await filas(ana), [{ section: 'Chat', seconds: 97 }]);
  await trackActivity.run({ section: 'Chat', seconds: 500 }, comoAna); // tope
  await trackActivity.run({ section: 'Chat', seconds: -30 }, comoAna); // negativo: cuenta 0
  assert.deepEqual(await filas(ana), [{ section: 'Chat', seconds: 217 }]);
  assert.ok((await pg.query<{ t: unknown }>(`select last_active_at as t from users where id = $1`, [ana])).rows[0].t); // también marca la última actividad
  await pg.query(`delete from user_activity`);
});
await prueba('getUserActivity solo se abre a Sergio', async () => {
  await assert.rejects(() => getUserActivity.run({}, comoAna), (e: unknown) => e instanceof ZiteError && e.code === 'FORBIDDEN');
  await assert.rejects(() => getUserActivity.run({}, { user: null } as any), (e: unknown) => e instanceof ZiteError && e.code === 'UNAUTHORIZED');
  assert.ok(await getUserActivity.run({}, yo));
});
await prueba('«en línea» es haber tenido un latido en los últimos 3 minutos; si no, «inactivo» con cuándo fue visto y la sección donde estaba solo si está en línea', async () => {
  await latido(ana, 'Chat', 600, 100); // hace 100 s
  await latido(beto, 'Dashboard', 300, 240); // hace 4 min
  const r: any = await getUserActivity.run({ days: 7 }, yo);
  const a = filaDe(r, ana); const b = filaDe(r, beto); const c = filaDe(r, carla);
  assert.deepEqual([a.online, a.currentSection, b.online, b.currentSection, c.online, c.lastActiveAt], [true, 'Chat', false, undefined, false, undefined]);
  assert.ok(Math.abs(Date.now() - new Date(b.lastActiveAt).getTime() - 240_000) < 5_000, b.lastActiveAt); // visto hace ~4 min
  assert.deepEqual([r.users[0].id, r.users[0].online], [ana, true]); // los que están en línea, primero
});
await prueba('un solo reloj: lo que marque el chat en users.last_active_at no mueve ni «en línea» ni «visto», solo cuentan los latidos de uso', async () => {
  await pg.query(`update users set last_active_at = now() where id = $1`, [beto]); // el chat o una página de proyecto lo acaban de marcar
  const r: any = await getUserActivity.run({ days: 7 }, yo);
  const b = filaDe(r, beto);
  assert.equal(b.online, false);
  assert.ok(Date.now() - new Date(b.lastActiveAt).getTime() > 200_000, 'debía salir la hora del último latido (hace ~4 min), no la del chat');
});
await prueba('el estado no depende del rango que se mira: un latido de hace días sigue siendo el «visto», aunque «Hoy» no traiga tiempo', async () => {
  await latido(carla, 'Cobranza', 900, 5 * 86400 + 60, 5);
  const hoy = filaDe(await getUserActivity.run({ days: 1 }, yo), carla);
  const semana = filaDe(await getUserActivity.run({ days: 7 }, yo), carla);
  assert.deepEqual([hoy.online, hoy.totalSeconds, semana.online, semana.totalSeconds], [false, 0, false, 900]);
  assert.ok(Math.abs(Date.now() - new Date(hoy.lastActiveAt).getTime() - (5 * 86400 + 60) * 1000) < 5_000);
  assert.equal(hoy.lastActiveAt, semana.lastActiveAt);
});
await prueba('un aviso de 0 s marca «en línea» pero no aparece como sección ni suma tiempo', async () => {
  await pg.query(`delete from user_activity where user_id = $1`, [beto]);
  await trackActivity.run({ section: 'Chat', seconds: 0 }, { user: { id: beto, email: 'beto@ejemplo.test' } } as any);
  const b = filaDe(await getUserActivity.run({ days: 7 }, yo), beto);
  assert.deepEqual([b.online, b.currentSection, b.totalSeconds, b.sections], [true, 'Chat', 0, []]);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
