"""Genera schema.sql y schema-map.ts de UNA sola fuente para que no se desalineen."""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXPORT = ROOT / 'export-zite-schema.json'
d = json.load(open(EXPORT))
db = list(d['databases'].values())[0]['metadata']
tables, byid = db['tables'], {t['id']: t for t in db['tables']}
fid = {f['id']: (t, f) for t in tables for f in t['fields']}
RESERVED = {'user','order','group','default','check','references','table','column','end','all','limit','offset','role'}

# ── Decisiones tomadas sobre datos reales de Postgres, no derivables de este
# export: algunas listas de single_select que Zite fue acumulando solo no son
# enumeraciones de negocio, y dos sí les faltaban valores reales. Ver el
# historial de la migración para el detalle de cómo se encontraron.
CHECK_SKIP = {
    ('recruitment_rows', 'status'): [
        "status: sin CHECK a propósito. Zite lo registró como single_select con 92",
        "opciones, pero es texto casi libre que los reclutadores escriben en operación",
        "(typos, variantes, siglas de proyecto sueltas como '14', '56', 'QRO') — no es",
        "una enumeración real, es un log de lo que se ha escrito. No falló al cargar",
        "porque los valores existentes ya calzaban, pero el primer status nuevo que",
        "escriba un reclutador habría rebotado en producción sin explicación aparente.",
    ],
    ('board_columns', 'column_type'): [
        "column_type: sin CHECK a propósito. Zite lo registró como single_select, pero",
        "el campo mezcla tres conceptos que se fueron acumulando por separado: tipos",
        "de columna reales (Texto, Número, Select...), tipos de gráfica (chart1..chart5)",
        "y nombres de color de etiquetas de grupo (red-1..5, blue-1..5, etc). La lista de",
        "colores es la que sigue creciendo sola conforme se usan más tonos en operación",
        "(se vieron green-4, blue-4/5, purple-4, yellow-5 sin registrar) — no es una",
        "enumeración cerrada, es un log de lo que se ha usado. Un CHECK aquí persigue",
        "una lista que no para de crecer; validar el tipo de columna real, si hace",
        "falta, debe vivir en la capa de aplicación, no en la base.",
    ],
    ('purchase_orders', 'payment_terms'): [
        "payment_terms: sin CHECK a propósito. Zite lo registró como single_select con",
        "22 opciones, pero mezcla términos reales ('30 días', 'Contado') con basura de",
        "captura ('wrf', '334', 'greqt', '1') — nunca fue una enumeración validada.",
    ],
}
CHECK_EXTRA = {
    ('tasks', 'status'): ['Archivada'],
    ('projects', 'status'): ['Stand by'],
}

# Índice único agregado directamente en Supabase después de la carga inicial
# (migración `20260808172245_remote_schema.sql`), no derivable del export de
# Zite: Zite nunca impidió dos cell_values "vivas" para la misma posición
# (board_id, row_id, column_id), pero en producción se vieron duplicados reales
# ahí, así que se agregó esta unicidad parcial (excluye borrados) directo en la
# base. Se refleja aquí para que una carga desde cero (schema.sql) no quede sin
# ella, y CONFLICT_TARGETS le dice a model.ts cómo escribir CellValues como
# upsert real (INSERT ... ON CONFLICT ... DO UPDATE) en vez de INSERT liso —
# sin esto, cualquier escritura que choque con la posición viva revienta con
# "duplicate key value violates unique constraint cell_values_posicion_viva_uniq".
CONFLICT_TARGETS = {
    'CellValues': {'cols': ['board_id', 'row_id', 'column_id'], 'where': 'deleted_at is null'},
}

def snake(s):
    s = re.sub(r'[^A-Za-z0-9áéíóúñÁÉÍÓÚÑ]+', ' ', s).strip()
    s = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', s)
    return '_'.join(w.lower() for w in s.translate(str.maketrans('áéíóúñÁÉÍÓÚÑ','aeiounAEIOUN')).split())
def camel(s):
    p = snake(s).split('_'); return p[0] + ''.join(w.capitalize() for w in p[1:])
def tbl(s):
    n = snake(s); return n if n.endswith('s') else n + 's'
def model(s): return re.sub(r'[^A-Za-z]', '', s)
def q(c): return f'"{c}"'

