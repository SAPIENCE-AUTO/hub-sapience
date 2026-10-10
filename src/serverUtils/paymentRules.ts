/**
 * La fecha de hoy en México ('YYYY-MM-DD'). `new Date().toISOString()` da la fecha en UTC, y en México después de las
 * 6 pm ya es «mañana» en UTC: un pago registrado a las 7 pm quedaba con la fecha del día siguiente.
 */
export function fechaHoyMx(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/**
 * Lo mínimo para crear un pago a mano: su ODC y un monto mayor a cero. Sin eso quedaba un pago vacío (el #313) que no
 * cae en ningún grupo de la pantalla. Devuelve el motivo si falta algo, o null si está bien.
 */
export function motivoPagoInvalido(input: { poId?: string; amount?: number }): string | null {
  if (!input.poId) return 'Elige la ODC del pago.';
  if (!(typeof input.amount === 'number' && input.amount > 0)) return 'Escribe un monto mayor a cero.';
  return null;
}
