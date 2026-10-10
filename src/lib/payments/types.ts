// Tipos mínimos que necesita la lógica de la pantalla de pagos. El pago real
// (GetPaymentsOutputType['payments'][0]) los cumple de forma estructural, así esta carpeta no depende del SDK.
export interface PagoBase {
  id: string;
  paymentId?: string | number;
  status?: string;
  amount?: number;
  currency?: string;
  dueDate?: string;
  paymentDate?: string;
  poNumber?: string;
  supplierName?: string;
  projectCode?: string;
  reference?: string;
  supplierInvoiceNumber?: string;
  sourceCompany?: string;
}

export type Pestana = 'porPagar' | 'pagados' | 'cancelados' | 'todos';
export type Moneda = 'MXN' | 'USD';
