// Punto de entrada de la capa de compatibilidad.
// Los 207 endpoints solo cambian esta línea:
//   - import { createEndpoint, Deals } from 'zite-integrations-backend-sdk';
//   + import { createEndpoint, Deals } from '../compat';

export { createEndpoint } from './endpoint';
export type { EndpointContext, AuthUser, CompiledEndpoint } from './endpoint';
export { ZiteError } from './errors';
export { pool } from './db';
export { SCHEMA } from './schema-map';

import { pool } from './db';
import { createModel } from './model';

export const Users = createModel(pool, 'Users');
export const Projects = createModel(pool, 'Projects');
export const CRMItems = createModel(pool, 'CRMItems');
// Alias: el SDK real de Zite exportaba este modelo como `CrmItems` (mayúsculas
// distintas a como generate.py nombró la tabla "CRM Items"). Los endpoints
// getCRMItems/saveCRMItem/deleteCRMItem se escribieron contra ese nombre real;
// en vez de tocar el cuerpo de esos 3 archivos, se alias aquí.
export const CrmItems = CRMItems;
export const Participants = createModel(pool, 'Participants');
export const RecruitmentRows = createModel(pool, 'RecruitmentRows');
export const Suppliers = createModel(pool, 'Suppliers');
export const PurchaseOrders = createModel(pool, 'PurchaseOrders');
export const POLineItems = createModel(pool, 'POLineItems');
// Alias: el SDK real de Zite exportaba este modelo como `PoLineItems`
// (mayúsculas distintas a como generate.py nombró la tabla "PO Line Items").
export const PoLineItems = POLineItems;
export const Tasks = createModel(pool, 'Tasks');
export const CalendarEvents = createModel(pool, 'CalendarEvents');
export const Messages = createModel(pool, 'Messages');
export const BoardColumns = createModel(pool, 'BoardColumns');
export const CellValues = createModel(pool, 'CellValues');
export const Invoices = createModel(pool, 'Invoices');
export const Payments = createModel(pool, 'Payments');
export const Documents = createModel(pool, 'Documents');
export const Boards = createModel(pool, 'Boards');
export const SharedViews = createModel(pool, 'SharedViews');
export const ChatConversations = createModel(pool, 'ChatConversations');
export const BillingEntities = createModel(pool, 'BillingEntities');
export const SupplierInvoices = createModel(pool, 'SupplierInvoices');
export const ApprovalLimits = createModel(pool, 'ApprovalLimits');
export const POAuditLog = createModel(pool, 'POAuditLog');
// Alias: el SDK real de Zite exportaba este modelo como `PoAuditLog`.
export const PoAuditLog = POAuditLog;
export const PoAttachments = createModel(pool, 'PoAttachments');
export const AppSettings = createModel(pool, 'AppSettings');
export const Deals = createModel(pool, 'Deals');
export const Cotizaciones = createModel(pool, 'Cotizaciones');
export const CotizacionLineItems = createModel(pool, 'CotizacionLineItems');
export const DealDocuments = createModel(pool, 'DealDocuments');
export const DocumentBlocks = createModel(pool, 'DocumentBlocks');
export const PettyCashFunds = createModel(pool, 'PettyCashFunds');
export const Expenses = createModel(pool, 'Expenses');
export const ExpenseAuditLog = createModel(pool, 'ExpenseAuditLog');
export const ExpenseComments = createModel(pool, 'ExpenseComments');
export const TaskComments = createModel(pool, 'TaskComments');
export const ExpenseLineItems = createModel(pool, 'ExpenseLineItems');
export const CommercialDashboardViews = createModel(pool, 'CommercialDashboardViews');
export const CalendarAuditLog = createModel(pool, 'CalendarAuditLog');
export const CollectionProcesses = createModel(pool, 'CollectionProcesses');
export const RubroAssignments = createModel(pool, 'RubroAssignments');
export const MigrationLog = createModel(pool, 'MigrationLog');

export const MODELS = { Users, Projects, CRMItems, Participants, RecruitmentRows, Suppliers, PurchaseOrders, POLineItems, Tasks, CalendarEvents, Messages, BoardColumns, CellValues, Invoices, Payments, Documents, Boards, SharedViews, ChatConversations, BillingEntities, SupplierInvoices, ApprovalLimits, POAuditLog, PoAttachments, AppSettings, Deals, Cotizaciones, CotizacionLineItems, DealDocuments, DocumentBlocks, PettyCashFunds, Expenses, ExpenseAuditLog, ExpenseComments, TaskComments, ExpenseLineItems, CommercialDashboardViews, CalendarAuditLog, CollectionProcesses, RubroAssignments, MigrationLog } as const;
export type * from './types';
