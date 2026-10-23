import { pool } from '../../../server/compat';
import { PAISES } from '../../lib/formularios/paises';

// Códigos postales para la dirección del participante: con el código postal se llenan el estado y el
// municipio y se elige la colonia de una lista. En México, del catálogo oficial de Correos de México
// (CPdescarga.txt), que carga scripts/cargar-codigos-postales.ts en la tabla codigos_postales.

export interface FilaCp { cp: string; colonia: string; tipo: string; municipio: string; estado: string; ciudad: string }

/** Cómo llama Correos de México a los estados que en el Hub van con su nombre corto (paises.ts). */
const ESTADOS_SEPOMEX: Record<string, string> = {
  'México': 'Estado de México',
  'Coahuila de Zaragoza': 'Coahuila',
  'Michoacán de Ocampo': 'Michoacán',
  'Veracruz de Ignacio de la Llave': 'Veracruz',
};

/**
 * Lee el catálogo de Correos de México en texto (columnas separadas por «|»,
 * la primera línea es una nota y la segunda los encabezados: d_codigo,
 * d_asenta, d_tipo_asenta, D_mnpio, d_estado, d_ciudad…). Los estados quedan
 * con el nombre de la lista del Hub.
 */
export function leerCatalogoSepomex(texto: string): { filas: FilaCp[]; estadosDesconocidos: string[] } {
  const lineas = texto.split(/\r?\n/);
  const i = lineas.findIndex((l) => l.startsWith('d_codigo|'));
  if (i < 0) throw new Error('No parece el catálogo de Correos de México: falta la línea de encabezados (d_codigo|d_asenta|…).');
  const columnas = lineas[i].split('|').map((c) => c.trim().toLowerCase());
  const col = (nombre: string) => {
    const j = columnas.indexOf(nombre);
    if (j < 0) throw new Error(`Al catálogo le falta la columna ${nombre}.`);
    return j;
  };
  const [cCp, cAsenta, cTipo, cMun, cEdo, cCiudad] = ['d_codigo', 'd_asenta', 'd_tipo_asenta', 'd_mnpio', 'd_estado', 'd_ciudad'].map(col);
  const lista = PAISES.MX.estados ?? [];
  const desconocidos = new Set<string>();
  const filas: FilaCp[] = [];
  for (const l of lineas.slice(i + 1)) {
    if (!l.trim()) continue;
    const x = l.split('|');
    const original = (x[cEdo] ?? '').trim();
    const estado = ESTADOS_SEPOMEX[original] ?? original;
    if (estado && !lista.includes(estado)) desconocidos.add(original);
    filas.push({
      cp: (x[cCp] ?? '').trim().padStart(5, '0'),
      colonia: (x[cAsenta] ?? '').trim(),
      tipo: (x[cTipo] ?? '').trim(),
      municipio: (x[cMun] ?? '').trim(),
      estado,
      ciudad: (x[cCiudad] ?? '').trim(),
    });
  }
  return { filas: filas.filter((f) => /^\d{5}$/.test(f.cp) && f.colonia), estadosDesconocidos: [...desconocidos] };
}

/** `catalogo: false`: el país todavía no tiene catálogo cargado (la dirección se escribe a mano, sin avisar nada). */
export interface CodigoPostal { encontrado: boolean; catalogo: boolean; estado?: string; municipio?: string; colonias: string[] }

/** Si el país ya tiene catálogo, recordado unos minutos (cargarlo es raro). */
const conCatalogo = new Map<string, { si: boolean; hasta: number }>();
async function hayCatalogo(pais: string): Promise<boolean> {
  const ya = conCatalogo.get(pais);
  if (ya && ya.hasta > Date.now()) return ya.si;
  const { rows: [r] } = await pool.query(`select exists (select 1 from codigos_postales where pais = $1) as si`, [pais]);
  conCatalogo.set(pais, { si: !!r.si, hasta: Date.now() + 10 * 60_000 });
  return !!r.si;
}

/** Estado, municipio y colonias de un código postal. */
export async function buscarCodigoPostal(pais: string, cp: string): Promise<CodigoPostal> {
  try {
    const { rows } = await pool.query(
      `select colonia, municipio, estado from codigos_postales where pais = $1 and cp = $2`,
      [pais, cp],
    );
    if (!rows.length) return { encontrado: false, catalogo: await hayCatalogo(pais), colonias: [] };
    // Casi siempre un código postal es de un solo municipio; si no, el que más colonias tiene.
    const cuenta = new Map<string, number>();
    for (const r of rows) cuenta.set(`${r.municipio}|${r.estado}`, (cuenta.get(`${r.municipio}|${r.estado}`) ?? 0) + 1);
    const [municipio, estado] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0].split('|');
    const colonias = [...new Set(rows.map((r) => r.colonia as string))].sort((a, b) => a.localeCompare(b, 'es'));
    return { encontrado: true, catalogo: true, estado, municipio, colonias };
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') return { encontrado: false, catalogo: false, colonias: [] }; // la tabla aún no existe
    throw err;
  }
}
