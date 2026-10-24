import { duracionEstimada } from './duracion';
import { rango } from './motor';
import { nombreCampoDireccion, PAISES, telefonoDe } from './paises';
import { leerFormato, sinFormato } from './formato';
import { alertaEnPalabras, frenteEnPalabras, logicaDeOpcion, logicaDePregunta, logicaDeSeccion, type LineaLogica } from './palabras';
import { opcionesDe } from './tabla';
import { CAMPOS_DIRECCION, forma, type Definicion, type Opcion, type Pregunta } from './tipos';

/**
 * El screener como documento para el cliente (Word y PDF), con lo que el
 * equipo pone en sus filtros: la muestra con sus perfiles, las preguntas
 * numeradas, cada opción con su número y «CONTINUAR» o «TERMINAR», y las
 * notas en azul. Aquí solo se arma el contenido; el Word y el PDF lo dibujan
 * con el encabezado de Sapience (serverUtils/formularios/documento.ts).
 */

export type Color = 'verde' | 'rojo' | 'azul' | 'gris' | 'resaltado';
export interface Tramo { texto: string; negrita?: boolean; cursiva?: boolean; subrayado?: boolean; color?: Color }
/** Un renglón de texto con formato. */
export type Linea = Tramo[];

export interface FilaOpcion { codigo: string; texto: string; imagen?: string; instruccion: Linea }

export interface Matriz {
  /** «A», «B»… con su etiqueta, como en los filtros del equipo. */
  columnas: { letra: string; texto: string }[];
  /** Cada renglón con lo que pasa al marcar cada columna (vacío = sigue). */
  filas: { codigo: string; texto: string; celdas: Linea[] }[];
}

export interface PreguntaDoc {
  numero: number;
  texto: string;
  /** Lo que va antes de las opciones: ayuda, «Solo aparece si…», «Respuesta múltiple». */
  antes: Linea[];
  imagen?: string;
  opciones?: FilaOpcion[];
  matriz?: Matriz;
  /** Lo que se espera cuando no es de opciones («Celular de 10 dígitos»). */
  abierta?: string;
  /** Lo que va después: qué la termina, notas para el equipo. */
  despues: Linea[];
}

export interface PerfilDoc { nombre: string; cuota: number; quien: string }

export type Bloque =
  | { tipo: 'portada'; titulo: string; ficha: [string, string][] }
  | { tipo: 'muestra'; perfiles: PerfilDoc[]; alertas: string[] }
  | { tipo: 'bienvenida'; texto: string }
  | { tipo: 'seccion'; titulo: string; notas: string[]; intro?: string }
  | ({ tipo: 'pregunta' } & PreguntaDoc)
  | { tipo: 'contenido'; texto?: string; imagen?: string }
  | { tipo: 'final'; califica: string; noCalifica: string };

const verde = (texto: string): Tramo => ({ texto, negrita: true, color: 'verde' });
const rojo = (texto: string): Tramo => ({ texto, negrita: true, color: 'rojo' });
const azul = (texto: string): Tramo => ({ texto, color: 'azul' });
const nota = (texto: string): Linea => [{ texto: 'Nota: ', negrita: true, color: 'azul' }, azul(texto)];

/**
 * Un texto del participante con sus negritas y su resaltado (formato.ts) en
 * tramos, sobre el formato de base. Donde la base ya es negrita (la pregunta),
 * lo que va en negritas se subraya para que se note, igual que en el formulario.
 */
export function tramosDe(texto: string, base: Omit<Tramo, 'texto'> = {}): Linea {
  return leerFormato(texto).map((t) => ({
    ...base,
    texto: t.texto,
    ...(t.negrita ? (base.negrita ? { subrayado: true } : { negrita: true }) : {}),
    ...(t.resaltado ? { color: 'resaltado' as const } : {}),
  }));
}
/** Las notas para el equipo (y lo que termina) van más chicas que lo que lee el participante. */
export const esNota = (l: Linea) => l.some((t) => t.color && t.color !== 'resaltado');

/** «Si contesta menos de 25 o más de 65, termina el filtro: Edad fuera» → «Si contesta menos de 25 o más de 65, TERMINAR». */
function terminar(l: LineaLogica): Linea {
  if (l.campo === 'terminaSi' && l.prefijo) {
    return [{ texto: `${l.prefijo.replace(/^(No califica(?: y se corta el filtro)?|Termina el filtro) si /, 'Si ').replace(/:\s*$/, '')}, ` }, rojo('TERMINAR')];
  }
  const corte = l.texto.search(/,? (no califica|termina el filtro)/);
  return corte > 0 ? [{ texto: `${l.texto.slice(0, corte)}, ` }, rojo('TERMINAR')] : [{ texto: l.texto }];
}

function instruccion(def: Definicion, p: Pregunta, o: Opcion): Linea {
  if (o.termina) return [rojo('TERMINAR')];
  if (o.descarta) return [rojo('NO CUENTA ESTE BLOQUE')];
  const extra = logicaDeOpcion(def, p, o).filter((l) => l.tipo === 'excluye').map((l) => l.texto.replace(/^Si (contesta esta|la marca), /, ''));
  return [verde('CONTINUAR'), ...extra.map((t) => azul(` · ${t}`))];
}

