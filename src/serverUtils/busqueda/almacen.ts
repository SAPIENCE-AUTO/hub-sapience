import { ZiteError } from '../../../server/compat';

// Dónde se guarda lo que el buscador de gente sabe de las preguntas de los tableros: no hay respuestas de personas, solo el nombre de cada pregunta y las respuestas que se repiten (con cuántas filas
// las dieron). Se arma leyendo los tableros (catalogo.ts) y se consulta al buscar (buscar.ts). Las tablas son nuevas y aditivas: no tocan nada de lo que ya hay.
//
// - busqueda_tableros: los tableros de reclutamiento ya leídos, con su proyecto y cliente, y cuándo (para volver a leer solo lo que cambió).
// - busqueda_columnas: una pregunta de un tablero (el nombre de su columna), cuántas filas respondieron y cuántos textos distintos hubo.
// - busqueda_piezas: las respuestas de esa pregunta (el texto entero si son opciones que se repiten; las piezas de la lista si cada quien escribió una lista), con cuántas filas la dieron. `pieza` es el texto
//   normalizado (sin acentos ni mayúsculas) con el que se busca; `etiqueta` es cómo se escribía (con acentos) para mostrarlo.
// - busquedas_guardadas: las búsquedas con nombre («corona lovers») con sus criterios y la foto del último resultado.
export const SQL_TABLAS_BUSQUEDA = `
create table if not exists busqueda_tableros (
  tablero_id          text primary key,
  proyecto            text,
  tablero             text,
  cliente             text,
  fecha_inicio        date,
  filas               int not null default 0,
  columnas            int not null default 0,
  fuente_actualizada  timestamptz,
  leido               timestamptz not null default now()
);
create table if not exists busqueda_columnas (
  id                  uuid primary key default gen_random_uuid(),
  tablero_id          text not null references busqueda_tableros(tablero_id) on delete cascade,
  columna_id          text not null,
  nombre              text not null,
  nombre_norm         text not null,
  respondieron        int not null default 0,
  distintos           int not null default 0,
  modo                text not null default 'valores',
  unique (tablero_id, columna_id)
);
create table if not exists busqueda_piezas (
  columna             uuid not null references busqueda_columnas(id) on delete cascade,
  pieza               text not null,
  etiqueta            text,
  filas               int not null,
  primero             int,
  primary key (columna, pieza)
);
create table if not exists busquedas_guardadas (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  descripcion         text,
  criterios           jsonb not null default '[]'::jsonb,
  resultado           jsonb,
  resultado_en        timestamptz,
  creada_por          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
`;

/** Si el error es «la tabla no existe» (todavía no se corrió add-busqueda-tables.ts), lo dice en palabras; cualquier otro error sigue su camino. */
export function traducirFaltaTablasBusqueda(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e?.code === '42P01' || /relation "busqueda_\w+" does not exist|relation "busquedas_guardadas" does not exist/i.test(e?.message ?? '')) {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Todavía no existen las tablas del buscador de gente. Hay que crearlas primero (add-busqueda-tables.ts).' });
  }
  throw err;
}
