// Restricción puntual por seguridad interna (no es un rol ni un permiso
// general — es una excepción para una persona concreta, a propósito
// separada del resto del sistema de permisos por rol/purchaseLevel).
//
// Mónica solo debe ver las cotizaciones de los deals que ya se confirmaron
// como suyos. Está hardcodeado a esos 4 deals por ahora: las cotizaciones no
// tenían forma de saber quién las creó (Cotizaciones.createdBy es un campo
// nuevo, ver saveCotizacion.ts — solo cubre lo que se cree de aquí en
// adelante). Cuando haya suficiente historial con createdBy poblado, esto
// puede migrar a calcularse dinámicamente en vez de la lista fija.
const RESTRICTED_USERS: Record<string, Set<string>> = {
  'monica@sapience.com.mx': new Set([
    '6e71c6a3-a339-4010-8348-c3c463785b6e', // NAVE
    'd7cbd070-fca3-41cd-bdd5-829d44a7d029', // LICENCIA
    '59057169-c757-4d0a-84d1-81f9cd63c87d', // CRIBA
    'a2527274-194e-487c-b94d-5fd6eb4b9e65', // BREATHE
  ]),
};

/** null = sin restricción (todos los demás usuarios). Set = solo puede ver estos dealIds. */
export function getCotizacionAllowedDealIds(email: string | undefined): Set<string> | null {
  if (!email) return null;
  return RESTRICTED_USERS[email.toLowerCase()] ?? null;
}
