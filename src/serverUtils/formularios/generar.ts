import { pool, ZiteError } from '../../../server/compat';
import type { StreamWriter } from '../../../server/compat/endpoint';
import {
  asentarEstructura, bocetoDeEstructura, compararEstructuras, conservarSinCambio, estructuraDeDefinicion, firmaSeccion, generadorNuevo,
  leerGenerador, ponerSeccion, revisarEstructura, seccionNse,
  type Estructura, type Generador, type SeccionPlan,
} from '../../lib/formularios/generador';
import { aplicarParche, asentarIds, avisosDeLogica, cambiosEnPalabras, columnasQueCambian, conocidosDe, protegerNse, type Conocidos, type Parche } from '../../lib/formularios/ia';
import { reglaNse } from '../../lib/formularios/nse';
import { revisarConLugar } from '../../lib/formularios/revisar';
import { sinNombreCorto } from '../../lib/formularios/tabla';
import { ID_CELULAR, ID_NOMBRE, SECCION_INICIO } from '../../lib/formularios/inicio';
import { leerDefinicion, type Definicion, type Pregunta, type Seccion } from '../../lib/formularios/tipos';
import { conLatido, llamarJSON, MODELOS, type Contenido } from './claude';
import {
  EstructuraZ, RespuestaCambioPreguntaZ, RespuestaCambioSeccionZ, RespuestaLogicaZ, RespuestaNombresZ, RespuestaSeccionZ, sinVacios,
} from './esquemas';
import { contenidoDeInsumos, hayInsumos } from './insumos';
import { descargarImagen, esImagenNuestra, guardarCopiaDeImagen } from './imagenesEnlace';
import { promptCambio, promptEstructura, promptLogica, promptNombres, promptSeccion, type Alcance, type DatosEstudio } from './prompts';
import { conRegistro } from './uso';

// El generador de Filtros del lado del servidor (fase 3): cada paso arma lo que se le pide a la IA,
// valida lo que devuelve con la misma revisión del editor, le pone ids definitivos y guarda en
// `formularios.generador` lo necesario para no perder nada si se cierra la ventana. Lo que se aplica al
// screener lo aplica el editor en el navegador (useEditorFiltro.aplicar), así se puede deshacer.

export interface Filtro {
  id: string;
  titulo: string;
  proyectoId: string | null;
  definicion: Definicion;
  generador?: Generador;
  estudio: DatosEstudio;
}

export async function cargarFiltro(formularioId: string): Promise<Filtro> {
  const { rows: [f] } = await pool.query(
    `select f.id, f.titulo, f.proyecto_id, f.definicion, f.generador, p.project_code, p.full_name, p.client
     from formularios f left join projects p on p.id = f.proyecto_id where f.id = $1`,
    [formularioId],
  );
  if (!f) throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el filtro.' });
  return {
    id: f.id,
    titulo: f.titulo,
    proyectoId: f.proyecto_id,
    definicion: leerDefinicion(f.definicion),
    generador: leerGenerador(f.generador),
    estudio: { titulo: f.titulo, proyecto: [f.project_code, f.full_name].filter(Boolean).join(' · ') || undefined, cliente: f.client || undefined },
  };
}

export async function guardarGenerador(formularioId: string, g: Generador): Promise<void> {
  await pool.query(`update formularios set generador = $2, updated_at = now() where id = $1`, [formularioId, JSON.stringify(g)]);
}

/** Cambia una parte del generador sin pisar lo que otra llamada en paralelo esté guardando (secciones que se escriben a la vez). */
async function guardarEn(formularioId: string, ruta: string[], valor: unknown): Promise<void> {
  await pool.query(
    `update formularios set generador = jsonb_set(coalesce(generador, '{}'::jsonb), $2::text[], $3::jsonb, true) where id = $1`,
    [formularioId, ruta, JSON.stringify(valor)],
  );
}

