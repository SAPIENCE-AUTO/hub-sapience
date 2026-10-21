/**
 * Definición de un formulario (screener) de Tools → Formularios. Es data, no
 * código: el mismo JSON lo usa la página pública para mostrar las preguntas y
 * el servidor para calificar (motor.ts). Lo que el participante no debe ver
 * (notas, frentes, puntos de NSE, motivos de descarte) se quita antes de
 * mandarlo al navegador — ver definicionPublica() en motor.ts.
 */

export type TipoPregunta = 'texto' | 'texto_largo' | 'numero' | 'telefono' | 'correo' | 'unica' | 'multiple' | 'matriz' | 'foto';

export interface Opcion {
  id: string;
  label: string;
  /** Nombre corto para «{opcion}» dentro de una sección repetida («aerosol» en vez de «Aerosol (lata que rocías)»). */
  corto?: string;
  /** Termina todo el formulario. El texto es el motivo interno. */
  termina?: string;
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
  columnas: string[];
  termina?: string;
  excluyeGrupos?: string[];
}

export type Condicion =
  | { pregunta: string; incluye: string[]; instancia?: string }
  | { pregunta: string; noIncluye: string[]; instancia?: string }
  | { pregunta: string; incluyeTodas: string[]; instancia?: string }
  | { numero: string; entre: [number, number] }
  | { bloque: string; opcion: string }
  | { instanciaEs: string[] }
  | { nse: string[] }
  | { todas: Condicion[] }
  | { alguna: Condicion[] }
  | { no: Condicion };

export interface Pregunta {
  id: string;
  tipo: TipoPregunta;
  texto: string;
  ayuda?: string;
  opcional?: boolean;
  opciones?: Opcion[];
  /** Las opciones salen de lo marcado en otra pregunta (en la misma repetición si la hay). */
  opcionesDe?: string;
  /** Se agregan al final de las que salen de `opcionesDe` (p. ej. «Ninguno»). */
  opcionesExtra?: Opcion[];
  filas?: FilaMatriz[];
  reglasMatriz?: ReglaMatriz[];
  aleatorio?: boolean;
  maxOpciones?: number;
  /** Número: rango aceptado al escribir. */
  min?: number;
  max?: number;
  /** Número: fuera de este rango termina el formulario. */
  terminaFuera?: { min: number; max: number; motivo: string };
  /** Texto: expresión que debe cumplir (código postal, etc.). */
  patron?: string;
  patronMensaje?: string;
  /** Termina el formulario si se cumple, una vez contestada la pregunta. */
  terminaSi?: { si: Condicion; motivo: string };
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
  califica: Condicion;
}

export interface Alerta {
  texto: string;
  si?: Condicion;
  contar?: { pregunta: string; masDe: number };
}

export interface ReglaNse {
  /** puntos[preguntaId][opcionId] */
  puntos: Record<string, Record<string, number>>;
  /** De mayor a menor: el primer corte cuyo `desde` alcance la suma es el nivel. */
  cortes: { nivel: string; desde: number }[];
}

export interface Definicion {
  version: 1;
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

/** Respuestas: clave = id de pregunta, o «id@opcion» dentro de una sección repetida; «clave#otra» guarda el texto de «Otra». */
export type Valor = string | string[] | number | Record<string, string> | FotoSubida[];
export type Respuestas = Record<string, Valor>;

export interface Resultado {
  califica: boolean;
  terminado?: { motivo: string; clave: string };
  descartes: { seccion: string; opcion: string; motivo: string }[];
  gruposExcluidos: string[];
  nse?: { puntos: number; nivel: string };
  frentes: string[];
  alertas: string[];
  incompleto: boolean;
}
