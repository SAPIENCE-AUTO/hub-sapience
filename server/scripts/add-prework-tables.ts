// Crea las tablas del módulo "Prework" (misiones/diario programado para
// participantes). Igual que Swipe (add-swipe-tables.ts) y la Sala de
// observación (add-observation-room-tables.ts), estas NUNCA existieron en
// Zite — viven fuera del pipeline de generate.py / export-zite-schema.json /
// schema.sql a propósito, en un script aparte que se corre una vez a mano.
//
// Como no entran al sistema de 41 modelos generados (server/compat/index.ts),
// los endpoints les hablan con `pool.query(...)` crudo en vez de un modelo.
// La única tabla generada que tocan (por FK lógica, sin modificarla) es
// `projects` y, opcionalmente, `recruitment_rows` — de ahí sale el
// participante cuando se le vincula a una fila de reclutamiento real.
//
// Idempotente (create table/index if not exists) para poder correrlo más de
// una vez sin romper nada.
//
// Uso: npx tsx --env-file=../.env add-prework-tables.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

// max: 1 — script de una sola pasada; el pooler de Supabase (session mode)
// limita a 15 clientes total y el dev server ya viene usando varios.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

async function main() {
  await pool.query(`
    -- Activación por proyecto. Vive en tabla propia (no una columna en
    -- "projects") a propósito: "projects" es una tabla generada por
    -- generate.py a partir del export de Zite y no se edita a mano — mismo
    -- criterio que "home_page" en server/auth.ts.
    create table if not exists prework_config (
      id                    uuid primary key default gen_random_uuid(),
      proyecto_id           uuid not null unique references projects(id) on delete cascade,
      activo                boolean not null default false,
      fecha_inicio_estudio  date,
      created_by            uuid references users(id) on delete set null,
      created_at            timestamptz not null default now(),
      updated_at            timestamptz not null default now()
    );

    -- Identidad global del participante (paralelo a la tabla "Participants"
    -- de Zite, pero con credenciales propias — un participante puede estar
    -- en el prework de más de un proyecto con la misma cuenta).
    create table if not exists prework_participantes (
      id             uuid primary key default gen_random_uuid(),
      email          text not null unique,
      password_hash  text not null,
      password_salt  text not null,
      nombre         text not null,
      telefono       text,
      created_at     timestamptz not null default now()
    );
    create unique index if not exists prework_participantes_email_lower_idx
      on prework_participantes (lower(email));

    -- Quién participa en qué proyecto. Aquí vive el include/exclude
    -- ("en teoría son los asignados a grupos en reclutamiento, pero debemos
    -- poder seleccionar a quiénes sí/no se les manda prework") y el status
    -- de participación que pide el moderador.
    create table if not exists prework_asignaciones (
      id                     uuid primary key default gen_random_uuid(),
      prework_participante_id uuid not null references prework_participantes(id) on delete cascade,
      proyecto_id            uuid not null references projects(id) on delete cascade,
      recruitment_row_id     uuid references recruitment_rows(id) on delete set null,
      incluido               boolean not null default true,
      estado_participacion   text not null default 'activo'
        constraint prework_asignaciones_estado_chk
        check (estado_participacion in ('activo', 'pausado', 'completado', 'abandono')),
      invitado_at            timestamptz,
      created_at             timestamptz not null default now(),
      unique (prework_participante_id, proyecto_id)
    );
    create index if not exists prework_asignaciones_proyecto_id_idx on prework_asignaciones (proyecto_id);

    -- Plantilla de misión/tarea. "configuracion" y, en las respuestas,
    -- "contenido" son jsonb porque el shape cambia por tipo (12 tipos hoy:
    -- foto, video, texto, matching, swipe, voto, reaccion, nota_voz,
    -- encuesta, ranking, reaccion_estimulo, heatmap, dibujar) — meterlos en
    -- columnas propias hubiera significado una migración por cada tipo nuevo.
    create table if not exists prework_misiones (
      id                uuid primary key default gen_random_uuid(),
      proyecto_id       uuid not null references projects(id) on delete cascade,
      titulo            text not null,
      descripcion       text,
      tipo              text not null
        constraint prework_misiones_tipo_chk
        check (tipo in ('foto', 'video', 'texto', 'matching', 'swipe', 'voto', 'reaccion',
                         'nota_voz', 'encuesta', 'ranking', 'reaccion_estimulo', 'heatmap', 'dibujar')),
      configuracion     jsonb not null default '{}'::jsonb,
      visibilidad       text not null default 'privada'
        constraint prework_misiones_visibilidad_chk
        check (visibilidad in ('privada', 'social')),
      fecha_lanzamiento date not null,
      orden             int not null default 0,
      estado            text not null default 'borrador'
        constraint prework_misiones_estado_chk
        check (estado in ('borrador', 'publicada', 'archivada')),
      created_by        uuid references users(id) on delete set null,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now()
    );
    create index if not exists prework_misiones_proyecto_fecha_idx
      on prework_misiones (proyecto_id, fecha_lanzamiento);

    -- Entregas del participante. Sin unique en (mision_id,
    -- prework_participante_id) a propósito: una misión tipo diario acepta
    -- varias entregas del mismo participante a lo largo del estudio.
    create table if not exists prework_respuestas (
      id                          uuid primary key default gen_random_uuid(),
      mision_id                   uuid not null references prework_misiones(id) on delete cascade,
      prework_participante_id     uuid not null references prework_participantes(id) on delete cascade,
      proyecto_id                 uuid not null references projects(id) on delete cascade,
      contenido                   jsonb not null default '{}'::jsonb,
      archivos                    jsonb not null default '[]'::jsonb,
      estado                      text not null default 'pendiente'
        constraint prework_respuestas_estado_chk
        check (estado in ('pendiente', 'entregada', 'revisada')),
      transcripcion               text,
      transcripcion_generada_at   timestamptz,
      analisis_ai                 jsonb,
      entregada_at                timestamptz,
      created_at                  timestamptz not null default now(),
      updated_at                  timestamptz not null default now()
    );
    create index if not exists prework_respuestas_mision_id_idx on prework_respuestas (mision_id);
    create index if not exists prework_respuestas_participante_id_idx on prework_respuestas (prework_participante_id);

    -- Capa social: solo aplica a respuestas de misiones con visibilidad
    -- 'social'. Se valida en el endpoint, no con un constraint cruzado.
    create table if not exists prework_reacciones (
      id                       uuid primary key default gen_random_uuid(),
      respuesta_id             uuid not null references prework_respuestas(id) on delete cascade,
      prework_participante_id  uuid not null references prework_participantes(id) on delete cascade,
      tipo                     text not null,
      comentario               text,
      created_at               timestamptz not null default now()
    );
    create index if not exists prework_reacciones_respuesta_id_idx on prework_reacciones (respuesta_id);

    -- Follow-ups del moderador al participante. mision_id nullable: puede
    -- ser un seguimiento general, no atado a una entrega puntual.
    create table if not exists prework_seguimientos (
      id                       uuid primary key default gen_random_uuid(),
      proyecto_id              uuid not null references projects(id) on delete cascade,
      prework_participante_id  uuid not null references prework_participantes(id) on delete cascade,
      mision_id                uuid references prework_misiones(id) on delete set null,
      mensaje                  text not null,
      creado_por               uuid references users(id) on delete set null,
      leido                    boolean not null default false,
      respuesta_participante   text,
      created_at               timestamptz not null default now(),
      updated_at               timestamptz not null default now()
    );
    create index if not exists prework_seguimientos_participante_id_idx
      on prework_seguimientos (prework_participante_id);

    -- Taxonomía de tags. proyecto_id nullable = tag global reusable entre
    -- proyectos; con proyecto_id = tag específico de ese estudio.
    create table if not exists prework_tags (
      id           uuid primary key default gen_random_uuid(),
      proyecto_id  uuid references projects(id) on delete cascade,
      nombre       text not null,
      color        text,
      created_at   timestamptz not null default now()
    );

    create table if not exists prework_respuesta_tags (
      respuesta_id  uuid not null references prework_respuestas(id) on delete cascade,
      tag_id        uuid not null references prework_tags(id) on delete cascade,
      created_at    timestamptz not null default now(),
      primary key (respuesta_id, tag_id)
    );

    -- Control de recordatorios ya enviados (server/scripts/send-prework-reminders.ts)
    -- para que correr el script más de una vez el mismo día no duplique correos.
    create table if not exists prework_recordatorios_enviados (
      mision_id                uuid not null references prework_misiones(id) on delete cascade,
      prework_participante_id  uuid not null references prework_participantes(id) on delete cascade,
      enviado_at               timestamptz not null default now(),
      primary key (mision_id, prework_participante_id)
    );
  `);

  // Programación relativa al inicio de cada participante (cohortes
  // escalonadas: quien arranca hoy y quien arranca pasado mañana hacen la
  // misma secuencia "Día 1, Día 2..." mecionada a partir de su propia fecha
  // de inicio, no de una fecha fija del proyecto). ALTER separado del
  // create table de arriba porque las tablas ya existían en producción —
  // "add column if not exists" es idempotente, la constraint se recrea con
  // drop+add porque Postgres no tiene "add constraint if not exists".
  await pool.query(`
    alter table prework_misiones alter column fecha_lanzamiento drop not null;
    alter table prework_misiones add column if not exists modo_programacion text not null default 'fecha_fija';
    alter table prework_misiones add column if not exists dia_relativo int;

    alter table prework_misiones drop constraint if exists prework_misiones_modo_programacion_chk;
    alter table prework_misiones add constraint prework_misiones_modo_programacion_chk
      check (modo_programacion in ('fecha_fija', 'relativo_inicio'));

    alter table prework_misiones drop constraint if exists prework_misiones_programacion_consistente_chk;
    alter table prework_misiones add constraint prework_misiones_programacion_consistente_chk
      check (
        (modo_programacion = 'fecha_fija' and fecha_lanzamiento is not null)
        or (modo_programacion = 'relativo_inicio' and dia_relativo is not null and dia_relativo >= 1)
      );

    -- "Día 1" personal de cada participante en este proyecto — null hasta
    -- que hace login por primera vez (ver preworkLogin.ts, que lo estampa
    -- con la fecha de México de ese momento). No se ofrece como campo
    -- editable por el moderador a propósito, arranca solo.
    alter table prework_asignaciones add column if not exists fecha_inicio date;
  `);

  // Varios "Prework" (estudios) por proyecto, cada uno con su propio nombre,
  // participantes y misiones — antes era uno solo por proyecto
  // (prework_config, unique(proyecto_id)). prework_config pasa a llamarse
  // prework_estudios: una fila = un estudio, ya no "la config del proyecto".
  // Migración con backfill (no destructiva): los proyectos que ya tenían
  // Prework activado quedan con su único estudio existente, renombrado
  // "Prework" por default — sin esto se hubiera perdido la relación de las
  // asignaciones/misiones/etc. que ya usaban proyecto_id directo.
  await pool.query(`
    alter table prework_config add column if not exists nombre text;
    update prework_config set nombre = 'Prework' where nombre is null;
    alter table prework_config alter column nombre set not null;
    alter table prework_config alter column nombre set default 'Prework';
    alter table prework_config drop constraint if exists prework_config_proyecto_id_key;
    create index if not exists prework_estudios_proyecto_id_idx on prework_config (proyecto_id);
    alter table prework_config rename to prework_estudios;
  `);

  await pool.query(`
    alter table prework_asignaciones add column if not exists prework_estudio_id uuid references prework_estudios(id) on delete cascade;
    update prework_asignaciones a set prework_estudio_id = e.id
      from prework_estudios e
      where e.proyecto_id = a.proyecto_id and a.prework_estudio_id is null;
    alter table prework_asignaciones alter column prework_estudio_id set not null;
    alter table prework_asignaciones drop constraint if exists prework_asignaciones_prework_participante_id_proyecto_id_key;
    alter table prework_asignaciones drop constraint if exists prework_asignaciones_participante_estudio_key;
    alter table prework_asignaciones add constraint prework_asignaciones_participante_estudio_key
      unique (prework_participante_id, prework_estudio_id);
    alter table prework_asignaciones drop constraint if exists prework_asignaciones_proyecto_id_fkey;
    alter table prework_asignaciones drop column if exists proyecto_id;
    create index if not exists prework_asignaciones_estudio_id_idx on prework_asignaciones (prework_estudio_id);
  `);

  // misiones/respuestas/seguimientos/tags: mismo patrón de backfill, aunque
  // en la práctica no tenían filas todavía en el primer despliegue de esto.
  await pool.query(`
    alter table prework_misiones add column if not exists prework_estudio_id uuid references prework_estudios(id) on delete cascade;
    update prework_misiones m set prework_estudio_id = e.id
      from prework_estudios e where e.proyecto_id = m.proyecto_id and m.prework_estudio_id is null;
    alter table prework_misiones alter column prework_estudio_id set not null;
    alter table prework_misiones drop constraint if exists prework_misiones_proyecto_id_fkey;
    alter table prework_misiones drop column if exists proyecto_id;
    drop index if exists prework_misiones_proyecto_fecha_idx;
    create index if not exists prework_misiones_estudio_fecha_idx on prework_misiones (prework_estudio_id, fecha_lanzamiento);
  `);

  await pool.query(`
    alter table prework_respuestas add column if not exists prework_estudio_id uuid references prework_estudios(id) on delete cascade;
    update prework_respuestas r set prework_estudio_id = e.id
      from prework_estudios e where e.proyecto_id = r.proyecto_id and r.prework_estudio_id is null;
    alter table prework_respuestas alter column prework_estudio_id set not null;
    alter table prework_respuestas drop constraint if exists prework_respuestas_proyecto_id_fkey;
    alter table prework_respuestas drop column if exists proyecto_id;
  `);

  await pool.query(`
    alter table prework_seguimientos add column if not exists prework_estudio_id uuid references prework_estudios(id) on delete cascade;
    update prework_seguimientos s set prework_estudio_id = e.id
      from prework_estudios e where e.proyecto_id = s.proyecto_id and s.prework_estudio_id is null;
    alter table prework_seguimientos alter column prework_estudio_id set not null;
    alter table prework_seguimientos drop constraint if exists prework_seguimientos_proyecto_id_fkey;
    alter table prework_seguimientos drop column if exists proyecto_id;
  `);

  await pool.query(`
    alter table prework_tags add column if not exists prework_estudio_id uuid references prework_estudios(id) on delete cascade;
    update prework_tags t set prework_estudio_id = e.id
      from prework_estudios e where e.proyecto_id = t.proyecto_id and t.prework_estudio_id is null;
    -- proyecto_id era nullable en tags (null = tag global reusable). No
    -- había ninguno así en producción (0 filas) — con estudios, el tag
    -- siempre pertenece a uno; retomar tags globales queda pendiente si
    -- hace falta más adelante.
    alter table prework_tags alter column prework_estudio_id set not null;
    alter table prework_tags drop constraint if exists prework_tags_proyecto_id_fkey;
    alter table prework_tags drop column if exists proyecto_id;
  `);

  console.log('✅ Tablas del módulo Prework creadas/migradas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