# ── relaciones ───────────────────────────────────────────────────────────
fks, m2m, inverse, seen = {}, {}, set(), set()
for t in tables:
    for f in t['fields']:
        if f['type'] != 'linked_record': continue
        tpl = f['template']; inv = tpl.get('inverseFieldId')
        key = tuple(sorted([f['id'], inv or f['id']]))
        if key in seen: continue
        seen.add(key)
        o = fid.get(inv)
        if tpl.get('isInverse') and o: owner, of = o; other = (t, f)
        else: owner, of = t, f; other = o if o else (None, None)
        if other[1]: inverse.add(other[1]['id'])
        tgt = byid.get(of['template']['tableId'])
        if not tgt: continue
        a = of['template'].get('allowMultiple', False)
        b = other[1]['template'].get('allowMultiple', False) if other[1] else False
        if a and b:
            m2m[of['id']] = dict(owner=owner, target=tgt, field=of, prop=camel(of['name']),
                join=f"{snake(owner['name'])}_{snake(of['name'])}",
                selfCol=(snake(owner['name'])[:-1] if owner['name'].endswith('s') else snake(owner['name'])) + '_id',
                otherCol=(snake(tgt['name'])[:-1] if tgt['name'].endswith('s') else snake(tgt['name'])) + '_id')
        else:
            fks.setdefault(owner['id'], {})[of['id']] = dict(prop=camel(of['name']), col=snake(of['name']) + '_id', target=tgt)

PG = {'single_line_text':'text','long_text':'text','rich_text':'text','email':'text','url':'text',
'phone_number':'text','single_select':'text','multiple_select':'text[]','number':'numeric',
'percent':'numeric(6,4)','currency':'numeric(14,2)','date':'date','datetime':'timestamptz',
'checkbox':'boolean','attachments':'jsonb','autonumber':'bigint','created_at':'timestamptz','updated_at':'timestamptz'}
KIND = {'single_line_text':'text','long_text':'text','rich_text':'text','email':'text','url':'text',
'phone_number':'text','single_select':'text','multiple_select':'array','number':'number','percent':'number',
'currency':'number','date':'date','datetime':'datetime','checkbox':'boolean','attachments':'json',
'autonumber':'number','created_at':'datetime','updated_at':'datetime'}

# ── construir la definición canónica de cada tabla ───────────────────────
canon = {}   # model -> {table, cols:[(prop,col,pgtype,kind,extra)], checks:[], fkcols:[]}
for t in tables:
    T, cols, checks, notes = tbl(t['name']), [], [], []
    used = set()
    def add(prop, col, pg, kind, extra=None):
        if col in used: return          # comparación EXACTA de nombre de columna
        used.add(col); cols.append(dict(prop=prop, col=col, pg=pg, kind=kind, extra=extra))
    add('id', 'id', 'uuid', 'text', 'pk')
    for f in sorted(t['fields'], key=lambda x: x.get('order', 0)):
        if f['type'] == 'linked_record':
            if f['id'] in inverse: continue
            k = fks.get(t['id'], {}).get(f['id'])
            if k: add(k['prop'], k['col'], 'uuid', 'link', dict(target=tbl(k['target']['name'])))
            continue
        col, ty = snake(f['name']), f['type']
        add(camel(f['name']), col, PG.get(ty, 'text'), KIND.get(ty, 'text'),
            'identity' if ty == 'autonumber' else ('now' if ty in ('created_at','updated_at') else None))
        opts = [o['label'] for o in (f.get('template') or {}).get('options', [])]
        if opts and ty == 'single_select':
            skip = CHECK_SKIP.get((T, col))
            if skip:
                notes.append("\n".join(f"-- {line}" for line in skip))
            else:
                allopts = opts + CHECK_EXTRA.get((T, col), [])
                v = ", ".join("'" + o.replace("'", "''") + "'" for o in allopts)
                checks.append(f"  constraint {T}_{col}_chk check ({q(col)} is null or {q(col)} in ({v}))")
        elif opts and ty == 'multiple_select':
            v = ", ".join("'" + o.replace("'", "''") + "'" for o in opts)
            checks.append(f"  constraint {T}_{col}_chk check ({q(col)} is null or {q(col)} <@ array[{v}]::text[])")
    add('createdAt', 'created_at', 'timestamptz', 'datetime', 'now')
    add('updatedAt', 'updated_at', 'timestamptz', 'datetime', 'now')
    many = {mm['prop']: mm for mm in m2m.values() if mm['owner']['id'] == t['id']}
    canon[model(t['name'])] = dict(table=T, cols=cols, checks=checks, notes=notes, many=many, name=t['name'])

