import { pool, ZiteError } from '../../../server/compat';
import { PAISES } from '../../lib/formularios/paises';
import type { CampoDireccion } from '../../lib/formularios/tipos';

// «Busca tu dirección» del formulario del participante, con Google Places (New): sugerencias mientras
// escribe y, al elegir una, sus partes (calle, número, colonia, municipio, estado, código postal). La llave
// es la de mapas del Hub (ZITE_GOOGLE_MAPS_API_KEY) y nunca llega al navegador. Cada búsqueda va con un
// token de sesión: las sugerencias y la dirección elegida se cobran como una sola sesión (tarifa Essentials:
// solo se piden addressComponents y formattedAddress). Si Google no responde (sin llave, servicio apagado),
// la dirección se escribe a mano.

const AUTOCOMPLETAR = 'https://places.googleapis.com/v1/places:autocomplete';
const DETALLE = 'https://places.googleapis.com/v1/places/';
const llave = () => process.env.ZITE_GOOGLE_MAPS_API_KEY;

/** Topes para que nadie use el buscador (que cuesta) fuera de un filtro: por sesión y por filtro, por hora. */
const POR_SESION = 40;
const POR_FILTRO_HORA = 3000;
const usos = new Map<string, { n: number; hasta: number }>();
function contar(clave: string, tope: number, ms: number): boolean {
  const ahora = Date.now();
  const u = usos.get(clave);
  if (!u || u.hasta < ahora) { usos.set(clave, { n: 1, hasta: ahora + ms }); return true; }
  if (u.n >= tope) return false;
  u.n += 1;
  return true;
}

/** País del filtro, si se puede contestar (prueba o en vivo) o lo ve alguien del Hub; recordado un minuto. */
const filtros = new Map<string, { pais: string; abierto: boolean; hasta: number }>();
async function paisDelFiltro(codigo: string, delHub: boolean): Promise<string> {
  let f = filtros.get(codigo);
  if (!f || f.hasta < Date.now()) {
    const { rows: [r] } = await pool.query(`select estado, definicion->>'pais' as pais from formularios where codigo = $1`, [codigo]);
    f = { pais: r?.pais || 'MX', abierto: !!r && ['prueba', 'en_vivo'].includes(r.estado), hasta: Date.now() + 60_000 };
    if (r) filtros.set(codigo, f);
    else throw new ZiteError({ code: 'NOT_FOUND', message: 'No se encontró el formulario.' });
  }
  if (!f.abierto && !delHub) throw new ZiteError({ code: 'FORBIDDEN', message: 'Este formulario no está abierto.' });
  return f.pais;
}

let avisado = false;
async function google<T>(url: string, init: RequestInit): Promise<T | null> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': llave()!, ...init.headers } });
  if (r.ok) return r.json() as Promise<T>;
  // Una vez basta en el registro: suele ser el servicio apagado en la consola de Google Cloud.
  if (!avisado) { avisado = true; console.error(`[filtros] Google Places respondió ${r.status}: ${(await r.text()).slice(0, 300)}`); }
  return null;
}

export interface Sugerencia { id: string; principal: string; secundario: string }

export async function sugerirDirecciones(o: { codigo: string; sesion: string; texto: string; delHub: boolean }): Promise<{ disponible: boolean; sugerencias: Sugerencia[] }> {
  if (!llave()) return { disponible: false, sugerencias: [] };
  const pais = await paisDelFiltro(o.codigo, o.delHub);
  const texto = o.texto.trim();
  if (texto.length < 3) return { disponible: true, sugerencias: [] };
  if (!contar(`s:${o.sesion}`, POR_SESION, 3_600_000) || !contar(`f:${o.codigo}`, POR_FILTRO_HORA, 3_600_000)) return { disponible: true, sugerencias: [] };
  const region = pais.toLowerCase();
  const r = await google<{ suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[] }>(
    AUTOCOMPLETAR,
    { method: 'POST', body: JSON.stringify({ input: texto, sessionToken: o.sesion, includedRegionCodes: [region], regionCode: region, languageCode: 'es' }) },
  );
  if (!r) return { disponible: false, sugerencias: [] };
  const sugerencias = (r.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p?.placeId) return [];
    return [{ id: p.placeId, principal: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '', secundario: p.structuredFormat?.secondaryText?.text ?? '' }];
  });
  return { disponible: true, sugerencias };
}

