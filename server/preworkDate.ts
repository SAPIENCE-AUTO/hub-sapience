/**
 * "Hoy" para el desbloqueo de misiones por día — en hora de Ciudad de
 * México, no en el `current_date` de Postgres (zona horaria del servidor,
 * casi seguro UTC). Con estudios operando en México (UTC-6), usar
 * `current_date` crudo adelanta el desbloqueo hasta 6 horas antes de la
 * medianoche real de México. Mismo criterio horario que ya usa
 * inviteHtml.ts (America/Mexico_City).
 */
export function fechaHoyMexico(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
