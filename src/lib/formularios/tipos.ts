/**
 * Definición de un formulario (screener) de Tools → Formularios. Es data, no
 * código: el mismo JSON lo usa la página pública para mostrar las preguntas y
 * el servidor para calificar (motor.ts). Lo que el participante no debe ver
 * (notas, frentes, puntos de NSE, motivos de descarte) se quita antes de
 * mandarlo al navegador — ver definicionPublica() en motor.ts.
 *
 * Versión 2 del contrato (fase 1 de Filtros): tipos de pregunta de Fillout,
 * una o varias respuestas siempre dichas por el tipo, país y NSE como alerta.
 * Lo guardado en versión 1 se lee con leerDefinicion() (al final).
 */

export type TipoPregunta =
  // se escriben
  | 'texto' | 'texto_largo' | 'numero' | 'telefono' | 'correo' | 'direccion'
  // de opciones: el tipo dice si es una o varias, nunca se deduce
  | 'unica' | 'multiple'
  | 'lista' | 'lista_multiple'
  | 'imagen_unica' | 'imagen_multiple'
  | 'matriz' | 'matriz_multiple'
  | 'ordenar'
  // escalas (dan un número)
  | 'escala' | 'estrellas' | 'deslizador'
  // sí o no
  | 'casilla' | 'interruptor'
  | 'foto'
  // sin respuesta: texto o imagen para instrucciones o para mostrar un concepto
  | 'contenido';

/** Qué guarda cada tipo. `una` y `varias` son las de opciones. */
export type FormaRespuesta =
  | 'texto' | 'numero' | 'direccion' | 'una' | 'varias' | 'matriz_una' | 'matriz_varias'
  | 'orden' | 'si_no' | 'fotos' | 'ninguna';

export const TIPOS: Record<TipoPregunta, { nombre: string; respuesta: FormaRespuesta }> = {
  texto: { nombre: 'Texto corto', respuesta: 'texto' },
  texto_largo: { nombre: 'Texto largo', respuesta: 'texto' },
  numero: { nombre: 'Número', respuesta: 'numero' },
  telefono: { nombre: 'Teléfono', respuesta: 'texto' },
  correo: { nombre: 'Correo', respuesta: 'texto' },
  direccion: { nombre: 'Dirección', respuesta: 'direccion' },
  unica: { nombre: 'Opción única', respuesta: 'una' },
  multiple: { nombre: 'Opción múltiple', respuesta: 'varias' },
  lista: { nombre: 'Lista desplegable', respuesta: 'una' },
  lista_multiple: { nombre: 'Selección múltiple en lista', respuesta: 'varias' },
  imagen_unica: { nombre: 'Selector con imágenes (una)', respuesta: 'una' },
  imagen_multiple: { nombre: 'Selector con imágenes (varias)', respuesta: 'varias' },
  matriz: { nombre: 'Matriz (una por fila)', respuesta: 'matriz_una' },
  matriz_multiple: { nombre: 'Matriz (varias por fila)', respuesta: 'matriz_varias' },
  ordenar: { nombre: 'Ordenar', respuesta: 'orden' },
  escala: { nombre: 'Escala de opinión', respuesta: 'numero' },
  estrellas: { nombre: 'Estrellas', respuesta: 'numero' },
  deslizador: { nombre: 'Deslizador', respuesta: 'numero' },
  casilla: { nombre: 'Casilla única', respuesta: 'si_no' },
  interruptor: { nombre: 'Interruptor sí/no', respuesta: 'si_no' },
  foto: { nombre: 'Foto', respuesta: 'fotos' },
  contenido: { nombre: 'Texto o imagen', respuesta: 'ninguna' },
};

export const forma = (tipo: TipoPregunta): FormaRespuesta => TIPOS[tipo]?.respuesta ?? 'texto';
/** Una o varias de una lista de opciones (con o sin imagen, en botones o en lista). */
export const esDeOpciones = (tipo: TipoPregunta) => forma(tipo) === 'una' || forma(tipo) === 'varias';
export const esMatriz = (tipo: TipoPregunta) => forma(tipo) === 'matriz_una' || forma(tipo) === 'matriz_varias';

