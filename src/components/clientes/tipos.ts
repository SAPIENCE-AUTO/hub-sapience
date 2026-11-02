// Formas que devuelven los endpoints del catálogo de clientes (los del SDK del front salen como `any`; aquí queda el tipo real).

export interface Entidad {
  id: string;
  clientId?: string;
  legalName?: string;
  rfc?: string;
  taxRegime?: string;
  postalCode?: string;
  cfdiUse?: string;
  paymentMethod?: string;
  paymentForm?: string;
  billingEmails?: string;
  creditDays?: number;
  requiresPo: boolean;
  requiresPortal: boolean;
  portalUrl?: string;
  requiresGr: boolean;
  requiresProforma: boolean;
  processNotes?: string;
  active: boolean;
}

export interface Contacto {
  id: string;
  clientId?: string;
  entityId?: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  notes?: string;
}

export interface ClienteDeLista {
  id: string;
  name: string;
  sharpliLinked: boolean;
  entities: number;
  cobroListo: number;
  facturaListo: number;
  contacts: number;
  deals: number;
  projects: number;
}

export interface FichaDeCliente {
  found: boolean;
  client?: { id: string; name: string; sharpliLinked: boolean };
  entities: Entidad[];
  contacts: Contacto[];
  stats?: { deals: number; projects: number; pending: { currency: string; processes: number; amount: number }[] };
}
