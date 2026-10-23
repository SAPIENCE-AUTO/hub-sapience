import type { CampoDireccion } from './tipos';

/**
 * Países de un screener (`Definicion.pais`): qué regla de NSE usa cada uno y
 * cómo se pide la dirección. México va completo; los demás ya tienen su
 * asociación de NSE anotada y se llenan cuando haya un estudio en puerta
 * (las reglas viven en nse.ts).
 */

export interface Pais {
  nombre: string;
  /** Asociación que publica la regla de NSE del país («AMAI»). Sin ella, el país no tiene regla única. */
  asociacionNse?: string;
  /** Id de la regla cargada en nse.ts. Sin él, la regla del país todavía no está en el Hub. */
  reglaNse?: string;
  /** Cómo se llaman los campos de la dirección, si no es el nombre general. */
  direccion?: Partial<Record<CampoDireccion, string>>;
  /** Lista para el campo «estado» de la dirección. */
  estados?: string[];
  /** Validación del código postal. */
  cp?: { patron: string; mensaje: string };
  /** El código postal llena estado, municipio y colonias (catálogo oficial en la tabla codigos_postales). */
  buscaCp?: boolean;
  /** Celular: lada, bandera y cuántos dígitos lleva sin la lada, agrupados como se dicta. */
  telefono?: Telefono;
}

export interface Telefono { lada: string; bandera: string; digitos: number; grupos: number[]; ejemplo: string }

const tel8 = (lada: string, bandera: string): Telefono => ({ lada, bandera, digitos: 8, grupos: [4, 4], ejemplo: '8888 8888' });

export const NOMBRES_DIRECCION: Record<CampoDireccion, string> = {
  calle: 'Calle',
  numero: 'Número',
  colonia: 'Barrio o colonia',
  ciudad: 'Ciudad',
  estado: 'Estado o provincia',
  cp: 'Código postal',
};

const ESTADOS_MX = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua',
  'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero',
  'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz',
  'Yucatán', 'Zacatecas',
];

const CENTROAMERICA = 'Sin regla única de NSE en Centroamérica: se define por estudio.';

export const PAISES: Record<string, Pais & { nota?: string }> = {
  MX: {
    nombre: 'México',
    asociacionNse: 'AMAI',
    reglaNse: 'MX-AMAI-2022',
    direccion: { numero: 'Número exterior e interior', colonia: 'Colonia', ciudad: 'Alcaldía o municipio', estado: 'Estado' },
    estados: ESTADOS_MX,
    cp: { patron: '^\\d{5}$', mensaje: 'El código postal lleva 5 dígitos' },
    buscaCp: true,
    telefono: { lada: '+52', bandera: '🇲🇽', digitos: 10, grupos: [2, 4, 4], ejemplo: '55 1234 5678' },
  },
  PE: { nombre: 'Perú', asociacionNse: 'APEIM', telefono: { lada: '+51', bandera: '🇵🇪', digitos: 9, grupos: [3, 3, 3], ejemplo: '912 345 678' } },
  BR: { nombre: 'Brasil', asociacionNse: 'ABEP', telefono: { lada: '+55', bandera: '🇧🇷', digitos: 11, grupos: [2, 5, 4], ejemplo: '11 91234 5678' } },
  CL: { nombre: 'Chile', asociacionNse: 'AIM', telefono: { lada: '+56', bandera: '🇨🇱', digitos: 9, grupos: [1, 4, 4], ejemplo: '9 1234 5678' } },
  AR: { nombre: 'Argentina', asociacionNse: 'SAIMO', telefono: { lada: '+54', bandera: '🇦🇷', digitos: 10, grupos: [2, 4, 4], ejemplo: '11 2345 6789' } },
  CO: { nombre: 'Colombia', asociacionNse: 'Estrato del recibo', telefono: { lada: '+57', bandera: '🇨🇴', digitos: 10, grupos: [3, 3, 4], ejemplo: '312 345 6789' } },
  GT: { nombre: 'Guatemala', nota: CENTROAMERICA, telefono: tel8('+502', '🇬🇹') },
  SV: { nombre: 'El Salvador', nota: CENTROAMERICA, telefono: tel8('+503', '🇸🇻') },
  HN: { nombre: 'Honduras', nota: CENTROAMERICA, telefono: tel8('+504', '🇭🇳') },
  NI: { nombre: 'Nicaragua', nota: CENTROAMERICA, telefono: tel8('+505', '🇳🇮') },
  CR: { nombre: 'Costa Rica', nota: CENTROAMERICA, telefono: tel8('+506', '🇨🇷') },
  PA: { nombre: 'Panamá', nota: CENTROAMERICA, telefono: tel8('+507', '🇵🇦') },
};

/** El celular del país; sin país conocido, 10 dígitos sin lada. */
export const telefonoDe = (pais?: string): Telefono =>
  (pais && PAISES[pais]?.telefono) || { lada: '', bandera: '', digitos: 10, grupos: [3, 3, 4], ejemplo: '' };

/** Solo los dígitos del celular, sin la lada si la pegaron con ella («+52 55…»), hasta los que lleva el país. */
export function limpiarTelefono(texto: string, t: Telefono): string {
  let d = texto.replace(/\D/g, '');
  const lada = t.lada.replace(/\D/g, '');
  if (lada && d.length > t.digitos && d.startsWith(lada)) d = d.slice(lada.length);
  return d.slice(0, t.digitos);
}

/** Los dígitos en grupos, como se dicta: «55 1234 5678». */
export function agruparTelefono(digitos: string, t: Telefono): string {
  const partes: string[] = [];
  let i = 0;
  for (const n of t.grupos) { if (i >= digitos.length) break; partes.push(digitos.slice(i, i + n)); i += n; }
  if (i < digitos.length) partes.push(digitos.slice(i));
  return partes.join(' ');
}

export const nombreCampoDireccion = (pais: string | undefined, campo: CampoDireccion) =>
  (pais && PAISES[pais]?.direccion?.[campo]) || NOMBRES_DIRECCION[campo];