/** Campos de una dirección, en el orden en que se piden. Sus nombres por país viven en paises.ts. */
export const CAMPOS_DIRECCION = ['calle', 'numero', 'colonia', 'ciudad', 'estado', 'cp'] as const;
export type CampoDireccion = typeof CAMPOS_DIRECCION[number];

export interface Opcion {
  id: string;
  label: string;
  /** Nombre corto para «{opcion}» dentro de una sección repetida («aerosol» en vez de «Aerosol (lata que rocías)»). */
  corto?: string;
  /** URL de la imagen (selector con imágenes). Subirla arrastrando es de la fase 2. */
  imagen?: string;
  /**
   * No califica: lo deja fuera de la muestra. El texto es el motivo interno. Por
   * defecto NO corta el filtro (contesta todo y se registra; así nadie aprende
   * dónde se corta y vuelve a llenarlo falseando). Con `cortar`, termina ahí.
   */
  termina?: string;
  /** Cortar el filtro en cuanto la marca (solo a criterio del analista; el aviso y la identificación siempre cortan). */
  cortar?: boolean;
  /** Solo en una sección repetida: descarta esa repetición (ese formato), no el formulario. */
  descarta?: string;
  /** Deja fuera estos grupos de cuota (p. ej. rechazo a la marca del cliente). */
  excluyeGrupos?: string[];
  /** Pide escribir cuál («Otra, ¿cuál?»). */
  otra?: boolean;
  /** Al marcarla se desmarcan las demás («Ninguno»). Nunca abre una sección repetida. */
  exclusiva?: boolean;
  /** No se mueve cuando la pregunta va en orden aleatorio. */
  fija?: boolean;
}

export interface FilaMatriz { id: string; label: string }

export interface ReglaMatriz {
  fila: string;
  /** Si en esa fila marcó alguna de estas columnas. */
  columnas: string[];
  termina?: string;
  cortar?: boolean;
  excluyeGrupos?: string[];
}

export type Condicion =
  | { pregunta: string; incluye: string[]; instancia?: string }
  | { pregunta: string; noIncluye: string[]; instancia?: string }
  | { pregunta: string; incluyeTodas: string[]; instancia?: string }
  | { numero: string; entre: [number, number]; instancia?: string }
  | { bloque: string; opcion: string }
  | { instanciaEs: string[] }
  /** En un frente no descarta: si el NSE no coincide, da una alerta (motor.ts → evaluar). */
  | { nse: string[] }
  | { todas: Condicion[] }
  | { alguna: Condicion[] }
  | { no: Condicion };

export interface Pregunta {
  id: string;
  tipo: TipoPregunta;
  texto: string;
  /**
   * Nombre corto («Edad», «Marcas que compra»): el encabezado de su columna en
   * el tablero, el Excel y el panel. El participante no lo ve. Sin él, la
   * columna lleva el texto de la pregunta (tabla.ts → nombreDePregunta).
   */
  nombre?: string;
  ayuda?: string;
  /** Muestra «Leer el aviso de privacidad» bajo la pregunta (la del aviso en «Antes de empezar»). */
  enlaceAviso?: boolean;
  /** Imagen arriba de la pregunta (URL). En `contenido` es lo que se muestra. */
  imagen?: string;
  opcional?: boolean;
  opciones?: Opcion[];
  /** Las opciones salen de lo marcado en otra pregunta (en la misma repetición si la hay). */
  opcionesDe?: string;
  /** Se agregan al final de las que salen de `opcionesDe` (p. ej. «Ninguno»). */
  opcionesExtra?: Opcion[];
  filas?: FilaMatriz[];
  reglasMatriz?: ReglaMatriz[];
  aleatorio?: boolean;
  /** Tope de cuántas se marcan (varias) o cuántas se ordenan (ordenar: «tus 3 favoritas»). */
  maxOpciones?: number;
  /** Número y escalas: rango aceptado. Escala 0–10, estrellas 1–5 y deslizador 0–100 si no se dice (motor.ts → rango). */
  min?: number;
  max?: number;
  /** Deslizador: de cuánto en cuánto se mueve. */
  paso?: number;
  /** Escalas: lo que se lee en los extremos («Nada probable» · «Muy probable»). */
  etiquetas?: { min?: string; max?: string };
  /** Número o escala: fuera de este rango termina el formulario. */
  terminaFuera?: { min: number; max: number; motivo: string; cortar?: boolean };
  /** Texto: expresión que debe cumplir (código postal, etc.). */
  patron?: string;
  patronMensaje?: string;
  /** Termina el formulario si se cumple, una vez contestada la pregunta. */
  terminaSi?: { si: Condicion; motivo: string; cortar?: boolean };
  mostrarSi?: Condicion;
  /** Lógica para el equipo; nunca llega al participante. */
  nota?: string;
}

