// Carga el catálogo oficial de códigos postales de Correos de México en la tabla codigos_postales (la crea
// add-formularios-tables.ts). Reemplaza los de México de un jalón, en una transacción. Acepta el .txt o el
// .zip que se descarga de https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx
// (formato «Txt»). No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/cargar-codigos-postales.ts ~/Downloads/CPdescarga.zip
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pool } from '../compat/db';
import { leerCatalogoSepomex } from '../../src/serverUtils/formularios/codigosPostales';

const LOTE = 1000;

async function main() {
  const ruta = process.argv[2];
  if (!ruta) throw new Error('Falta la ruta del catálogo (CPdescarga.txt o .zip).');
  const bytes = ruta.toLowerCase().endsWith('.zip') ? execFileSync('unzip', ['-p', ruta], { maxBuffer: 100 * 1024 * 1024 }) : fs.readFileSync(ruta);
  // Correos de México lo publica en Latin-1; si viene en UTF-8, se lee así.
  const utf8 = bytes.toString('utf8');
  const texto = utf8.includes('�') ? bytes.toString('latin1') : utf8;
  const { filas, estadosDesconocidos } = leerCatalogoSepomex(texto);
  if (estadosDesconocidos.length) console.warn(`⚠ Estados con otro nombre que el del Hub: ${estadosDesconocidos.join(', ')}`);
  console.log(`${filas.length} colonias en ${new Set(filas.map((f) => f.cp)).size} códigos postales.`);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`delete from codigos_postales where pais = 'MX'`);
    for (let i = 0; i < filas.length; i += LOTE) {
      const lote = filas.slice(i, i + LOTE);
      const valores: string[] = [];
      const params: string[] = [];
      lote.forEach((f, j) => {
        const b = j * 6;
        valores.push(`('MX', $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
        params.push(f.cp, f.colonia, f.tipo, f.municipio, f.estado, f.ciudad);
      });
      await client.query(`insert into codigos_postales (pais, cp, colonia, tipo, municipio, estado, ciudad) values ${valores.join(', ')}`, params);
    }
    await client.query('commit');
    console.log('✅ Catálogo cargado.');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
