import { z } from 'zod';

// Forma en que el catálogo de clientes sale hacia la pantalla: sin nulls (Postgres los manda; el front espera campos ausentes) y con las banderas siempre booleanas.
export const EntidadOut = z.object({
  id: z.string(),
  clientId: z.string().optional(),
  legalName: z.string().optional(),
  rfc: z.string().optional(),
  taxRegime: z.string().optional(),
  postalCode: z.string().optional(),
  cfdiUse: z.string().optional(),
  paymentMethod: z.string().optional(),
  paymentForm: z.string().optional(),
  billingEmails: z.string().optional(),
  creditDays: z.number().optional(),
  requiresPo: z.boolean(),
  requiresPortal: z.boolean(),
  portalUrl: z.string().optional(),
  requiresGr: z.boolean(),
  requiresProforma: z.boolean(),
  processNotes: z.string().optional(),
  active: z.boolean(),
});
export type EntidadOutType = z.infer<typeof EntidadOut>;

export const ContactoOut = z.object({
  id: z.string(),
  clientId: z.string().optional(),
  entityId: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
});
export type ContactoOutType = z.infer<typeof ContactoOut>;

export const COLUMNAS_ENTIDAD = `e.id, e.client_id, e.legal_name, e.rfc, e.tax_regime, e.postal_code, e.cfdi_use, e.payment_method, e.payment_form,
  e.billing_emails, e.credit_days, e.requires_po, e.requires_portal, e.portal_url, e.requires_gr, e.requires_proforma, e.process_notes, e.deactivated_at`;

export const COLUMNAS_CONTACTO = `k.id, k.client_id, k.entity_id, k.name, k.email, k.phone, k.contact_role, k.notes`;

const o = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

export function entidadDeFila(r: Record<string, any>): EntidadOutType {
  return {
    id: r.id,
    clientId: o(r.client_id),
    legalName: o(r.legal_name),
    rfc: o(r.rfc),
    taxRegime: o(r.tax_regime),
    postalCode: o(r.postal_code),
    cfdiUse: o(r.cfdi_use),
    paymentMethod: o(r.payment_method),
    paymentForm: o(r.payment_form),
    billingEmails: o(r.billing_emails),
    creditDays: o(r.credit_days),
    requiresPo: !!r.requires_po,
    requiresPortal: !!r.requires_portal,
    portalUrl: o(r.portal_url),
    requiresGr: !!r.requires_gr,
    requiresProforma: !!r.requires_proforma,
    processNotes: o(r.process_notes),
    active: r.deactivated_at == null,
  };
}

export function contactoDeFila(r: Record<string, any>): ContactoOutType {
  return {
    id: r.id,
    clientId: o(r.client_id),
    entityId: o(r.entity_id),
    name: o(r.name),
    email: o(r.email),
    phone: o(r.phone),
    role: o(r.contact_role),
    notes: o(r.notes),
  };
}
