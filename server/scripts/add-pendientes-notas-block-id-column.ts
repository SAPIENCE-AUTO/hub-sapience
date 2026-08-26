import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`alter table pendientes_personales add column if not exists notas_block_id text;`);
  console.log('✅ Columna notas_block_id agregada.');

  // Migra cualquier texto ya escrito en `notas` a un document_blocks real —
  // una línea de texto por párrafo, mismo formato que usa BlockNoteDocEditor
  // para un documento vacío recién creado (schemaVersion 2).
  const { rows } = await pool.query(
    `select id, notas from pendientes_personales where notas is not null and notas <> '' and notas_block_id is null`,
  );
  console.log(`Migrando ${rows.length} pendiente(s) con notas existentes...`);

  for (const row of rows) {
    const lines: string[] = String(row.notas).split('\n');
    const blocks = lines.map(line => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line, styles: {} }] : [],
    }));
    const documentJson = JSON.stringify({ schemaVersion: 2, version: 1, blocks });

    const { rows: created } = await pool.query(
      `insert into document_blocks (block_type, document_json, created_at, updated_at)
       values ('Texto', $1, now(), now())
       returning id`,
      [documentJson],
    );
    await pool.query(`update pendientes_personales set notas_block_id = $1 where id = $2`, [created[0].id, row.id]);
    console.log(`  ✓ pendiente ${row.id} -> bloque ${created[0].id}`);
  }

  await pool.query(`alter table pendientes_personales drop column if exists notas;`);
  console.log('✅ Columna notas eliminada (reemplazada por notas_block_id).');

  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
