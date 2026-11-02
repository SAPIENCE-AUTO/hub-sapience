// Catálogos del SAT que pide una factura en México (CFDI 4.0) y vocabulario del catálogo de clientes.
// Régimen fiscal, uso del CFDI y forma de pago se guardan por CLAVE ('601', 'G03', '03'), que es lo que acepta cualquier proveedor de facturación;
// aquí viven las etiquetas para mostrarlas. Sin importaciones de React ni del servidor: lo usan los endpoints, las pruebas y las pantallas.

export interface OpcionSat { clave: string; nombre: string }

export const REGIMENES_FISCALES: OpcionSat[] = [
  { clave: '601', nombre: 'General de Ley Personas Morales' },
  { clave: '603', nombre: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', nombre: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { clave: '606', nombre: 'Arrendamiento' },
  { clave: '607', nombre: 'Régimen de Enajenación o Adquisición de Bienes' },
  { clave: '608', nombre: 'Demás ingresos' },
  { clave: '610', nombre: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { clave: '611', nombre: 'Ingresos por Dividendos (socios y accionistas)' },
  { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { clave: '614', nombre: 'Ingresos por intereses' },
  { clave: '615', nombre: 'Régimen de los ingresos por obtención de premios' },
  { clave: '616', nombre: 'Sin obligaciones fiscales' },
  { clave: '620', nombre: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
  { clave: '621', nombre: 'Incorporación Fiscal' },
  { clave: '622', nombre: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { clave: '623', nombre: 'Opcional para Grupos de Sociedades' },
  { clave: '624', nombre: 'Coordinados' },
  { clave: '625', nombre: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { clave: '626', nombre: 'Régimen Simplificado de Confianza' },
];

// Solo los usos que tienen sentido al facturar a una empresa; los de deducciones personales (D01–D10) y nómina no aplican a este catálogo.
export const USOS_CFDI: OpcionSat[] = [
  { clave: 'G01', nombre: 'Adquisición de mercancías' },
  { clave: 'G02', nombre: 'Devoluciones, descuentos o bonificaciones' },
  { clave: 'G03', nombre: 'Gastos en general' },
  { clave: 'I01', nombre: 'Construcciones' },
  { clave: 'I02', nombre: 'Mobiliario y equipo de oficina por inversiones' },
  { clave: 'I03', nombre: 'Equipo de transporte' },
  { clave: 'I04', nombre: 'Equipo de cómputo y accesorios' },
  { clave: 'I08', nombre: 'Otra maquinaria y equipo' },
  { clave: 'S01', nombre: 'Sin efectos fiscales' },
];

export const FORMAS_PAGO: OpcionSat[] = [
  { clave: '01', nombre: 'Efectivo' },
  { clave: '02', nombre: 'Cheque nominativo' },
  { clave: '03', nombre: 'Transferencia electrónica de fondos' },
  { clave: '04', nombre: 'Tarjeta de crédito' },
  { clave: '28', nombre: 'Tarjeta de débito' },
  { clave: '99', nombre: 'Por definir' },
];

// PPD = se paga después (a crédito): al cobrarla hay que emitir el complemento de pago. PUE = se paga en una sola exhibición.
export const METODOS_PAGO: OpcionSat[] = [
  { clave: 'PUE', nombre: 'Pago en una sola exhibición' },
  { clave: 'PPD', nombre: 'Pago en parcialidades o diferido' },
];

export const ROLES_CONTACTO = ['Recibe facturas', 'Libera pagos', 'Seguimiento', 'Otro'] as const;
export type RolContacto = (typeof ROLES_CONTACTO)[number];

export const clavesDe = (lista: OpcionSat[]) => lista.map(o => o.clave);

/** «601 · General de Ley Personas Morales»; si la clave no está en el catálogo, la devuelve tal cual. */
export function etiquetaSat(lista: OpcionSat[], clave?: string | null): string {
  if (!clave) return '';
  const o = lista.find(x => x.clave === clave);
  return o ? `${o.clave} · ${o.nombre}` : clave;
}