/** Lo que va al navegador: sin el texto de los archivos (puede ser largo y no se muestra). */
export function generadorParaNavegador(g: Generador | undefined): Generador | undefined {
  if (!g) return undefined;
  return { ...g, insumos: { ...g.insumos, archivos: g.insumos.archivos.map(({ texto: _t, ...a }) => a) } };
}

const contenido = async (g: Generador, texto: string): Promise<Contenido> => [
  ...(hayInsumos(g.insumos) ? await contenidoDeInsumos(g.insumos) : []),
  { type: 'text', text: texto },
];

/** Problemas nuevos: los que tiene `despues` y no tenía `antes`. */
function problemasNuevos(antes: Definicion, despues: Definicion): string[] {
  const ya = new Set(revisarConLugar(antes).map((p) => p.texto));
  return revisarConLugar(despues).map((p) => p.texto).filter((t) => !ya.has(t));
}

/**
 * Las imágenes que la IA puso con un enlace (porque la persona se lo dio en su pedido) se copian al Hub,
 * como si se hubieran subido. Si una no se puede traer, se quita y se dice por qué.
 */
async function copiarImagenesExternas(preguntas: Pregunta[]): Promise<string[]> {
  const avisos: string[] = [];
  const copias = new Map<string, Promise<string | undefined>>();
  const copiar = (url: string) => {
    if (!copias.has(url)) {
      copias.set(url, descargarImagen(url).then(guardarCopiaDeImagen).catch((err: Error) => {
        avisos.push(`No se pudo traer la imagen ${url}: ${err.message}`);
        return undefined;
      }));
    }
    return copias.get(url)!;
  };
  await Promise.all(preguntas.flatMap((p) => [
    ...(p.imagen && !esImagenNuestra(p.imagen) ? [copiar(p.imagen).then((c) => { p.imagen = c; })] : []),
    ...[...(p.opciones ?? []), ...(p.opcionesExtra ?? [])]
      .filter((x) => x.imagen && !esImagenNuestra(x.imagen))
      .map((x) => copiar(x.imagen!).then((c) => { x.imagen = c; })),
  ]));
  return avisos;
}

// ── etapa 1 ──────────────────────────────────────────────────────────────────
export async function proponerEstructura(o: {
  filtro: Filtro; email: string; stream?: StreamWriter;
  pedido?: string;
  /**
   * Ajustar con un comentario: la estructura propuesta que aún no se escribe
   * (`propuesta`) o la de lo ya escrito (`escrito`, con la definición que tiene el editor).
   */
  ajuste?: { sobre: 'propuesta' } | { sobre: 'escrito'; definicion: Definicion };
}): Promise<{ generador: Generador; problemas: string[] }> {
  const g = o.filtro.generador ?? generadorNuevo('filtro');
  // `base`: lo que ya está escrito, contra lo que se decide al aprobar qué se conserva.
  let base = g.base;
  // `sobre`: la estructura que la IA ajusta.
  let sobre: Estructura | undefined;
  if (o.ajuste?.sobre === 'escrito') {
    base = { ...estructuraDeDefinicion(o.ajuste.definicion, g.estructura), supuestos: g.estructura?.supuestos ?? [] };
    sobre = base;
  } else if (o.ajuste?.sobre === 'propuesta') {
    sobre = g.estructura;
    if (!sobre) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Todavía no hay estructura que ajustar.' });
  } else if (g.origen === 'filtro') {
    base = estructuraDeDefinicion(o.filtro.definicion, g.estructura);
    sobre = base;
  } else {
    base = undefined;
  }
  if (!o.ajuste && g.origen !== 'filtro' && !hayInsumos(g.insumos) && !o.pedido?.trim()) {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Agrega notas, un archivo o una reunión antes de pedir la estructura.' });
  }
  if (o.ajuste && !o.pedido?.trim()) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Escribe qué quieres cambiar de la estructura.' });

  const texto = promptEstructura({ origen: g.origen, estudio: o.filtro.estudio, base: sobre, pedido: o.pedido, ajuste: !!o.ajuste });
  const respuesta = await conRegistro(o.email, o.filtro.id, 'estructura', (onGasto) => conLatido(o.stream, o.ajuste ? 'Ajustando la estructura…' : 'Leyendo los insumos y armando la estructura…', async () =>
    llamarJSON({
      signal: o.stream?.signal,
      usuario: await contenido(g, texto), esquema: EstructuraZ, modelo: MODELOS.estructura, esfuerzo: 'high', onGasto, aceptarConProblemas: true,
      revisar: (r) => revisarEstructura(conservarSinCambio(sobre, sinVacios(r) as Estructura)),
    })));
  // Los ids que se conservan son los de lo que ajusta la IA (la propuesta anterior o lo escrito).
  const estructura = asentarEstructura(conservarSinCambio(sobre, sinVacios(respuesta) as Estructura), sobre);
  // Al ajustar, la IA solo dice lo nuevo que decidió: se suma a lo que ya se había decidido.
  if (sobre) estructura.supuestos = [...sobre.supuestos, ...estructura.supuestos.filter((x) => !sobre!.supuestos.includes(x))];
  if (estructura.secciones.some((s) => s.nse) && !reglaNse(estructura.pais)) {
    estructura.supuestos.push(`El Hub todavía no tiene la regla de NSE de ${estructura.pais}: la sección del NSE no se agrega.`);
  }
  const nuevo: Generador = { ...g, estructura, base, etapa: 'estructura', supuestosRevisados: false, logicaLista: false };
  await guardarGenerador(o.filtro.id, nuevo);
  return { generador: nuevo, problemas: revisarEstructura(estructura) };
}