interface Componente { longText?: string; shortText?: string; types?: string[] }

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').trim();
/** Cómo puede venir de Google un estado de México que en el Hub tiene otro nombre. */
const ESTADOS_GOOGLE: Record<string, string> = {
  cdmx: 'Ciudad de México', 'distrito federal': 'Ciudad de México', df: 'Ciudad de México',
  mexico: 'Estado de México', 'edo mex': 'Estado de México', mex: 'Estado de México', 'estado de mexico': 'Estado de México',
  'coahuila de zaragoza': 'Coahuila', coah: 'Coahuila', 'michoacan de ocampo': 'Michoacán', mich: 'Michoacán',
  'veracruz de ignacio de la llave': 'Veracruz', ver: 'Veracruz', 'nl': 'Nuevo León', 'qroo': 'Quintana Roo', 'bc': 'Baja California', 'bcs': 'Baja California Sur',
};
function estadoDelPais(componente: Componente | undefined, pais: string): string | undefined {
  if (!componente) return undefined;
  const lista = PAISES[pais]?.estados;
  if (!lista) return componente.longText;
  for (const t of [componente.longText, componente.shortText]) {
    if (!t) continue;
    const n = sinAcentos(t);
    const directo = lista.find((e) => sinAcentos(e) === n);
    if (directo) return directo;
    if (ESTADOS_GOOGLE[n]) return ESTADOS_GOOGLE[n];
  }
  return undefined;
}

/** Las partes de la dirección de Google en los campos del Hub. Se ubican por tipo, nunca por posición. */
export function direccionDeComponentes(componentes: Componente[], pais: string): Partial<Record<CampoDireccion, string>> {
  const de = (...tipos: string[]) => {
    for (const t of tipos) { const c = componentes.find((x) => x.types?.includes(t)); if (c) return c; }
    return undefined;
  };
  const estado = estadoDelPais(de('administrative_area_level_1'), pais) ?? '';
  let ciudad = de('administrative_area_level_2', 'locality')?.longText ?? '';
  // En la Ciudad de México Google no da la alcaldía (pone la ciudad): mejor vacío, para que la escriban.
  if (pais === 'MX' && estado === 'Ciudad de México' && sinAcentos(ciudad) === sinAcentos(estado)) ciudad = '';
  return {
    calle: de('route')?.longText ?? '',
    numero: de('street_number')?.longText ?? '',
    colonia: de('sublocality_level_1', 'sublocality', 'neighborhood')?.longText ?? '',
    ciudad,
    estado,
    cp: de('postal_code')?.longText ?? '',
  };
}

export async function detalleDeDireccion(o: { codigo: string; sesion: string; id: string; delHub: boolean }): Promise<{ disponible: boolean; direccion?: Partial<Record<CampoDireccion, string>> }> {
  if (!llave()) return { disponible: false };
  const pais = await paisDelFiltro(o.codigo, o.delHub);
  if (!contar(`d:${o.sesion}`, 5, 3_600_000)) return { disponible: true };
  const region = pais.toLowerCase();
  const url = `${DETALLE}${encodeURIComponent(o.id)}?languageCode=es&regionCode=${region}&sessionToken=${encodeURIComponent(o.sesion)}`;
  const r = await google<{ addressComponents?: Componente[] }>(url, { method: 'GET', headers: { 'X-Goog-FieldMask': 'addressComponents,formattedAddress' } });
  if (!r) return { disponible: false };
  return { disponible: true, direccion: direccionDeComponentes(r.addressComponents ?? [], pais) };
}