const conCual = (o: Opcion) => (o.otra && !o.label.includes('¿') ? `${o.label} ¿Cuál?` : o.label);
const letra = (i: number) => String.fromCharCode(65 + (i % 26));

/** Lo que se espera de respuesta cuando no es de opciones, como se escribe en el Word. */
function respuestaAbierta(def: Definicion, p: Pregunta): string | undefined {
  switch (p.tipo) {
    case 'texto': return p.patronMensaje ? `Respuesta abierta (${p.patronMensaje.toLowerCase()})` : 'Respuesta abierta';
    case 'texto_largo': return 'Respuesta abierta';
    case 'numero': return 'Respuesta numérica';
    case 'telefono': { const t = telefonoDe(def.pais); return `Celular de ${t.digitos} dígitos${t.lada ? ` (${t.lada})` : ''}`; }
    case 'correo': return 'Correo electrónico';
    case 'direccion': return CAMPOS_DIRECCION.map((c) => nombreCampoDireccion(def.pais, c)).join(', ');
    case 'foto': return 'Foto desde el celular';
    case 'escala': case 'estrellas': case 'deslizador': {
      const r = rango(p);
      const extremos = [p.etiquetas?.min && `${r.min} = ${p.etiquetas.min}`, p.etiquetas?.max && `${r.max} = ${p.etiquetas.max}`].filter(Boolean).join(', ');
      const nombre = p.tipo === 'estrellas' ? `De ${r.min} a ${r.max} estrellas` : `Escala de ${r.min} a ${r.max}`;
      return extremos ? `${nombre} (${extremos})` : nombre;
    }
    default: return undefined;
  }
}

/** Indicación para quien lee: si es de varias, cuántas, cómo se ordena. */
function indicacion(p: Pregunta): string | undefined {
  const f = forma(p.tipo);
  if (f === 'varias') return p.maxOpciones ? `Respuesta múltiple, hasta ${p.maxOpciones}.` : 'Respuesta múltiple.';
  if (f === 'orden') return p.maxOpciones ? `Ordena sus ${p.maxOpciones} primeras.` : 'Ordena todas, de la que más a la que menos.';
  if (f === 'matriz_una') return 'Una respuesta por renglón.';
  if (f === 'matriz_varias') return 'Varias respuestas por renglón.';
  return undefined;
}

function pregunta(def: Definicion, p: Pregunta, numero: number, t: (x: string) => string): PreguntaDoc {
  const logica = logicaDePregunta(def, p);
  const antes: Linea[] = [];
  const despues: Linea[] = [];
  if (p.ayuda) antes.push(tramosDe(t(p.ayuda)));
  for (const l of logica.filter((x) => x.tipo === 'aparece')) antes.push(nota(l.texto));
  const ind = indicacion(p);
  if (ind) antes.push([azul(ind)]);

  const doc: PreguntaDoc = { numero, texto: t(p.texto), antes, imagen: p.imagen, despues };
  const f = forma(p.tipo);
  if (f === 'una' || f === 'varias' || f === 'orden') {
    const de = p.opcionesDe ? logica.find((x) => x.tipo === 'opciones') : undefined;
    if (de) antes.push(nota(de.texto));
    doc.opciones = opcionesDe(def, p).map((o, i) => ({ codigo: String(i + 1), texto: t(conCual(o)), imagen: o.imagen, instruccion: instruccion(def, p, o) }));
  } else if (f === 'matriz_una' || f === 'matriz_varias') {
    const columnas = p.opciones ?? [];
    doc.matriz = {
      columnas: columnas.map((o, i) => ({ letra: letra(i), texto: t(o.label) })),
      filas: (p.filas ?? []).map((fila, i) => ({
        codigo: String(i + 1),
        texto: t(fila.label),
        celdas: columnas.map((c) => (p.reglasMatriz?.some((r) => r.fila === fila.id && r.termina && r.columnas.includes(c.id)) ? [rojo('TERMINAR')] : [])),
      })),
    };
  } else if (f === 'si_no') {
    doc.opciones = p.tipo === 'casilla'
      ? [{ codigo: '1', texto: 'La marca', instruccion: [verde('CONTINUAR')] }, ...(p.opcional ? [] : [{ codigo: '2', texto: 'No la marca', instruccion: [{ texto: 'No puede seguir sin marcarla' }] }])]
      : [{ codigo: '1', texto: 'Sí', instruccion: [verde('CONTINUAR')] }, { codigo: '2', texto: 'No', instruccion: [verde('CONTINUAR')] }];
  } else {
    doc.abierta = respuestaAbierta(def, p);
    if (!p.opcional && f === 'fotos') despues.push([{ texto: 'Si no sube la foto, ' }, rojo('TERMINAR')]);
  }

  for (const l of logica) {
    // Lo que termina en una matriz ya va en sus celdas.
    if (l.tipo === 'termina' && !(doc.matriz && l.campo === undefined)) despues.push(terminar(l));
    else if (l.tipo === 'excluye') despues.push(nota(l.texto));
    else if (l.tipo === 'nse') despues.push(nota(`Pregunta del NSE${def.nse?.regla ? ` (${def.nse.regla})` : ''}.`));
    else if (l.tipo === 'otro' && /aleatorio/.test(l.texto)) despues.push(nota('Las opciones se muestran en orden aleatorio.'));
  }
  if (p.nota) despues.push(nota(p.nota));
  return doc;
}