export interface Seccion {
  id: string;
  titulo?: string;
  intro?: string;
  mostrarSi?: Condicion;
  /** Se repite una vez por cada opción marcada en esta pregunta. «{opcion}» se reemplaza por su nombre. */
  repetirPor?: string;
  /** Si existe, solo estas opciones abren repetición. */
  repetirSolo?: string[];
  preguntas: Pregunta[];
}

export interface Frente {
  id: string;
  nombre: string;
  /** Grupo de cuota (marca del cliente) — lo usan los rechazos de marca. */
  grupo: string;
  meta: number;
  /** Quién entra. Si lleva NSE, el NSE no saca a nadie: si no coincide, alerta. */
  califica: Condicion;
  /** El perfil de la muestra del proyecto: de ahí salen su nombre y su cuota (se cambian en Muestra). */
  perfilMuestra?: string;
}

export interface Alerta {
  texto: string;
  si?: Condicion;
  contar?: { pregunta: string; masDe: number };
}

/**
 * Regla de NSE copiada al screener al crearlo (de nse.ts, por país): si
 * después se confirma o cambia la regla, los filtros ya creados no cambian.
 */
export interface ReglaNse {
  /** De dónde salió: «AMAI 2022». Si ya no es la vigente del país, el panel lo dice. */
  regla?: string;
  /** Los puntos todavía hay que confirmarlos contra la versión vigente de la regla. */
  porConfirmar?: boolean;
  /** puntos[preguntaId][opcionId] */
  puntos: Record<string, Record<string, number>>;
  /** De mayor a menor: el primer corte cuyo `desde` alcance la suma es el nivel. */
  cortes: { nivel: string; desde: number }[];
}

export interface Definicion {
  version: 2;
  /** Código ISO del país (paises.ts): decide la regla de NSE y cómo se pide la dirección. */
  pais: string;
  tituloPublico: string;
  bienvenida: string;
  despedida: string;
  /** Lo que ve quien queda fuera antes de terminar. Neutral: no dice por qué. */
  noCalifica: string;
  secciones: Seccion[];
  frentes?: Frente[];
  nse?: ReglaNse;
  alertas?: Alerta[];
  /** Pregunta con el nombre y el teléfono, para mostrarlos en el panel. */
  claves?: { nombre?: string; telefono?: string; edad?: string; genero?: string };
}

export interface FotoSubida { ruta: string; nombre: string }

/**
 * Respuestas: clave = id de pregunta, o «id@opcion» dentro de una sección
 * repetida; «clave#otra» guarda el texto de «Otra». Opciones: id (una) o ids
 * (varias; en `ordenar`, en el orden elegido). Matriz: fila → id o ids.
 * Dirección: campo → texto. Casilla e interruptor: 'si' | 'no'.
 */
export type Valor = string | string[] | number | Record<string, string | string[]> | FotoSubida[];
export type Respuestas = Record<string, Valor>;