/** Se descarta una propuesta de cambio de estructura: vuelve la de lo escrito y el filtro sigue como estaba. */
export async function descartarPropuesta(filtro: Filtro): Promise<Generador> {
  const g = filtro.generador;
  if (!g) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este filtro no se hizo con el generador.' });
  const nuevo: Generador = { ...g, estructura: g.base ?? g.estructura, etapa: 'listo', logicaLista: true };
  await guardarGenerador(filtro.id, nuevo);
  return nuevo;
}

/**
 * Al aprobar la estructura: las secciones que no cambiaron quedan como ya
 * escritas; las que salen se quitan (lo hace el editor con `prepararParaEscribir`).
 */
export async function aprobarEstructura(filtro: Filtro): Promise<{ generador: Generador; salen: string[] }> {
  const g = filtro.generador;
  if (!g?.estructura) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Primero pide la estructura.' });
  const { secciones, salen } = compararEstructuras(g.base, g.estructura);
  const ids = new Set(g.estructura.secciones.map((s) => s.id));
  const aplicadas: Record<string, string> = {};
  for (const s of g.estructura.secciones) if (secciones[s.id] === 'igual') aplicadas[s.id] = firmaSeccion(s);
  const quedan = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([id]) => ids.has(id)));
  const nuevo: Generador = {
    ...g, etapa: 'preguntas', aplicadas, escritas: quedan(g.escritas), supuestosSecciones: quedan(g.supuestosSecciones), logicaLista: false,
  };
  await guardarGenerador(filtro.id, nuevo);
  return { generador: nuevo, salen };
}

// ── etapa 2 ──────────────────────────────────────────────────────────────────
/**
 * El screener contra el que se escribe una sección: lo que ya está al día
 * tal cual, lo ya escrito que falta poner, y de lo demás un boceto con los
 * ids de la estructura. Así la sección puede usar preguntas de otras que
 * todavía se están escribiendo.
 */
