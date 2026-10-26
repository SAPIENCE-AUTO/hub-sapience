// Lo que se le pide a la IA en cada llamada del generador de Filtros. Las reglas viven en la skill
// (system prompt); aquí van los datos del filtro, el paso que se pide y el formato que se espera.
// Funciones puras: las prueba server/scripts/test-formularios.ts sin llamar a la IA.
import { minutosDeEstructura, type Estructura, type OrigenGenerador, type SeccionPlan } from '../../lib/formularios/generador';
import { TOPE_MINUTOS } from '../../lib/formularios/duracion';
import { forma, type Definicion, type Seccion } from '../../lib/formularios/tipos';

export interface DatosEstudio { titulo: string; proyecto?: string; cliente?: string }

const datos = (d: DatosEstudio) => [
  `Nombre interno del filtro: ${d.titulo}`,
  d.proyecto ? `Proyecto: ${d.proyecto}` : '',
  d.cliente ? `Cliente (no se menciona nunca al participante): ${d.cliente}` : '',
].filter(Boolean).join('\n');

/** El screener en JSON, una pregunta por renglón; la regla de NSE resumida (sus puntos no le sirven a la IA). */
export function definicionParaIA(def: Definicion): string {
  const { secciones, frentes, alertas, nse, ...cabeza } = def;
  const lineas = [
    '{',
    ...Object.entries(cabeza).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    ' "secciones": [',
    ...secciones.map((s, i) => {
      const { preguntas, ...resto } = s;
      return [
        `  ${JSON.stringify(resto).slice(0, -1)}, "preguntas": [`,
        ...preguntas.map((p, j) => `   ${JSON.stringify(p)}${j < preguntas.length - 1 ? ',' : ''}`),
        `  ]}${i < secciones.length - 1 ? ',' : ''}`,
      ].join('\n');
    }),
    ' ],',
    ` "frentes": ${JSON.stringify(frentes ?? [])},`,
    ` "alertas": ${JSON.stringify(alertas ?? [])}`,
    '}',
  ];
  const regla = nse ? `\nRegla de NSE: ${nse.regla ?? 'propia'}; niveles de mayor a menor: ${nse.cortes.map((c) => c.nivel).join(', ')}. Sus preguntas (${Object.keys(nse.puntos).join(', ')}) son del cuestionario oficial: no se tocan.` : '\nEste filtro no tiene regla de NSE.';
  return lineas.join('\n') + regla;
}

const minutos = (e: Estructura) => {
  const m = minutosDeEstructura(e).total;
  return `≈ ${m.tipico} min (hasta ${m.maximo} si le salen todos los bloques), tope ${TOPE_MINUTOS}`;
};

const FORMATO_ESTRUCTURA = 'Responde solo con el JSON de la estructura, con el formato de references/estructura.md: {"pais", "tituloPublico", "perfil", "frentes": [..], "secciones": [..], "supuestos": [..]}.';