export function documentoDeFiltro(def: Definicion, titulo: string): Bloque[] {
  const out: Bloque[] = [];
  const dur = duracionEstimada(def);
  out.push({
    tipo: 'portada',
    titulo,
    ficha: [
      ['País', PAISES[def.pais]?.nombre ?? def.pais],
      ['Duración aproximada', `${dur.tipico === dur.maximo ? dur.tipico : `${dur.tipico} a ${dur.maximo}`} minutos`],
      ...(def.nse?.regla ? [['NSE', `Regla ${def.nse.regla}. Si no coincide con el perfil, entra con alerta.`] as [string, string]] : []),
    ],
  });

  const frentes = def.frentes ?? [];
  if (frentes.length || def.alertas?.length) {
    out.push({
      tipo: 'muestra',
      perfiles: frentes.map((f) => ({ nombre: f.nombre, cuota: f.meta, quien: frenteEnPalabras(def, f).replace(/ El NSE no saca a nadie.*$/, '').replace(/^Entra si (.)/, (_, c: string) => c.toUpperCase()) })),
      alertas: (def.alertas ?? []).map((a) => alertaEnPalabras(def, a)),
    });
  }
  if (def.bienvenida) out.push({ tipo: 'bienvenida', texto: def.bienvenida });

  let n = 0;
  for (const s of def.secciones) {
    // En una sección que se repite, «{opcion}» se escribe [OPCIÓN], como en los filtros del equipo.
    const t = (texto: string) => texto.split('{opcion}').join(s.repetirPor ? '[OPCIÓN]' : '…');
    out.push({
      tipo: 'seccion',
      titulo: s.titulo ? sinFormato(t(s.titulo)) : 'Sin título',
      notas: logicaDeSeccion(def, s).map((l) => (l.tipo === 'opciones' ? `${l.texto} [OPCIÓN] es el nombre de cada una.` : l.texto)),
      intro: s.intro ? t(s.intro) : undefined,
    });
    for (const p of s.preguntas) {
      if (p.tipo === 'contenido') out.push({ tipo: 'contenido', texto: p.texto ? t(p.texto) : undefined, imagen: p.imagen });
      else out.push({ tipo: 'pregunta', ...pregunta(def, p, ++n, t) });
    }
  }

  out.push({ tipo: 'final', califica: def.despedida, noCalifica: def.noCalifica });
  return out;
}

/** «PRUEBA AI - Filtro de reclutamiento», sin lo que no va en un nombre de archivo. */
export function nombreDocumento(titulo: string, extension: 'docx' | 'pdf'): string {
  const limpio = titulo.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Filtro';
  return `${limpio} - Filtro de reclutamiento.${extension}`;
}

// Para las pruebas: lo que se lee, sin formato.
const linea = (l: Linea) => l.map((t) => t.texto).join('');
export const textoDeBloques = (bloques: Bloque[]) => bloques.map((b) => {
  switch (b.tipo) {
    case 'portada': return [b.titulo, ...b.ficha.map(([k, v]) => `${k}: ${v}`)].join('\n');
    case 'muestra': return ['Muestra', ...b.perfiles.map((p, i) => `PERFIL ${i + 1}: ${p.nombre} · ${p.cuota} · ${p.quien}`), ...b.alertas.map((a) => `Alerta: ${a}`)].join('\n');
    case 'bienvenida': return sinFormato(b.texto);
    case 'seccion': return [b.titulo, ...b.notas, ...(b.intro ? [sinFormato(b.intro)] : [])].join('\n');
    case 'contenido': return [b.texto && sinFormato(b.texto), b.imagen && '[imagen]'].filter(Boolean).join('\n');
    case 'final': return `Si califica: ${sinFormato(b.califica)}\nSi no califica: ${sinFormato(b.noCalifica)}`;
    case 'pregunta': return [
      `${b.numero}. ${sinFormato(b.texto)}`,
      ...b.antes.map(linea),
      ...(b.opciones ?? []).map((f) => `${f.codigo} ${f.texto} ${linea(f.instruccion)}`),
      ...(b.matriz ? [`[${b.matriz.filas.map((f) => f.texto).join(' / ')}] × [${b.matriz.columnas.map((c) => `${c.letra} ${c.texto}`).join(' / ')}]`] : []),
      ...(b.abierta ? [b.abierta] : []),
      ...b.despues.map(linea),
    ].join('\n');
  }
}).join('\n');
