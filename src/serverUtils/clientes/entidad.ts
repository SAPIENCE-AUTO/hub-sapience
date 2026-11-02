import { clavesDe, FORMAS_PAGO, METODOS_PAGO, REGIMENES_FISCALES, USOS_CFDI } from '../../lib/clientes/catalogos';
import { correoValido, cpValido, normalizarRfc, normalizarUrl, rfcValido, separarCorreos, textoOUndefined } from '../../lib/clientes/validacion';

export interface EntradaEntidad {
  legalName?: string;
  rfc?: string;
  taxRegime?: string;
  postalCode?: string;
  cfdiUse?: string;
  paymentMethod?: string;
  paymentForm?: string;
  billingEmails?: string;
  creditDays?: number | null;
  requiresPo?: boolean;
  requiresPortal?: boolean;
  portalUrl?: string;
  requiresGr?: boolean;
  requiresProforma?: boolean;
  processNotes?: string;
}

/**
 * Revisa y limpia lo que se captura de una razón social. Es un reemplazo completo de los campos editables: lo que no viene (o viene vacío) se guarda como null,
 * así que borrar un dato en la pantalla lo borra de verdad. Devuelve los errores en español, uno por problema, para mostrarlos tal cual.
 */
export function validarEntidad(e: EntradaEntidad): { errores: string[]; record: Record<string, unknown> } {
  const errores: string[] = [];

  const legalName = textoOUndefined(e.legalName);
  if (!legalName) errores.push('Escribe la razón social.');

  const rfc = normalizarRfc(e.rfc);
  if (rfc && !rfcValido(rfc)) errores.push('El RFC no tiene el formato correcto: 12 caracteres para empresas y 13 para personas físicas.');

  const taxRegime = textoOUndefined(e.taxRegime);
  if (taxRegime && !clavesDe(REGIMENES_FISCALES).includes(taxRegime)) errores.push('El régimen fiscal no está en el catálogo del SAT.');

  const postalCode = textoOUndefined(e.postalCode);
  if (postalCode && !cpValido(postalCode)) errores.push('El código postal fiscal debe tener 5 dígitos.');

  const cfdiUse = textoOUndefined(e.cfdiUse);
  if (cfdiUse && !clavesDe(USOS_CFDI).includes(cfdiUse)) errores.push('El uso del CFDI no está en el catálogo.');

  const paymentMethod = textoOUndefined(e.paymentMethod);
  if (paymentMethod && !clavesDe(METODOS_PAGO).includes(paymentMethod)) errores.push('El método de pago debe ser PUE o PPD.');

  const paymentForm = textoOUndefined(e.paymentForm);
  if (paymentForm && !clavesDe(FORMAS_PAGO).includes(paymentForm)) errores.push('La forma de pago no está en el catálogo.');

  const correos = separarCorreos(e.billingEmails);
  const malos = correos.filter(c => !correoValido(c));
  if (malos.length) errores.push(`Revisa estos correos: ${malos.join(', ')}.`);

  let creditDays: number | null = null;
  if (e.creditDays != null) {
    if (!Number.isInteger(e.creditDays) || e.creditDays < 0 || e.creditDays > 365) errores.push('Los días de crédito deben ser un número entero entre 0 y 365.');
    else creditDays = e.creditDays;
  }

  const portalCrudo = textoOUndefined(e.portalUrl);
  const portalUrl = normalizarUrl(portalCrudo);
  if (portalCrudo && !portalUrl) errores.push('La liga del portal no parece una dirección válida.');

  return {
    errores,
    record: {
      legalName: legalName ?? null,
      rfc: rfc ?? null,
      taxRegime: taxRegime ?? null,
      postalCode: postalCode ?? null,
      cfdiUse: cfdiUse ?? null,
      paymentMethod: paymentMethod ?? null,
      paymentForm: paymentForm ?? null,
      billingEmails: correos.join(', ') || null,
      creditDays,
      requiresPo: !!e.requiresPo,
      requiresPortal: !!e.requiresPortal,
      portalUrl: portalUrl ?? null,
      requiresGr: !!e.requiresGr,
      requiresProforma: !!e.requiresProforma,
      processNotes: textoOUndefined(e.processNotes) ?? null,
    },
  };
}