# ── orden topológico ────────────────────────────────────────────────────
order, left = [], list(canon.items())
while left:
    prog = False
    done = {v['table'] for _, v in order}
    for item in list(left):
        deps = {c['extra']['target'] for c in item[1]['cols'] if c['kind'] == 'link'} - {item[1]['table']}
        if deps <= done: order.append(item); left.remove(item); prog = True
    if not prog: order += left; break

# ── emitir SQL ──────────────────────────────────────────────────────────
S = ["""-- ============================================================================
--  Hub Sapience — esquema Postgres  (base "Operations Hub", 41 tablas)
--  GENERADO por generate.py desde el export de Zite. No editar a mano:
--  este archivo y compat/schema-map.ts salen de la misma fuente a propósito,
--  para que el DDL y el mapeo de la capa de compatibilidad no se desalineen.
--
--  Decisiones:
--   · PK uuid con gen_random_uuid() (nativo desde PG 13, no requiere pgcrypto).
--   · single_select → text + CHECK, no enum: alterar un CHECK es trivial,
--     alterar un enum no, y estas opciones cambian en operación.
--   · currency → numeric(14,2) uniforme. En Zite varias tenían decimalPlaces 0,
--     pero era formato de despliegue; truncar centavos en finanzas es un bug.
--   · linked_record: la FK vive SOLO en el lado que define la relación.
--     Los lados inversos autogenerados por Zite no producen columna.
--   · Índices derivados de los filtros reales de los 207 endpoints.
-- ============================================================================

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
"""]
for mname, c in order:
    S.append(f"\n-- ─── {c['name']} " + "─" * max(1, 58 - len(c['name'])))
    lines = []
    for col in c['cols']:
        name = q(col['col']) if col['col'] in RESERVED else col['col']
        if col['extra'] == 'pk': lines.append(f"  {name:<29} uuid primary key default gen_random_uuid()")
        elif col['extra'] == 'identity': lines.append(f"  {name:<29} bigint generated by default as identity")
        elif col['extra'] == 'now': lines.append(f"  {name:<29} timestamptz not null default now()")
        elif col['kind'] == 'link': lines.append(f"  {name:<29} uuid references {col['extra']['target']}(id) on delete set null")
        else: lines.append(f"  {name:<29} {col['pg']}")
    S.append(f"create table {c['table']} (")
    S.append(",\n".join(lines + c['checks']))
    S.append(");")
    S.append(f"create trigger {c['table']}_set_updated before update on {c['table']} for each row execute function set_updated_at();")
    for note in c['notes']:
        S.append(note)

S.append("\n\n-- ═══ Relaciones N-N ═══════════════════════════════════════════")
S.append("-- Los tres roles de equipo de un proyecto. En Zite eran los campos")
S.append('-- Users."Projects (1)(2)(3)", nombres autogenerados sin significado.')
for mm in m2m.values():
    S.append(f"\n-- {mm['owner']['name']}.{mm['field']['name']} ↔ {mm['target']['name']}")
    S.append(f"create table {mm['join']} (")
    S.append(f"  {mm['selfCol']:<29} uuid not null references {tbl(mm['owner']['name'])}(id) on delete cascade,")
    S.append(f"  {mm['otherCol']:<29} uuid not null references {tbl(mm['target']['name'])}(id) on delete cascade,")
    S.append(f"  {'created_at':<29} timestamptz not null default now(),")
    S.append(f"  primary key ({mm['selfCol']}, {mm['otherCol']})")
    S.append(");")

