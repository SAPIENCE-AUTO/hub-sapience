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
}

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
  },
  PE: { nombre: 'Perú', asociacionNse: 'APEIM' },
  BR: { nombre: 'Brasil', asociacionNse: 'ABEP' },
  CL: { nombre: 'Chile', asociacionNse: 'AIM' },
  AR: { nombre: 'Argentina', asociacionNse: 'SAIMO' },
  CO: { nombre: 'Colombia', asociacionNse: 'Estrato del recibo' },
  GT: { nombre: 'Guatemala', nota: CENTROAMERICA },
  SV: { nombre: 'El Salvador', nota: CENTROAMERICA },
  HN: { nombre: 'Honduras', nota: CENTROAMERICA },
  NI: { nombre: 'Nicaragua', nota: CENTROAMERICA },
  CR: { nombre: 'Costa Rica', nota: CENTROAMERICA },
  PA: { nombre: 'Panamá', nota: CENTROAMERICA },
};

export const nombreCampoDireccion = (pais: string | undefined, campo: CampoDireccion) =>
  (pais && PAISES[pais]?.direccion?.[campo]) || NOMBRES_DIRECCION[campo];