export function contextoParaEscribir(def: Definicion, g: Generador): Definicion {
  const e = g.estructura!;
  const boceto = bocetoDeEstructura(e);
  const secciones = e.secciones.map((s) => {
    const firma = firmaSeccion(s);
    const enDef = def.secciones.find((x) => x.id === s.id);
    if (enDef && g.aplicadas[s.id] === firma) return enDef;
    if (g.escritas[s.id]?.firma === firma) return g.escritas[s.id].seccion;
    if (s.nse) return seccionNse(s, e.pais) ?? enDef ?? boceto.secciones.find((x) => x.id === s.id)!;
    return boceto.secciones.find((x) => x.id === s.id)!;
  });
  return { ...def, secciones };
}

function conocidosDeSeccion(plan: SeccionPlan, anterior?: Seccion): Conocidos {
  const preguntas = new Set(plan.preguntas.map((p) => p.id));
  const opciones = new Map<string, Set<string>>();
  const filas = new Map<string, Set<string>>();
  for (const p of plan.preguntas) {
    opciones.set(p.id, new Set((p.opciones ?? []).map((o) => o.id)));
    filas.set(p.id, new Set((p.filas ?? []).map((f) => f.id)));
  }
  for (const p of anterior?.preguntas ?? []) {
    preguntas.add(p.id);
    const o = opciones.get(p.id) ?? new Set<string>();
    [...(p.opciones ?? []), ...(p.opcionesExtra ?? [])].forEach((x) => o.add(x.id));
    opciones.set(p.id, o);
    const f = filas.get(p.id) ?? new Set<string>();
    (p.filas ?? []).forEach((x) => f.add(x.id));
    filas.set(p.id, f);
  }
  return { secciones: new Set([plan.id]), preguntas, opciones, filas, frentes: new Set() };
}

/** La sección con ids definitivos, puesta en el contexto; y lo que tiene mal armado. */
function revisarSeccion(seccion: Seccion, plan: SeccionPlan, anterior: Seccion | undefined, contexto: Definicion, e: Estructura) {
  const propia: Seccion = { ...seccion, id: plan.id };
  const [conIds] = asentarIds({ secciones: [propia] }, conocidosDeSeccion(plan, anterior), contexto).secciones!;
  // Si al escribirla se le olvidó el nombre corto a una pregunta, se queda el de la estructura.
  const nombres = new Map(plan.preguntas.map((p) => [p.id, p.nombre]));
  const asentada: Seccion = { ...conIds, preguntas: conIds.preguntas.map((p) => (p.nombre?.trim() || !nombres.get(p.id) ? p : { ...p, nombre: nombres.get(p.id) })) };
  const despues = ponerSeccion(contexto, asentada, e);
  const problemas = [
    ...revisarConLugar(despues).filter((p) => p.seccion === plan.id).map((p) => p.texto),
    ...avisosDeLogica(contexto, despues),
  ];
  const escritas = new Map(asentada.preguntas.map((p) => [p.id, p]));
  for (const p of plan.preguntas) {
    const q = escritas.get(p.id);
    if (!q) { problemas.push(`Falta la pregunta «${p.texto}» (${p.id}) de la estructura.`); continue; }
    const ids = new Set([...(q.opciones ?? []), ...(q.opcionesExtra ?? [])].map((o) => o.id));
    for (const o of p.opciones ?? []) if (!ids.has(o.id)) problemas.push(`En «${p.texto}» falta la opción «${o.label}» (${o.id}) de la estructura.`);
  }
  if ((asentada.repetirPor ?? '') !== (plan.repetirPor ?? '')) problemas.push(`La sección tiene que ${plan.repetirPor ? `repetirse por ${plan.repetirPor}` : 'no repetirse'}, como dice la estructura.`);
  return { asentada, problemas };
}