S.append("""

-- ═══ Índices ══════════════════════════════════════════════════════
-- Derivados de los filtros que ejecutan los 207 endpoints, no de suposiciones.
-- board_columns.board_id se filtra en 102 lugares; cell_values.board_id en 56.

create index on board_columns (board_id);
create index on board_columns (column_type);
create index on cell_values (board_id);
create index on cell_values (row_id);
create index on cell_values (board_id, row_id, column_id);
-- Unicidad parcial real de producción (ver comentario de CONFLICT_TARGETS arriba
-- en este archivo) — no proviene del export de Zite, se agregó directo en
-- Supabase tras encontrar celdas duplicadas vivas para la misma posición.
create unique index cell_values_posicion_viva_uniq on cell_values (board_id, row_id, column_id) where deleted_at is null;
create index on boards (project_code);
create index on boards (board_name);
create index on boards (board_type);
create index on recruitment_rows (project_code);
create index on recruitment_rows (phone);
create index on recruitment_rows (email);
create index on projects (project_code);
create index on tasks (project_code);
create index on calendar_events (project_code);
create index on purchase_orders (project_code);
create index on purchase_orders (status);
create index on expenses (status);
create index on payments (status);
create index on supplier_invoices (status);
-- Parcial, no un unique index simple: Zite representa "sin token" como "" (no
-- NULL), y a diferencia de NULL, Postgres exige que los strings vacíos sean
-- únicos entre sí. Con un índice simple, la primera fila sin token bloquea a
-- las demás (se vio en vivo: 250 de 462 Shared Views rechazadas por esto).
create unique index shared_views_token_uniq on shared_views (token) where token is not null and token <> '';
create unique index on users (lower(email));

-- El código filtra participantes con `contains`, que en Postgres es
-- ILIKE '%…%' y no aprovecha un btree. Requiere trigram.
create extension if not exists pg_trgm;
create index on recruitment_rows using gin (participant_name gin_trgm_ops);

-- REVISAR: project_code se usa como llave de negocio en 6 tablas pero es text
-- suelto, sin FK a projects. Decidir si se normaliza a project_id (recomendado)
-- o se deja denormalizado con FK a projects(project_code) unique.""")
(ROOT / 'schema.sql').write_text("\n".join(S), encoding='utf-8')

# ── emitir schema-map.ts ────────────────────────────────────────────────
M = ["// GENERADO por generate.py. No editar a mano.",
"// Sale de la MISMA fuente que schema.sql, así que columnas y mapeo no se desalinean.", "",
"export type FieldKind = 'text'|'number'|'boolean'|'date'|'datetime'|'json'|'array'|'link'|'linkMany';", "",
"export interface FieldDef { col: string; kind: FieldKind; target?: string; join?: string; selfCol?: string; otherCol?: string }",
"export interface ConflictTarget { cols: string[]; where?: string }",
"export interface TableDef { table: string; fields: Record<string, FieldDef>; conflictTarget?: ConflictTarget }", "",
"export const SCHEMA: Record<string, TableDef> = {"]
for mname, c in canon.items():
    M.append(f"  {mname}: {{")
    M.append(f"    table: '{c['table']}',")
    if mname in CONFLICT_TARGETS:
        ct = CONFLICT_TARGETS[mname]
        cols_lit = ", ".join(f"'{col}'" for col in ct['cols'])
        where_lit = f", where: '{ct['where']}'" if ct.get('where') else ''
        M.append(f"    conflictTarget: {{ cols: [{cols_lit}]{where_lit} }},")
    M.append("    fields: {")
    fl = []
    for col in c['cols']:
        if col['kind'] == 'link':
            fl.append(f"      {col['prop']}: {{ col: '{col['col']}', kind: 'link', target: '{col['extra']['target']}' }}")
        else:
            fl.append(f"      {col['prop']}: {{ col: '{col['col']}', kind: '{col['kind']}' }}")
    for prop, mm in c['many'].items():
        fl.append(f"      {prop}: {{ col: '{prop}', kind: 'linkMany', join: '{mm['join']}', selfCol: '{mm['selfCol']}', otherCol: '{mm['otherCol']}' }}")
    M.append(",\n".join(fl))
    M.append("    },")
    M.append("  },")
M.append("};")
M.append("")
M.append("export const MODEL_NAMES = Object.keys(SCHEMA) as (keyof typeof SCHEMA)[];")
(ROOT / 'server' / 'compat' / 'schema-map.ts').write_text("\n".join(M), encoding='utf-8')

# ── emitir types.ts ─────────────────────────────────────────────────────
TS = {'text':'string','number':'number','boolean':'boolean','date':'string','datetime':'string','json':'any','array':'string[]','link':'string[]','linkMany':'string[]'}
Y = ["// GENERADO por generate.py. Equivalente a los *RecordType del SDK de Zite.",
"// Los campos link se exponen como string[] (arreglo de IDs), igual que en Zite.", ""]
for mname, c in canon.items():
    Y.append(f"export interface {mname}RecordType {{")
    for col in c['cols']:
        Y.append(f"  {col['prop']}{'' if col['prop'] == 'id' else '?'}: {TS[col['kind']]};")
    for prop in c['many']:
        Y.append(f"  {prop}?: string[];")
    Y.append("}"); Y.append("")
(ROOT / 'server' / 'compat' / 'types.ts').write_text("\n".join(Y), encoding='utf-8')

print(f"✅ generado de una sola fuente")
print(f"   schema.sql · schema-map.ts · types.ts")
print(f"   {len(canon)} tablas · {sum(len(v) for v in fks.values())} FKs · {len(m2m)} puentes")