/** Etapa 1: proponer, convertir un screener o ajustar una estructura. */
export function promptEstructura(o: {
  origen: OrigenGenerador; estudio: DatosEstudio; base?: Estructura; pedido?: string; ajuste?: boolean;
  /** Los perfiles y cuotas de la muestra del proyecto: el filtro los toma tal cual. */
  perfilesMuestra?: { id: string; nombre: string; descripcion?: string; reparto?: string; cuota: number }[];
}): string {
  const partes = [datos(o.estudio)];
  if (o.perfilesMuestra?.length) {
    partes.push([
      'PERFILES Y CUOTAS DEL ESTUDIO: ya están definidos en la muestra del proyecto. Úsalos tal cual en "frentes": uno por cada uno, con su mismo nombre, su cuota como "meta" y su id en "perfilMuestra"; no agregues otros, no los juntes ni los partas. En "quien", quién entra a cada uno según su descripción y los insumos. El reparto no va en quién entra: se cuida con preguntas y alertas, y dilo en supuestos si no se puede.',
      ...o.perfilesMuestra.map((p) => `- id ${p.id} · «${p.nombre}» · cuota ${p.cuota}${p.descripcion ? ` · ${p.descripcion}` : ''}${p.reparto ? ` · reparto: ${p.reparto}` : ''}`),
    ].join('\n'));
  }
  if (o.ajuste && o.base) {
    partes.push(
      `Esta es la estructura actual del filtro (${minutos(o.base)}), en JSON:\n${JSON.stringify(o.base)}`,
      `Se pide este ajuste:\n"${o.pedido ?? ''}"`,
      'Aplica el ajuste con references/estructura.md → «Ajustar una estructura»: conserva cada id que sigue, lo nuevo con id que empiece con nuevo_, "cambia": false en las secciones que no tocas y "cambia": true en las que cambias o agregas. En "supuestos", solo lo nuevo que decidiste.',
    );
  } else if (o.origen === 'filtro' && o.base) {
    partes.push(
      `Se parte de un filtro anterior del equipo. Esta es su estructura (${minutos(o.base)}), en JSON:\n${JSON.stringify(o.base)}`,
      o.pedido?.trim() ? `Lo que cambia para este estudio:\n"${o.pedido.trim()}"` : 'No se dijo qué cambia: ajusta solo lo que los insumos pidan distinto.',
      'Adáptalo a este estudio con los insumos de arriba. Conserva cada id que sigue, lo nuevo con id que empiece con nuevo_, "cambia": false en las secciones que se quedan igual y "cambia": true en las que cambian o son nuevas. En "supuestos", lo que cambiaste y por qué, y lo que conviene confirmar.',
    );
  } else if (o.origen === 'word') {
    partes.push('Los insumos traen un screener que ya existe (en Word o PDF). Conviértelo a la estructura **sin rediseñarlo**: mismo orden, las mismas preguntas con todas sus opciones, la misma lógica y los mismos perfiles y cuotas. Si es para encuestador, vuélvelo autoaplicado. En "supuestos", todo lo que tuviste que interpretar: preguntas de una sola respuesta que venían con casillas (van como "unica"), reglas que no se pueden expresar igual, instrucciones de encuestador, datos que faltan. Si se pasa de 10 minutos, no recortes: dilo en supuestos.');
    if (o.pedido?.trim()) partes.push(`Además, el equipo pide:\n"${o.pedido.trim()}"`);
  } else {
    partes.push('Propón la estructura del filtro a partir de los insumos de arriba, con las reglas de references/reglas.md y el formato de references/estructura.md: país, perfil, perfiles (en "frentes") con su cuota y quién entra a cada uno, y las secciones en orden de embudo con sus preguntas en una línea (las de opciones con todas sus opciones). Apunta a 10 minutos o menos por el camino común. En "supuestos", lo que decidiste sin que los insumos lo dijeran, de dónde salió cada dato importante y las reglas que no aplican a este estudio.');
    if (o.pedido?.trim()) partes.push(`Además, el equipo pide:\n"${o.pedido.trim()}"`);
  }
  partes.push(FORMATO_ESTRUCTURA);
  return partes.join('\n\n');
}