export async function escribirSeccion(o: { filtro: Filtro; email: string; stream?: StreamWriter; seccionId: string; definicion: Definicion }) {
  const g = o.filtro.generador;
  const e = g?.estructura;
  if (!g || !e) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Primero aprueba la estructura.' });
  const plan = e.secciones.find((s) => s.id === o.seccionId);
  if (!plan) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa sección ya no está en la estructura.' });
  if (plan.nse) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La sección del NSE no la escribe la IA.' });
  const firma = firmaSeccion(plan);
  // Si ya estaba escrita (otra estructura), se reescribe respetando lo que sigue igual.
  const anterior = o.definicion.secciones.find((s) => s.id === plan.id);
  const contexto = contextoParaEscribir(o.definicion, g);

  const texto = promptSeccion({ origen: g.origen, estudio: o.filtro.estudio, estructura: e, plan, anterior });
  const r = await conRegistro(o.email, o.filtro.id, 'seccion', (onGasto) => conLatido(o.stream, `Escribiendo «${plan.titulo}»…`, async () =>
    llamarJSON({
      signal: o.stream?.signal,
      usuario: await contenido(g, texto), esquema: RespuestaSeccionZ, modelo: MODELOS.preguntas, esfuerzo: 'medium', onGasto, aceptarConProblemas: true,
      revisar: (x) => revisarSeccion(sinVacios(x.seccion) as Seccion, plan, anterior, contexto, e).problemas,
    })));
  const escrita = sinVacios(r.seccion) as Seccion;
  const sinTraer = await copiarImagenesExternas(escrita.preguntas);
  const supuestos = [...r.supuestos, ...sinTraer];
  const { asentada, problemas } = revisarSeccion(escrita, plan, anterior, contexto, e);
  await guardarEn(o.filtro.id, ['escritas', plan.id], { seccion: asentada, firma });
  await guardarEn(o.filtro.id, ['supuestosSecciones', plan.id], supuestos);
  return { seccion: asentada, firma, supuestos, problemas };
}

// ── lógica final ─────────────────────────────────────────────────────────────
/**
 * Al ajustar un filtro ya escrito, lo que no cambió se queda como estaba:
 * los textos de bienvenida y despedida no se tocan, y una alerta o un frente
 * con la misma condición conserva su texto.
 */
export function conservarLogica(parche: Parche, def: Definicion): Parche {
  const clave = (x: unknown) => JSON.stringify(x ?? null);
  const alertas = parche.alertas?.map((a) => def.alertas?.find((b) => clave(b.si) === clave(a.si) && clave(b.contar) === clave(a.contar)) ?? a);
  const frentes = parche.frentes?.map((f) => {
    const antes = def.frentes?.find((b) => b.id === f.id && clave(b.califica) === clave(f.califica));
    return antes ? { ...antes, nombre: f.nombre, meta: f.meta, grupo: f.grupo } : f;
  });
  const { textos: _t, ...resto } = parche;
  return { ...resto, ...(alertas ? { alertas } : {}), ...(frentes ? { frentes } : {}) };
}

function revisarLogica(r: { frentes: unknown[]; alertas: unknown[]; claves: unknown; textos: unknown }, def: Definicion, e: Estructura, ajuste: boolean) {
  const conocidos: Conocidos = { ...conocidosDe(def), frentes: new Set(e.frentes.map((f) => f.id)) };
  const parche = asentarIds(sinVacios({ frentes: r.frentes, alertas: r.alertas, claves: r.claves }) as Parche, conocidos, def);
  // El nombre (y el celular, si no se quitó) los pide «Antes de empezar» (lo pone el Hub): son los del panel aunque la IA haya elegido otros.
  const inicio = def.secciones.find((s) => s.id === SECCION_INICIO);
  if (inicio) {
    const celular = inicio.preguntas.some((p) => p.id === ID_CELULAR);
    parche.claves = { ...parche.claves, nombre: ID_NOMBRE, ...(celular ? { telefono: ID_CELULAR } : {}) };
  }
  const textos = Object.fromEntries(Object.entries(sinVacios(r.textos) as Record<string, string>).filter(([, v]) => v?.trim()));
  const completo: Parche = ajuste ? conservarLogica(parche, def) : { ...parche, textos };
  const despues = aplicarParche(def, completo);
  const problemas = [
    ...revisarConLugar(despues).filter((p) => !p.seccion && !p.pregunta).map((p) => p.texto),
    ...avisosDeLogica(def, despues),
  ];
  if (!despues.frentes?.length) problemas.push('Falta al menos un perfil: sin perfiles nadie califica.');
  return { parche: completo, problemas };
}