export interface Resultado {
  califica: boolean;
  /** Se cortó el filtro (un criterio con `cortar`, o el aviso o la identificación). */
  terminado?: { motivo: string; clave: string };
  /** Todos los motivos por los que no califica, aunque no hayan cortado el filtro. */
  noCalifica?: string[];
  descartes: { seccion: string; opcion: string; motivo: string }[];
  gruposExcluidos: string[];
  /** NSE estimado. `fueraDe`: frentes donde entró aunque su NSE no es el que pide el frente (va también como alerta). */
  nse?: { puntos: number; nivel: string; fueraDe?: string[] };
  frentes: string[];
  alertas: string[];
  incompleto: boolean;
  // ── lo que se agrega después de recibirla (serverUtils/formularios/alRecibir.ts) ──
  /** Califica, pero todos sus perfiles ya llenaron su cuota: se queda en Filtros de respaldo. */
  perfilLleno?: boolean;
  historial?: HistorialPersona;
  ia?: ClasificacionIA;
  /** Traída de un filtro anterior (no la contestó en este): de dónde y cuándo contestó. */
  traida?: { formularioId: string; titulo: string; proyecto?: string; respuestaId: string; fecha: string };
  /** El perfil para el que el Hub la sugiere (los mejores candidatos hasta cubrir lo que falta de cada perfil). */
  sugerido?: string;
  /**
   * Su fila en el tablero y lo último que el Hub escribió en sus columnas
   * (Califica, Perfil, Motivo, IA, Sugerido): si la celda ya no dice eso, la
   * cambió el equipo y el Hub ya no la toca.
   */
  tablero?: { fila?: string; escrito: Record<string, string> };
}

/** La bandeja de una respuesta: Candidato (sin motivos), Casi (un motivo) o No entra (dos o más, o no dio el aviso o la identificación). */
export type Bandeja = 'Candidato' | 'Casi' | 'No entra';

/** Historial de duplicados de quien contestó (la misma búsqueda de los tableros de Reclutamiento). */
export interface HistorialPersona {
  nivel?: 'ya_participo' | 'duplicado' | 'mismo_proyecto' | 'repetido';
  /** Como la nota de Fillout: «🔴 YA PARTICIPÓ: …». Vacía si es nuevo. */
  nota: string;
  entradas: {
    tipo: 'tablero' | 'filtro'; proyecto: string; cliente?: string; donde?: string; estatus?: string; grupo?: string; fecha?: string;
    participo: boolean; mismoCliente: boolean; reciente: boolean;
  }[];
  calculado: string;
}

/** Lo que dice la IA de un candidato: ayuda al analista, nunca decide. */
export interface ClasificacionIA {
  /** El mejor encaje entre sus perfiles. */
  encaje: 'alto' | 'medio' | 'bajo';
  perfiles: { id: string; encaje: 'alto' | 'medio' | 'bajo'; razon: string }[];
  resumen: string;
  alertas: string[];
}

// ── versiones guardadas ──────────────────────────────────────────────────────
/** Versión 1 (21 y 22 de octubre de 2026): sin país; el NSE de un frente descartaba. */
interface DefinicionV1 extends Omit<Definicion, 'version' | 'pais'> { version: 1 }

/**
 * Lee una definición guardada en `formularios.definicion` de cualquier versión
 * y la deja en la actual. La 1 tiene los mismos tipos y las mismas claves de
 * respuesta y de columna, así que el ensayo de ALONG 2 sigue igual; solo se le
 * agrega el país (era México) y el origen de su NSE: la AMAI 2018, que ya no es
 * la vigente (el ensayo la conserva, como todo filtro ya creado).
 */
export function leerDefinicion(guardada: unknown): Definicion {
  const d = guardada as Definicion | DefinicionV1;
  if (d.version === 2) return d;
  return {
    ...d,
    version: 2,
    pais: 'MX',
    nse: d.nse ? { regla: 'AMAI 2018', ...d.nse } : undefined,
  };
}
