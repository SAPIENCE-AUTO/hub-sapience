// Borra en Mux los live streams de sesiones de la Sala de observación que
// llevan más de 30 días como 'terminada' (ver CLAUDE (1).md, "Limpieza").
// Los assets grabados sobreviven al borrado del stream — solo se limpia
// mux_live_stream_id, nunca mux_asset_id.
//
// No hay cron en este repo hoy: correr a mano cada tanto, o programarlo como
// Render Cron Job / GitHub Action apuntando a este script — es una decisión
// de infraestructura, no de código, y queda pendiente de esa elección.
//
// Uso: npx tsx --env-file=../.env cleanup-old-observation-streams.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
if (!process.env.ZITE_MUX_TOKEN_ID || !process.env.ZITE_MUX_TOKEN_SECRET) {
  console.error('Falta ZITE_MUX_TOKEN_ID/ZITE_MUX_TOKEN_SECRET.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function deleteLiveStream(liveStreamId: string): Promise<void> {
  const tokenId = process.env.ZITE_MUX_TOKEN_ID!;
  const tokenSecret = process.env.ZITE_MUX_TOKEN_SECRET!;
  const auth = Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');
  const res = await fetch(`https://api.mux.com/video/v1/live-streams/${encodeURIComponent(liveStreamId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Basic ${auth}` },
  });
  // 404: ya no existe en Mux (borrado a mano o en una corrida anterior) — no es error.
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Mux respondió ${res.status}: ${detail.slice(0, 200)}`);
  }
}

async function main() {
  const { rows } = await pool.query(
    `select id, mux_live_stream_id from observation_sessions
     where estado = 'terminada' and mux_live_stream_id is not null and ended_at < now() - interval '30 days'`,
  );

  console.log(`${rows.length} sesión(es) terminadas hace más de 30 días con stream por limpiar.`);

  for (const row of rows) {
    try {
      await deleteLiveStream(row.mux_live_stream_id);
      await pool.query(`update observation_sessions set mux_live_stream_id = null where id = $1`, [row.id]);
      console.log(`✅ ${row.id} — stream ${row.mux_live_stream_id} borrado`);
    } catch (err) {
      console.error(`❌ ${row.id} — ${(err as Error).message}`);
    }
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