export async function armarLogica(o: { filtro: Filtro; email: string; stream?: StreamWriter; definicion: Definicion }) {
  const g = o.filtro.generador;
  const e = g?.estructura;
  if (!g || !e) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Primero aprueba la estructura.' });
  const def = o.definicion;
  // Había algo escrito antes de esta estructura (se ajustó o se partió de un filtro anterior).
  const ajuste = !!g.base;
  const texto = promptLogica({ estudio: o.filtro.estudio, estructura: e, definicion: def, ajuste });
  // La lógica final no necesita los insumos: trabaja sobre lo ya escrito y la estructura aprobada.
  const r = await conRegistro(o.email, o.filtro.id, 'logica', (onGasto) => conLatido(o.stream, 'Armando quién entra a cada perfil…', () =>
    llamarJSON({
      signal: o.stream?.signal,
      usuario: [{ type: 'text', text: texto }], esquema: RespuestaLogicaZ, modelo: MODELOS.preguntas, esfuerzo: 'high', onGasto, aceptarConProblemas: true,
      revisar: (x) => revisarLogica(x, def, e, ajuste).problemas,
    })));
  const { parche, problemas } = revisarLogica(r, def, e, ajuste);
  await guardarEn(o.filtro.id, ['supuestosLogica'], r.supuestos);
  await guardarEn(o.filtro.id, ['logicaLista'], true);
  await guardarEn(o.filtro.id, ['etapa'], 'listo');
  return { parche, supuestos: r.supuestos, problemas };
}

// ── cambios pedidos con palabras ─────────────────────────────────────────────
function revisarCambio(parcheIA: Parche, def: Definicion, alcance: Alcance) {
  const conocidos = 'pregunta' in alcance ? conocidosDe(def, [alcance.pregunta]) : conocidosDe(def);
  const parche = protegerNse(asentarIds(parcheIA, conocidos, def), def);
  const despues = aplicarParche(def, parche);
  const problemas = [
    ...problemasNuevos(def, despues),
    ...columnasQueCambian(def, despues),
  ];
  return { parche, despues, problemas };
}

export async function proponerCambio(o: { filtro: Filtro; email: string; stream?: StreamWriter; definicion: Definicion; alcance: Alcance; pedido: string }) {
  const def = o.definicion;
  const { alcance } = o;
  if ('pregunta' in alcance && !def.secciones.some((s) => s.preguntas.some((p) => p.id === alcance.pregunta))) {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa pregunta ya no está en el filtro.' });
  }
  if ('seccion' in alcance && !def.secciones.some((s) => s.id === alcance.seccion)) {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa sección ya no está en el filtro.' });
  }
  const texto = promptCambio({ definicion: def, alcance, pedido: o.pedido, perfil: o.filtro.generador?.estructura?.perfil });
  const usuario: Contenido = [{ type: 'text', text: texto }];
  let parcheIA: Parche;
  let explicacion: string;
  if ('pregunta' in alcance) {
    const r = await conRegistro(o.email, o.filtro.id, 'pregunta', (onGasto) => conLatido(o.stream, 'La IA está preparando el cambio…', () =>
      llamarJSON({
        signal: o.stream?.signal,
        usuario, esquema: RespuestaCambioPreguntaZ, modelo: MODELOS.cambios, esfuerzo: 'medium', onGasto, aceptarConProblemas: true,
        revisar: (x) => revisarCambio({ preguntas: [{ ...sinVacios(x.pregunta), id: alcance.pregunta }] } as Parche, def, alcance).problemas,
      })));
    parcheIA = { preguntas: [{ ...sinVacios(r.pregunta), id: alcance.pregunta }] } as Parche;
    explicacion = r.explicacion;
  } else {
    const r = await conRegistro(o.email, o.filtro.id, 'comentario', (onGasto) => conLatido(o.stream, 'La IA está revisando la lógica…', () =>
      llamarJSON({
        signal: o.stream?.signal,
        usuario, esquema: RespuestaCambioSeccionZ, modelo: MODELOS.preguntas, esfuerzo: 'medium', onGasto, aceptarConProblemas: true,
        revisar: (x) => revisarCambio(sinVacios({ ...x, explicacion: undefined }) as Parche, def, alcance).problemas,
      })));
    parcheIA = sinVacios({ ...r, explicacion: undefined }) as Parche;
    explicacion = r.explicacion;
  }
  const sinTraer = await copiarImagenesExternas([...(parcheIA.preguntas ?? []), ...(parcheIA.secciones ?? []).flatMap((x) => x.preguntas)]);
  if (sinTraer.length) explicacion = [explicacion, ...sinTraer].filter(Boolean).join(' ');
  const { parche, despues, problemas } = revisarCambio(parcheIA, def, alcance);
  return { parche, explicacion, cambios: cambiosEnPalabras(def, despues), avisos: avisosDeLogica(def, despues), problemas };
}