/** Etapa 2: escribir una sección del plan. */
export function promptSeccion(o: {
  origen: OrigenGenerador; estudio: DatosEstudio; estructura: Estructura; plan: SeccionPlan;
  /** Lo ya escrito de esta sección, si se reescribe porque cambió la estructura. */
  anterior?: Seccion;
}): string {
  const porSeccion = minutosDeEstructura(o.estructura).porSeccion[o.plan.id];
  const partes = [
    datos(o.estudio),
    `Estructura aprobada del filtro (${minutos(o.estructura)}), en JSON:\n${JSON.stringify(o.estructura)}`,
    `Escribe la sección «${o.plan.titulo}» (id ${o.plan.id})${porSeccion ? `, que la estructura estima en ≈ ${porSeccion.tipico} min` : ''}: la redacción final de cada pregunta, todas sus opciones y su lógica (mostrar si, terminar, descartar el bloque, dejar fuera de un grupo, opciones exclusivas, «Otra, ¿cuál?», orden aleatorio, rangos, notas para el equipo).`,
    [
      'Reglas de esta llamada:',
      `- La sección lleva el id ${o.plan.id} y sus preguntas y opciones los ids que trae la estructura, tal cual: otras secciones y los perfiles los usan. Puedes agregar opciones o preguntas que falten, con id que empiece con nuevo_.`,
      '- Conserva las preguntas y las opciones de la estructura; si alguna sobra o falta algo, dilo en "supuestos".',
      '- Cada pregunta lleva su "nombre" corto (el de la estructura si lo trae; si no, ponle uno con la regla de references/contrato.md).',
      o.plan.aparece ? `- La sección solo aparece en este caso: «${o.plan.aparece}». Escríbelo como "mostrarSi" de la sección, con ids de preguntas de secciones anteriores.` : '',
      o.plan.repetirPor ? `- La sección se repite por cada opción marcada en ${o.plan.repetirPor}${o.plan.repetirSolo ? ` (solo ${o.plan.repetirSolo.join(', ')})` : ''}: lleva "repetirPor"${o.plan.repetirSolo ? ' y "repetirSolo"' : ''}, usa «{opcion}» donde va el nombre y "descarta" en las opciones que hacen que ese bloque no cuente.` : '',
      '- La lógica solo usa preguntas de esta sección o de secciones anteriores. No escribas perfiles ni alertas: van en la etapa final.',
      '- Nunca inventes direcciones de imágenes (ver «Imágenes» en references/contrato.md).',
    ].filter(Boolean).join('\n'),
  ];
  if (o.anterior) {
    partes.push(`Esta sección ya estaba escrita así y la estructura cambió. Respeta la redacción, las opciones y la lógica de lo que sigue igual (con sus mismos ids) y cambia solo lo que pide la estructura nueva:\n${JSON.stringify(o.anterior)}`);
  }
  if (o.origen === 'word') partes.push('Los insumos traen el screener original: convierte esta sección fiel a él, con su misma redacción, sus opciones y su lógica.');
  partes.push('Responde solo con el JSON: {"seccion": {"id", "titulo", "intro"?, "mostrarSi"?, "repetirPor"?, "repetirSolo"?, "preguntas": [..]}, "supuestos": [..]}, con preguntas, opciones y condiciones en el formato de references/contrato.md. En "supuestos", solo lo que decidiste en esta sección y no está en la estructura (puede ir vacío).');
  return partes.join('\n\n');
}

/** Lógica final: perfiles, alertas, claves y textos, con todas las secciones escritas. */
export function promptLogica(o: { estudio: DatosEstudio; estructura: Estructura; definicion: Definicion; ajuste?: boolean }): string {
  return [
    datos(o.estudio),
    `Perfil que se busca: ${o.estructura.perfil || '(ver insumos)'}`,
    `Perfiles de la estructura aprobada (quién entra, en palabras):\n${JSON.stringify(o.estructura.frentes)}`,
    `El filtro ya escrito, en JSON:\n${definicionParaIA(o.definicion)}`,
    [
      'Arma la lógica final del filtro:',
      '- "frentes" (los perfiles): cada perfil de la estructura, con su mismo id, nombre, grupo y cuota, y "califica" como condición sobre las preguntas del filtro (references/contrato.md). Lo que pide de NSE va con {"nse": [...]} y nunca descarta. Lo que solo reparte (mitad y mitad, porcentajes de género, variedad) no va en la condición.',
      '- "alertas": las que pidan los insumos o las reglas (sobredeclarantes, combinaciones raras). Pueden ir vacías.',
      '- "claves": el id de la pregunta del nombre, del celular, de la edad y del género.',
      '- "textos": título público, bienvenida, despedida y mensaje de no califica, con references/redaccion.md (sin el cliente; la bienvenida dice cuánto tarda y si pedirá fotos).',
      '- Usa solo ids que existen en el filtro. En "supuestos", lo que decidiste aquí (un criterio que no se pudo expresar igual, por ejemplo).',
      o.ajuste ? '- Este filtro ya estaba escrito y solo cambió parte de su estructura: conserva tal cual (mismo texto y misma condición) los perfiles y las alertas que siguen sirviendo, y cambia o agrega solo lo que obliga lo nuevo. Los textos de bienvenida y despedida no se tocan.' : '',
    ].filter(Boolean).join('\n'),
    'Responde solo con el JSON: {"frentes": [..], "alertas": [..], "claves": {..}, "textos": {"tituloPublico", "bienvenida", "despedida", "noCalifica"}, "supuestos": [..]}.',
  ].join('\n\n');
}

export type Alcance = { pregunta: string } | { seccion: string } | { frentes: true };

