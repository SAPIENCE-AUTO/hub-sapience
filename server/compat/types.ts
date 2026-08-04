// GENERADO por generate.py. Equivalente a los *RecordType del SDK de Zite.
// Los campos link se exponen como string[] (arreglo de IDs), igual que en Zite.

export interface UsersRecordType {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  lastActiveAt?: string;
  purchaseLevel?: string;
  costCenters?: string[];
  accessComercial?: string;
  accessOperacion?: string;
  accessAdmin?: string;
  accessFinanzas?: string;
  accessOtros?: string;
  maxApprovalAmount?: number;
  visiblePages?: string[];
  hiddenFromChat?: boolean;
  profilePhoto?: string;
  departamento?: string;
  dashboardWidgets?: string[];
  widgetLayout?: string;
  activeChannel?: string;
  cotizacionRubros?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectsRecordType {
  id: string;
  projectCode?: string;
  fullName?: string;
  status?: string;
  client?: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
  description?: string;
  tematica?: string;
  timelineStatus?: string;
  timelineUrl?: string;
  timelineUpdatedAt?: string;
  teamsChannelUrl?: string;
  teamsChannelStatus?: string;
  dealVinculado?: string[];
  lider?: string[];
  muestra?: string;
  muestraImagen?: string;
  instruccionesDeAnalisis?: string;
  lastAnalysisJson?: string;
  lastAnalysisAt?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  analistas?: string[];
  moderadores?: string[];
  asistentes?: string[];
}

export interface CRMItemsRecordType {
  id: string;
  itemName?: string;
  projectCode?: string;
  client?: string;
  status?: string;
  proposalDate?: string;
  contractDate?: string;
  budget?: number;
  revenue?: number;
  assignedTo?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ParticipantsRecordType {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  idNumber?: string;
  city?: string;
  gender?: string;
  age?: number;
  totalSessions?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RecruitmentRowsRecordType {
  id: string;
  rowName?: string;
  projectCode?: string;
  boardName?: string;
  participantName?: string;
  email?: string;
  phone?: string;
  idNumber?: string;
  status?: string;
  group?: string;
  parentRowId?: string;
  level?: number;
  ndaSent?: boolean;
  ndaSentDate?: string;
  notes?: string;
  sourceForm?: string;
  deletedAt?: string;
  cellData?: string;
  rowOrder?: number;
  boardId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SuppliersRecordType {
  id: string;
  supplierName?: string;
  taxId?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  bankName?: string;
  bankAccount?: string;
  notes?: string;
  categories?: string[];
  identifier?: string;
  address?: string;
  taxRegime?: string;
  personType?: string;
  country?: string;
  accessToken?: string;
  portalPassword?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseOrdersRecordType {
  id: string;
  poNumber?: string;
  projectCode?: string;
  supplierName?: string;
  issueDate?: string;
  totalAmount?: number;
  status?: string;
  pdfUrl?: string;
  notes?: string;
  category?: string;
  paymentTerms?: string;
  currency?: string;
  createdBy?: string;
  approvedBy?: string;
  serviceDescription?: string;
  billingEntity?: string;
  emailSentAt?: string;
  emailSentTo?: string;
  tipoDeOc?: string;
  rejectionReason?: string;
  pdfFile?: any;
  pdfBase64?: string;
  origen?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface POLineItemsRecordType {
  id: string;
  description?: string;
  poId?: string;
  category?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  parentItemId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TasksRecordType {
  id: string;
  taskName?: string;
  projectCode?: string;
  status?: string;
  assignedTo?: string;
  startDate?: string;
  endDate?: string;
  parentTaskId?: string;
  order?: number;
  notes?: string;
  boardName?: string;
  boardId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarEventsRecordType {
  id: string;
  eventName?: string;
  projectCode?: string;
  calendarName?: string;
  eventDate?: string;
  durationHours?: number;
  location?: string;
  attendees?: string;
  inviteSent?: boolean;
  notes?: string;
  parentEventId?: string;
  inviteStatus?: string;
  outlookEventId?: string;
  outlookEventLink?: string;
  inviteBodyHtml?: string;
  inviteEmails?: string;
  boardId?: string;
  restringirReenvio?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessagesRecordType {
  id: string;
  messageId?: number;
  channel?: string;
  senderName?: string;
  senderEmail?: string;
  content?: string;
  sentAt?: string;
  parentMessageId?: string;
  reactions?: string;
  pinned?: boolean;
  attachments?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardColumnsRecordType {
  id: string;
  columnName?: string;
  boardId?: string;
  columnType?: string;
  optionsJson?: string;
  columnOrder?: number;
  deletedAt?: string;
  deletedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CellValuesRecordType {
  id: string;
  cellId?: number;
  boardId?: string;
  rowId?: string;
  columnId?: string;
  textValue?: string;
  numberValue?: number;
  dateValue?: string;
  booleanValue?: boolean;
  fileUrl?: string;
  deletedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InvoicesRecordType {
  id: string;
  invoiceNumber?: string;
  projectCode?: string;
  client?: string;
  type?: string;
  amount?: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  pdfUrl?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentsRecordType {
  id: string;
  paymentId?: number;
  poId?: string;
  invoiceId?: string;
  projectCode?: string;
  type?: string;
  amount?: number;
  paymentDate?: string;
  method?: string;
  reference?: string;
  status?: string;
  notes?: string;
  supplierName?: string;
  currency?: string;
  attachment?: any;
  dueDate?: string;
  supplierInvoiceNumber?: string;
  destinationAccount?: string;
  sourceCompany?: string;
  sourceBank?: string;
  sourceAccount?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentsRecordType {
  id: string;
  documentName?: string;
  projectCode?: string;
  category?: string;
  fileUrl?: string;
  uploadedBy?: string;
  uploadDate?: string;
  version?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardsRecordType {
  id: string;
  boardName?: string;
  projectCode?: string;
  boardOrder?: number;
  deletedAt?: string;
  boardType?: string;
  excelColumnsJson?: string;
  calendarVersion?: number;
  calendarFileUrl?: string;
  timelineVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SharedViewsRecordType {
  id: string;
  viewName?: string;
  boardId?: string;
  projectCode?: string;
  boardName?: string;
  token?: string;
  filtersJson?: string;
  visibleColumnsJson?: string;
  createdBy?: string;
  active?: boolean;
  type?: string;
  sharedToken?: string;
  viewOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatConversationsRecordType {
  id: string;
  conversationName?: string;
  type?: string;
  members?: string;
  createdBy?: string;
  createdAt?: string;
  lastMessageAt?: string;
  updatedAt?: string;
}

export interface BillingEntitiesRecordType {
  id: string;
  companyName?: string;
  rfc?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierInvoicesRecordType {
  id: string;
  invoiceNumber?: string;
  poId?: string;
  supplierId?: string;
  supplierName?: string;
  poNumber?: string;
  amount?: number;
  currency?: string;
  pdfFile?: any;
  xmlFile?: any;
  supportFile?: any;
  status?: string;
  uploadDate?: string;
  uploadedBy?: string;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  projectCode?: string;
  supplierComment?: string;
  subtotal?: number;
  ivaRate?: number;
  ivaAmount?: number;
  retencionIva?: number;
  retencionIsr?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApprovalLimitsRecordType {
  id: string;
  limitId?: number;
  costCenter?: string;
  approvalLevel?: string;
  maxAmount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface POAuditLogRecordType {
  id: string;
  timestamp?: string;
  purchaseOrder?: string[];
  action?: string;
  userEmail?: string;
  userName?: string;
  comments?: string;
  poNumber?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PoAttachmentsRecordType {
  id: string;
  name?: string;
  purchaseOrder?: string[];
  fileUrl?: string;
  description?: string;
  uploadedByEmail?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppSettingsRecordType {
  id: string;
  settingKey?: string;
  defaultVisiblePages?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DealsRecordType {
  id: string;
  dealName?: string;
  phase?: string;
  client?: string;
  projectType?: string;
  tematica?: string;
  owner?: string[];
  proposalDate?: string;
  approvalDate?: string;
  currency?: string;
  clientPrice?: number;
  taxesPct?: number;
  quotedCost?: number;
  notes?: string;
  retenciones?: number;
  empresaOperadora?: string;
  puntoDeContacto?: string;
  statusPropuesta?: string;
  hechaPor?: string;
  fechaDeBrief?: string;
  fechaPerdida?: string;
  gerente?: string;
  exchangeRate?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CotizacionesRecordType {
  id: string;
  cotizacionName?: string;
  deal?: string[];
  status?: string;
  currency?: string;
  totalCost?: number;
  clientPrice?: number;
  notes?: string;
  included?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CotizacionLineItemsRecordType {
  id: string;
  subRubro?: string;
  cotizacion?: string[];
  rubro?: string;
  cantidad?: number;
  unitCost?: number;
  hasMarkup?: boolean;
  markupPct?: number;
  finalPrice?: number;
  componentes?: number;
  includedInBudget?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DealDocumentsRecordType {
  id: string;
  documentName?: string;
  deal?: string[];
  docType?: string;
  version?: string;
  fileUrl?: string;
  fileName?: string;
  uploadDate?: string;
  notes?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentBlocksRecordType {
  id: string;
  blockId?: number;
  blockContent?: string;
  blockType?: string;
  authorName?: string;
  authorEmail?: string;
  deal?: string[];
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  checklistData?: string;
  documentJson?: string;
}

export interface PettyCashFundsRecordType {
  id: string;
  fundName?: string;
  initialAmount?: number;
  currentBalance?: number;
  costCenter?: string;
  status?: string;
  lastReplenishmentDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpensesRecordType {
  id: string;
  expenseNumber?: number;
  description?: string;
  amount?: number;
  category?: string;
  paymentMethod?: string;
  costCenter?: string;
  projectCode?: string;
  currency?: string;
  expenseDate?: string;
  status?: string;
  receipt?: any;
  notes?: string;
  createdBy?: string;
  approvedBy?: string;
  rejectionReason?: string;
  pettyCashFund?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseAuditLogRecordType {
  id: string;
  timestamp?: string;
  expense?: string[];
  action?: string;
  userEmail?: string;
  userName?: string;
  comments?: string;
  expenseNumber?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseCommentsRecordType {
  id: string;
  comment?: string;
  expense?: string[];
  authorEmail?: string;
  authorName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskCommentsRecordType {
  id: string;
  taskId?: string;
  messageId?: string;
  taskName?: string;
  channel?: string;
  senderName?: string;
  senderEmail?: string;
  content?: string;
  sentAt?: string;
  isThreadReply?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseLineItemsRecordType {
  id: string;
  description?: string;
  expense?: string[];
  category?: string;
  amount?: number;
  date?: string;
  receipt?: any;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CommercialDashboardViewsRecordType {
  id: string;
  viewName?: string;
  viewId?: string;
  owner?: string[];
  isDefault?: boolean;
  isShared?: boolean;
  filtersJson?: string;
  widgetsJson?: string;
  dateReference?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarAuditLogRecordType {
  id: string;
  action?: string;
  eventName?: string;
  calendarName?: string;
  projectCode?: string;
  userEmail?: string;
  userName?: string;
  timestamp?: string;
  details?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollectionProcessesRecordType {
  id: string;
  projectCode?: string;
  deal?: string[];
  client?: string;
  currency?: string;
  quotedAmount?: number;
  collectionAmount?: number;
  phase?: string;
  applicablePhases?: string;
  proformaCreatedAt?: string;
  proformaSentAt?: string;
  invoiceCreatedAt?: string;
  invoiceSentAt?: string;
  portalUploadedAt?: string;
  grMigoAt?: string;
  scheduledPaymentDate?: string;
  paidAt?: string;
  invoiceNumber?: string;
  status?: string;
  notes?: string;
  responsibleUser?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface RubroAssignmentsRecordType {
  id: string;
  rubro?: string;
  assignedUser?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MigrationLogRecordType {
  id: string;
  projectCode?: string;
  boardId?: string;
  migrated?: number;
  failed?: number;
  skipped?: number;
  status?: string;
  durationSeconds?: number;
  runBy?: string[];
  createdAt?: string;
  updatedAt?: string;
}