/** Lo que tiene de malo una propuesta de nombres cortos: ids que no se pidieron, que faltan, largos o repetidos. */
export function revisarNombres(nombres: Record<string, string>, def: Definicion, ids: string[]): { limpios: Record<string, string>; problemas: string[] } {
  const pedidos = new Set(ids);
  const problemas: string[] = [];
  const limpios: Record<string, string> = {};
  for (const [id, n] of Object.entries(nombres)) {
    const nombre = n.trim().replace(/[¿?]/g, '').trim();
    if (!pedidos.has(id) || !nombre) continue;
    if (nombre.length > 40) problemas.push(`«${nombre}» (${id}) es muy largo para una columna: de 1 a 3 palabras.`);
    limpios[id] = nombre.slice(0, 40);
  }
  for (const id of ids) if (!limpios[id]) problemas.push(`Falta el nombre de ${id}.`);
  // En una sección que se repite, la columna lleva el nombre del bloque: ahí basta con no repetirse dentro de la sección.
  const vistos = new Map<string, string>();
  for (const s of def.secciones) {
    for (const p of s.preguntas) {
      const nombre = (limpios[p.id] ?? p.nombre ?? '').toLowerCase();
      if (!nombre) continue;
      const llave = s.repetirPor ? `${s.id}·${nombre}` : nombre;
      if (vistos.has(llave)) problemas.push(`«${limpios[p.id] ?? p.nombre}» se repite (${vistos.get(llave)} y ${p.id}): cada columna con su nombre.`);
      else vistos.set(llave, p.id);
    }
  }
  return { limpios, problemas };
}

/** Nombres cortos para las preguntas que no tienen, en una sola llamada. Los pone el editor (se deshacen con ⌘Z). */
export async function proponerNombres(o: { filtro: Filtro; email: string; stream?: StreamWriter; definicion: Definicion }) {
  const ids = sinNombreCorto(o.definicion).map((p) => p.id);
  if (!ids.length) return { nombres: {} };
  const usuario: Contenido = [{ type: 'text', text: promptNombres(o.definicion, ids) }];
  const r = await conRegistro(o.email, o.filtro.id, 'nombres', (onGasto) => conLatido(o.stream, 'Poniendo los nombres cortos…', () =>
    llamarJSON({
      signal: o.stream?.signal,
      usuario, esquema: RespuestaNombresZ, modelo: MODELOS.cambios, esfuerzo: 'low', onGasto, aceptarConProblemas: true,
      revisar: (x) => revisarNombres(x.nombres, o.definicion, ids).problemas,
    })));
  return { nombres: revisarNombres(r.nombres, o.definicion, ids).limpios };
}