/** Un cambio pedido con palabras, sobre una pregunta, una sección o los perfiles. */
export function promptCambio(o: { definicion: Definicion; alcance: Alcance; pedido: string; perfil?: string }): string {
  const partes = [
    o.perfil ? `Perfil que se busca en el estudio: ${o.perfil}` : '',
    `El filtro, en JSON:\n${definicionParaIA(o.definicion)}`,
  ].filter(Boolean);
  if ('pregunta' in o.alcance) {
    partes.push(
      `La persona pide este cambio en la pregunta ${o.alcance.pregunta}:\n"${o.pedido}"`,
      'Devuelve esa pregunta completa con el cambio aplicado y nada más. Conserva su id y el id de cada opción que sigue; las opciones nuevas con id que empiece con nuevo_. No cambies lo que no se pidió. Si el pedido necesita tocar otras preguntas, perfiles o la sección, no lo hagas aquí: dilo en "explicacion" (se pide comentando la sección). Las reglas de la skill siguen vigentes: si el pedido choca con una, aplícalo de la forma que menos la rompa y dilo en "explicacion".',
      'Responde solo con el JSON: {"pregunta": {..}, "explicacion": "una o dos frases de lo que cambiaste"}.',
    );
  } else {
    const donde = 'seccion' in o.alcance ? `la sección ${o.alcance.seccion}` : 'los perfiles y cuotas';
    partes.push(
      `La persona comenta esto sobre la lógica de ${donde} (el orden, qué aparece según qué, los descartes, las cuotas o quién entra a cada perfil):\n"${o.pedido}"`,
      [
        'Propón el cambio:',
        '- "secciones": cada sección que cambia, completa (con todas sus preguntas). Las que no cambian no van.',
        '- "orden": los ids de todas las secciones en el orden nuevo, solo si cambia el orden o agregas una sección.',
        '- "quitarSecciones": ids de las secciones que se quitan, si alguna.',
        '- "frentes" (los perfiles) y "alertas": la lista completa, solo si cambian.',
        '- Conserva el id de cada sección, pregunta y opción que sigue; lo nuevo con id que empiece con nuevo_. Una pregunta que ya existe no se mueve a una sección que se repite distinto (cambiaría su columna en el tablero).',
        '- La lógica solo usa preguntas que van antes. Las preguntas del NSE no se tocan. Cambia solo lo que pide el comentario y lo que eso obliga a cambiar.',
      ].join('\n'),
      'Responde solo con el JSON: {"secciones": [..], "orden"?: [..], "quitarSecciones"?: [..], "frentes"?: [..], "alertas"?: [..], "explicacion": "una o dos frases de lo que cambiaste"}.',
    );
  }
  return partes.join('\n\n');
}

/** Nombres cortos (los de las columnas) para las preguntas que no tienen. */
export function promptNombres(def: Definicion, ids: string[]): string {
  const opciones = (labels: string[]) => (labels.length ? ` [${labels.slice(0, 6).join(' / ')}${labels.length > 6 ? ' / …' : ''}]` : '');
  const lineas = def.secciones.flatMap((s) => [
    `Sección «${s.titulo ?? s.id}»${s.repetirPor ? ' (se repite: su columna ya lleva el nombre de cada bloque)' : ''}`,
    ...s.preguntas.filter((p) => forma(p.tipo) !== 'ninguna').map((p) =>
      `- ${p.id}: ${p.texto}${opciones([...(p.opciones ?? []), ...(p.opcionesExtra ?? [])].map((o) => o.label))}${p.nombre ? ` → ya se llama «${p.nombre}»` : ''}`),
  ]);
  return [
    `Las preguntas del filtro, en orden:\n${lineas.join('\n')}`,
    [
      `Ponle nombre corto a estas preguntas: ${ids.join(', ')}.`,
      'El nombre corto es el encabezado de su columna en el tablero de Reclutamiento y en el Excel; el participante no lo ve. Sigue la regla de `nombre` en references/contrato.md: de 1 a 3 palabras, sin signos de interrogación, distinto de los demás nombres del filtro, y en secciones que se repiten sin el nombre de la opción.',
    ].join('\n'),
    'Responde solo con el JSON: {"nombres": {"idPregunta": "Nombre corto", …}}.',
  ].join('\n\n');
}
