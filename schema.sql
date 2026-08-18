-- ============================================================================
--  Hub Sapience — esquema Postgres  (base "Operations Hub", 41 tablas)
--  GENERADO por generate.py desde el export de Zite. No editar a mano:
--  este archivo y compat/schema-map.ts salen de la misma fuente a propósito,
--  para que el DDL y el mapeo de la capa de compatibilidad no se desalineen.
--
--  Decisiones:
--   · PK uuid con gen_random_uuid() (nativo desde PG 13, no requiere pgcrypto).
--   · single_select → text + CHECK, no enum: alterar un CHECK es trivial,
--     alterar un enum no, y estas opciones cambian en operación.
--   · currency → numeric(14,2) uniforme. En Zite varias tenían decimalPlaces 0,
--     pero era formato de despliegue; truncar centavos en finanzas es un bug.
--   · linked_record: la FK vive SOLO en el lado que define la relación.
--     Los lados inversos autogenerados por Zite no producen columna.
--   · Índices derivados de los filtros reales de los 207 endpoints.
-- ============================================================================

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;


-- ─── Users ─────────────────────────────────────────────────────
create table users (
  id                            uuid primary key default gen_random_uuid(),
  email                         text,
  first_name                    text,
  last_name                     text,
  "role"                        text,
  last_active_at                timestamptz,
  purchase_level                text,
  cost_centers                  text[],
  access_comercial              text,
  access_operacion              text,
  access_admin                  text,
  access_finanzas               text,
  access_otros                  text,
  max_approval_amount           numeric(14,2),
  visible_pages                 text[],
  hidden_from_chat              boolean,
  profile_photo                 text,
  departamento                  text,
  dashboard_widgets             text[],
  widget_layout                 text,
  active_channel                text,
  cotizacion_rubros             text[],
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint users_role_chk check ("role" is null or "role" in ('Owner', 'Socio', 'Head', 'Líder', 'Coordinador', 'Analista')),
  constraint users_purchase_level_chk check ("purchase_level" is null or "purchase_level" in ('Visor', 'Creador', 'Aprobador', 'Finanzas', 'Socios')),
  constraint users_cost_centers_chk check ("cost_centers" is null or "cost_centers" <@ array['Reclutamiento e Incentivos', 'Logística', 'Moderaciones', 'Management', 'Otros']::text[]),
  constraint users_access_comercial_chk check ("access_comercial" is null or "access_comercial" in ('Sin acceso', 'Solo ver', 'Editar', 'Administrar')),
  constraint users_access_operacion_chk check ("access_operacion" is null or "access_operacion" in ('Sin acceso', 'Solo ver', 'Editar', 'Administrar')),
  constraint users_access_admin_chk check ("access_admin" is null or "access_admin" in ('Sin acceso', 'Solo ver', 'Editar', 'Administrar')),
  constraint users_access_finanzas_chk check ("access_finanzas" is null or "access_finanzas" in ('Sin acceso', 'Solo ver', 'Editar', 'Administrar')),
  constraint users_access_otros_chk check ("access_otros" is null or "access_otros" in ('Sin acceso', 'Solo ver', 'Editar', 'Administrar')),
  constraint users_visible_pages_chk check ("visible_pages" is null or "visible_pages" <@ array['Dashboard', 'Chat', 'CRM / Deals', 'Dashboard comercial', 'Cotizaciones', 'Proyectos', 'Órdenes de compra', 'Proveedores', 'Pagos a proveedores', 'Facturas de proveedores', 'Cobranza', 'Costos por proyecto', 'Dashboard financiero', 'Tableros flexibles', 'Comprobación de gastos']::text[]),
  constraint users_departamento_chk check ("departamento" is null or "departamento" in ('Finanzas', 'Análisis', 'Reclutamiento', 'Logística')),
  constraint users_dashboard_widgets_chk check ("dashboard_widgets" is null or "dashboard_widgets" <@ array['Mis proyectos', 'Mis tareas', 'Próximos eventos', 'Órdenes de compra', 'Menciones recientes', 'Facturas recibidas']::text[]),
  constraint users_cotizacion_rubros_chk check ("cotizacion_rubros" is null or "cotizacion_rubros" <@ array['Reclutamiento e incentivos', 'Moderación', 'Management', 'Logística y operación', 'Back office']::text[])
);
create trigger users_set_updated before update on users for each row execute function set_updated_at();

-- ─── CRM Items ─────────────────────────────────────────────────
create table crm_items (
  id                            uuid primary key default gen_random_uuid(),
  item_name                     text,
  project_code                  text,
  client                        text,
  status                        text,
  proposal_date                 date,
  contract_date                 date,
  budget                        numeric(14,2),
  revenue                       numeric(14,2),
  assigned_to                   text,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint crm_items_status_chk check ("status" is null or "status" in ('Prospecto', 'Propuesta enviada', 'Negociación', 'Ganado', 'Perdido'))
);
create trigger crm_items_set_updated before update on crm_items for each row execute function set_updated_at();

-- ─── Participants ──────────────────────────────────────────────
create table participants (
  id                            uuid primary key default gen_random_uuid(),
  full_name                     text,
  email                         text,
  phone                         text,
  id_number                     text,
  city                          text,
  gender                        text,
  age                           numeric,
  total_sessions                numeric,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint participants_gender_chk check ("gender" is null or "gender" in ('Femenino', 'Masculino', 'Otro'))
);
create trigger participants_set_updated before update on participants for each row execute function set_updated_at();

-- ─── Recruitment Rows ──────────────────────────────────────────
create table recruitment_rows (
  id                            uuid primary key default gen_random_uuid(),
  row_name                      text,
  project_code                  text,
  board_name                    text,
  participant_name              text,
  email                         text,
  phone                         text,
  id_number                     text,
  status                        text,
  "group"                       text,
  parent_row_id                 text,
  level                         numeric,
  nda_sent                      boolean,
  nda_sent_date                 timestamptz,
  notes                         text,
  source_form                   text,
  deleted_at                    text,
  cell_data                     text,
  row_order                     numeric,
  board_id                      text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger recruitment_rows_set_updated before update on recruitment_rows for each row execute function set_updated_at();
-- status: sin CHECK a propósito. Zite lo registró como single_select con 92
-- opciones, pero es texto casi libre que los reclutadores escriben en operación
-- (typos, variantes, siglas de proyecto sueltas como '14', '56', 'QRO') — no es
-- una enumeración real, es un log de lo que se ha escrito. No falló al cargar
-- porque los valores existentes ya calzaban, pero el primer status nuevo que
-- escriba un reclutador habría rebotado en producción sin explicación aparente.

-- ─── Suppliers ─────────────────────────────────────────────────
create table suppliers (
  id                            uuid primary key default gen_random_uuid(),
  supplier_name                 text,
  tax_id                        text,
  contact_name                  text,
  email                         text,
  phone                         text,
  bank_name                     text,
  bank_account                  text,
  notes                         text,
  categories                    text[],
  identifier                    text,
  address                       text,
  tax_regime                    text,
  person_type                   text,
  country                       text,
  access_token                  text,
  portal_password               text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint suppliers_categories_chk check ("categories" is null or "categories" <@ array['Reclutamiento e Incentivos', 'Logística', 'Moderaciones', 'Management', 'Otros', 'RECLUTAMIENTO', 'MODERADORES']::text[]),
  constraint suppliers_tax_regime_chk check ("tax_regime" is null or "tax_regime" in ('General de Ley Personas Morales', 'RESICO', 'Régimen de Incorporación Fiscal', 'Actividades Empresariales y Profesionales', 'Sueldos y Salarios', 'Arrendamiento', 'Sin obligaciones fiscales', 'Otro', 'Persona Física con Actividad Empresarial')),
  constraint suppliers_person_type_chk check ("person_type" is null or "person_type" in ('Física', 'Moral'))
);
create trigger suppliers_set_updated before update on suppliers for each row execute function set_updated_at();

-- ─── Purchase Orders ───────────────────────────────────────────
create table purchase_orders (
  id                            uuid primary key default gen_random_uuid(),
  po_number                     text,
  project_code                  text,
  supplier_name                 text,
  issue_date                    date,
  total_amount                  numeric(14,2),
  status                        text,
  pdf_url                       text,
  notes                         text,
  category                      text,
  payment_terms                 text,
  currency                      text,
  created_by                    text,
  approved_by                   text,
  service_description           text,
  billing_entity                text,
  email_sent_at                 timestamptz,
  email_sent_to                 text,
  tipo_de_oc                    text,
  rejection_reason              text,
  pdf_file                      jsonb,
  pdf_base64                    text,
  origen                        text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint purchase_orders_status_chk check ("status" is null or "status" in ('Borrador', 'Enviada a aprobación', 'Aprobada', 'Factura recibida', 'Factura validada', 'Pago programado', 'Pagada', 'Cancelada')),
  constraint purchase_orders_category_chk check ("category" is null or "category" in ('Reclutamiento e Incentivos', 'Logística', 'Moderaciones', 'Management', 'Otros')),
  constraint purchase_orders_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD')),
  constraint purchase_orders_tipo_de_oc_chk check ("tipo_de_oc" is null or "tipo_de_oc" in ('Normal', 'Anticipo', 'Cierre')),
  constraint purchase_orders_origen_chk check ("origen" is null or "origen" in ('Migrada', 'Sistema'))
);
create trigger purchase_orders_set_updated before update on purchase_orders for each row execute function set_updated_at();
-- payment_terms: sin CHECK a propósito. Zite lo registró como single_select con
-- 22 opciones, pero mezcla términos reales ('30 días', 'Contado') con basura de
-- captura ('wrf', '334', 'greqt', '1') — nunca fue una enumeración validada.

-- ─── PO Line Items ─────────────────────────────────────────────
create table po_line_items (
  id                            uuid primary key default gen_random_uuid(),
  description                   text,
  po_id                         text,
  category                      text,
  quantity                      numeric,
  unit_price                    numeric(14,2),
  total                         numeric(14,2),
  parent_item_id                text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger po_line_items_set_updated before update on po_line_items for each row execute function set_updated_at();

-- ─── Tasks ─────────────────────────────────────────────────────
create table tasks (
  id                            uuid primary key default gen_random_uuid(),
  task_name                     text,
  project_code                  text,
  status                        text,
  assigned_to                   text,
  start_date                    date,
  end_date                      date,
  parent_task_id                text,
  "order"                       numeric,
  notes                         text,
  board_name                    text,
  board_id                      text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint tasks_status_chk check ("status" is null or "status" in ('Pendiente', 'En progreso', 'Completada', 'Bloqueada', 'Archivada'))
);
create trigger tasks_set_updated before update on tasks for each row execute function set_updated_at();

-- ─── Calendar Events ───────────────────────────────────────────
create table calendar_events (
  id                            uuid primary key default gen_random_uuid(),
  event_name                    text,
  project_code                  text,
  calendar_name                 text,
  event_date                    timestamptz,
  duration_hours                numeric,
  location                      text,
  attendees                     text,
  invite_sent                   boolean,
  notes                         text,
  parent_event_id               text,
  invite_status                 text,
  outlook_event_id              text,
  outlook_event_link            text,
  invite_body_html              text,
  invite_emails                 text,
  board_id                      text,
  restringir_reenvio            boolean,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint calendar_events_invite_status_chk check ("invite_status" is null or "invite_status" in ('Por crear', 'Por actualizar', 'Por cancelar', 'Enviado', 'Cancelado'))
);
create trigger calendar_events_set_updated before update on calendar_events for each row execute function set_updated_at();

-- ─── Messages ──────────────────────────────────────────────────
create table messages (
  id                            uuid primary key default gen_random_uuid(),
  message_id                    bigint generated by default as identity,
  channel                       text,
  sender_name                   text,
  sender_email                  text,
  content                       text,
  sent_at                       timestamptz,
  parent_message_id             text,
  reactions                     text,
  pinned                        boolean,
  attachments                   text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger messages_set_updated before update on messages for each row execute function set_updated_at();

-- ─── Board Columns ─────────────────────────────────────────────
create table board_columns (
  id                            uuid primary key default gen_random_uuid(),
  column_name                   text,
  board_id                      text,
  column_type                   text,
  options_json                  text,
  column_order                  numeric,
  deleted_at                    text,
  deleted_by                    text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger board_columns_set_updated before update on board_columns for each row execute function set_updated_at();
-- column_type: sin CHECK a propósito. Zite lo registró como single_select, pero
-- el campo mezcla tres conceptos que se fueron acumulando por separado: tipos
-- de columna reales (Texto, Número, Select...), tipos de gráfica (chart1..chart5)
-- y nombres de color de etiquetas de grupo (red-1..5, blue-1..5, etc). La lista de
-- colores es la que sigue creciendo sola conforme se usan más tonos en operación
-- (se vieron green-4, blue-4/5, purple-4, yellow-5 sin registrar) — no es una
-- enumeración cerrada, es un log de lo que se ha usado. Un CHECK aquí persigue
-- una lista que no para de crecer; validar el tipo de columna real, si hace
-- falta, debe vivir en la capa de aplicación, no en la base.

-- ─── Cell Values ───────────────────────────────────────────────
create table cell_values (
  id                            uuid primary key default gen_random_uuid(),
  cell_id                       bigint generated by default as identity,
  board_id                      text,
  row_id                        text,
  column_id                     text,
  text_value                    text,
  number_value                  numeric,
  date_value                    timestamptz,
  boolean_value                 boolean,
  file_url                      text,
  deleted_at                    text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger cell_values_set_updated before update on cell_values for each row execute function set_updated_at();

-- ─── Invoices ──────────────────────────────────────────────────
create table invoices (
  id                            uuid primary key default gen_random_uuid(),
  invoice_number                text,
  project_code                  text,
  client                        text,
  type                          text,
  amount                        numeric(14,2),
  currency                      text,
  issue_date                    date,
  due_date                      date,
  status                        text,
  pdf_url                       text,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint invoices_type_chk check ("type" is null or "type" in ('Factura', 'Nota de crédito')),
  constraint invoices_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD')),
  constraint invoices_status_chk check ("status" is null or "status" in ('Pendiente', 'Pagada', 'Vencida', 'Cancelada'))
);
create trigger invoices_set_updated before update on invoices for each row execute function set_updated_at();

-- ─── Payments ──────────────────────────────────────────────────
create table payments (
  id                            uuid primary key default gen_random_uuid(),
  payment_id                    bigint generated by default as identity,
  po_id                         text,
  invoice_id                    text,
  project_code                  text,
  type                          text,
  amount                        numeric(14,2),
  payment_date                  date,
  method                        text,
  reference                     text,
  status                        text,
  notes                         text,
  supplier_name                 text,
  currency                      text,
  attachment                    jsonb,
  due_date                      date,
  supplier_invoice_number       text,
  destination_account           text,
  source_company                text,
  source_bank                   text,
  source_account                text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint payments_type_chk check ("type" is null or "type" in ('Pago a proveedor', 'Cobro de cliente')),
  constraint payments_method_chk check ("method" is null or "method" in ('Transferencia', 'Cheque', 'Efectivo', 'Otro')),
  constraint payments_status_chk check ("status" is null or "status" in ('Programado', 'Realizado', 'Cancelado')),
  constraint payments_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD')),
  constraint payments_source_bank_chk check ("source_bank" is null or "source_bank" in ('BBVA', 'Banorte', 'Santander', 'HSBC', 'Banamex / Citibanamex', 'Scotiabank', 'Banregio', 'Inbursa', 'Afirme', 'Otro'))
);
create trigger payments_set_updated before update on payments for each row execute function set_updated_at();

-- ─── Documents ─────────────────────────────────────────────────
create table documents (
  id                            uuid primary key default gen_random_uuid(),
  document_name                 text,
  project_code                  text,
  category                      text,
  file_url                      text,
  uploaded_by                   text,
  upload_date                   date,
  version                       text,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint documents_category_chk check ("category" is null or "category" in ('Propuesta', 'Contrato', 'Entregable', 'Guía de discusión', 'Reporte', 'Presentación', 'Otro', 'Timeline', 'Calendario'))
);
create trigger documents_set_updated before update on documents for each row execute function set_updated_at();

-- ─── Boards ────────────────────────────────────────────────────
create table boards (
  id                            uuid primary key default gen_random_uuid(),
  board_name                    text,
  project_code                  text,
  board_order                   numeric,
  deleted_at                    timestamptz,
  board_type                    text,
  excel_columns_json            text,
  calendar_version              numeric,
  calendar_file_url             text,
  timeline_version              numeric,
  invite_template_json          text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger boards_set_updated before update on boards for each row execute function set_updated_at();

-- ─── Shared Views ──────────────────────────────────────────────
create table shared_views (
  id                            uuid primary key default gen_random_uuid(),
  view_name                     text,
  board_id                      text,
  project_code                  text,
  board_name                    text,
  token                         text,
  filters_json                  text,
  visible_columns_json          text,
  created_by                    text,
  active                        boolean,
  type                          text,
  shared_token                  text,
  view_order                    numeric,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint shared_views_type_chk check ("type" is null or "type" in ('Internal', 'External'))
);
create trigger shared_views_set_updated before update on shared_views for each row execute function set_updated_at();

-- ─── Chat Conversations ────────────────────────────────────────
create table chat_conversations (
  id                            uuid primary key default gen_random_uuid(),
  conversation_name             text,
  type                          text,
  members                       text,
  created_by                    text,
  created_at                    timestamptz,
  last_message_at               timestamptz,
  updated_at                    timestamptz not null default now(),
  constraint chat_conversations_type_chk check ("type" is null or "type" in ('DM', 'Group'))
);
create trigger chat_conversations_set_updated before update on chat_conversations for each row execute function set_updated_at();

-- ─── Billing Entities ──────────────────────────────────────────
create table billing_entities (
  id                            uuid primary key default gen_random_uuid(),
  company_name                  text,
  rfc                           text,
  address                       text,
  postal_code                   text,
  city                          text,
  state                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger billing_entities_set_updated before update on billing_entities for each row execute function set_updated_at();

-- ─── Supplier Invoices ─────────────────────────────────────────
create table supplier_invoices (
  id                            uuid primary key default gen_random_uuid(),
  invoice_number                text,
  po_id                         text,
  supplier_id                   text,
  supplier_name                 text,
  po_number                     text,
  amount                        numeric(14,2),
  currency                      text,
  pdf_file                      jsonb,
  xml_file                      jsonb,
  support_file                  jsonb,
  status                        text,
  upload_date                   timestamptz,
  uploaded_by                   text,
  review_notes                  text,
  reviewed_by                   text,
  reviewed_at                   timestamptz,
  project_code                  text,
  supplier_comment              text,
  subtotal                      numeric(14,2),
  iva_rate                      numeric(6,4),
  iva_amount                    numeric(14,2),
  retencion_iva                 numeric(14,2),
  retencion_isr                 numeric(14,2),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint supplier_invoices_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD')),
  constraint supplier_invoices_status_chk check ("status" is null or "status" in ('Pendiente', 'En revisión', 'Validada', 'Rechazada'))
);
create trigger supplier_invoices_set_updated before update on supplier_invoices for each row execute function set_updated_at();

-- ─── Approval Limits ───────────────────────────────────────────
create table approval_limits (
  id                            uuid primary key default gen_random_uuid(),
  limit_id                      bigint generated by default as identity,
  cost_center                   text,
  approval_level                text,
  max_amount                    numeric(14,2),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint approval_limits_cost_center_chk check ("cost_center" is null or "cost_center" in ('Reclutamiento e Incentivos', 'Logística', 'Moderaciones', 'Management', 'Otros')),
  constraint approval_limits_approval_level_chk check ("approval_level" is null or "approval_level" in ('Área', 'Finanzas'))
);
create trigger approval_limits_set_updated before update on approval_limits for each row execute function set_updated_at();

-- ─── App Settings ──────────────────────────────────────────────
create table app_settings (
  id                            uuid primary key default gen_random_uuid(),
  setting_key                   text,
  default_visible_pages         text[],
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint app_settings_default_visible_pages_chk check ("default_visible_pages" is null or "default_visible_pages" <@ array['Dashboard', 'Chat', 'CRM / Deals', 'Dashboard comercial', 'Proyectos', 'Órdenes de compra', 'Proveedores', 'Pagos a proveedores', 'Facturas de proveedores', 'Cobranza', 'Costos por proyecto', 'Dashboard financiero', 'Tableros flexibles']::text[])
);
create trigger app_settings_set_updated before update on app_settings for each row execute function set_updated_at();

-- ─── Petty Cash Funds ──────────────────────────────────────────
create table petty_cash_funds (
  id                            uuid primary key default gen_random_uuid(),
  fund_name                     text,
  initial_amount                numeric(14,2),
  current_balance               numeric(14,2),
  cost_center                   text,
  status                        text,
  last_replenishment_date       date,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint petty_cash_funds_cost_center_chk check ("cost_center" is null or "cost_center" in ('Reclutamiento e Incentivos', 'Logística', 'Moderaciones', 'Management', 'Otros')),
  constraint petty_cash_funds_status_chk check ("status" is null or "status" in ('Activo', 'Cerrado'))
);
create trigger petty_cash_funds_set_updated before update on petty_cash_funds for each row execute function set_updated_at();

-- ─── Task Comments ─────────────────────────────────────────────
create table task_comments (
  id                            uuid primary key default gen_random_uuid(),
  task_id                       text,
  message_id                    text,
  task_name                     text,
  channel                       text,
  sender_name                   text,
  sender_email                  text,
  content                       text,
  sent_at                       timestamptz,
  is_thread_reply               boolean,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger task_comments_set_updated before update on task_comments for each row execute function set_updated_at();

-- ─── Calendar Audit Log ────────────────────────────────────────
create table calendar_audit_logs (
  id                            uuid primary key default gen_random_uuid(),
  action                        text,
  event_name                    text,
  calendar_name                 text,
  project_code                  text,
  user_email                    text,
  user_name                     text,
  timestamp                     timestamptz,
  details                       text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger calendar_audit_logs_set_updated before update on calendar_audit_logs for each row execute function set_updated_at();

-- ─── PO Audit Log ──────────────────────────────────────────────
create table po_audit_logs (
  id                            uuid primary key default gen_random_uuid(),
  timestamp                     timestamptz,
  purchase_order_id             uuid references purchase_orders(id) on delete set null,
  action                        text,
  user_email                    text,
  user_name                     text,
  comments                      text,
  po_number                     text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint po_audit_logs_action_chk check ("action" is null or "action" in ('Creada', 'Editada', 'Enviada', 'Aprobada', 'Rechazada', 'Cancelada', 'Eliminada', 'Enviada a aprobación', 'Email enviado'))
);
create trigger po_audit_logs_set_updated before update on po_audit_logs for each row execute function set_updated_at();

-- ─── PoAttachments ─────────────────────────────────────────────
create table po_attachments (
  id                            uuid primary key default gen_random_uuid(),
  name                          text,
  purchase_order_id             uuid references purchase_orders(id) on delete set null,
  file_url                      text,
  description                   text,
  uploaded_by_email             text,
  uploaded_by_name              text,
  uploaded_at                   timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger po_attachments_set_updated before update on po_attachments for each row execute function set_updated_at();

-- ─── Deals ─────────────────────────────────────────────────────
create table deals (
  id                            uuid primary key default gen_random_uuid(),
  deal_name                     text,
  phase                         text,
  client                        text,
  project_type                  text,
  tematica                      text,
  owner_id                      uuid references users(id) on delete set null,
  proposal_date                 date,
  approval_date                 date,
  currency                      text,
  client_price                  numeric(14,2),
  taxes_pct                     numeric(6,4),
  quoted_cost                   numeric(14,2),
  notes                         text,
  retenciones                   numeric(6,4),
  empresa_operadora             text,
  punto_de_contacto             text,
  status_propuesta              text,
  hecha_por                     text,
  fecha_de_brief                date,
  fecha_perdida                 date,
  gerente                       text,
  exchange_rate                 numeric,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint deals_phase_chk check ("phase" is null or "phase" in ('Prospecto', 'Brief recibido', 'Cotización enviada', 'Negociación', 'Ganado', 'Perdido')),
  constraint deals_currency_chk check ("currency" is null or "currency" in ('MXN 🇲🇽', 'USD 🇺🇸', 'EUR 🇪🇺')),
  constraint deals_empresa_operadora_chk check ("empresa_operadora" is null or "empresa_operadora" in ('AGC', 'EME')),
  constraint deals_status_propuesta_chk check ("status_propuesta" is null or "status_propuesta" in ('Por hacer', 'Haciendo', 'Listo'))
);
create trigger deals_set_updated before update on deals for each row execute function set_updated_at();

-- ─── Expenses ──────────────────────────────────────────────────
create table expenses (
  id                            uuid primary key default gen_random_uuid(),
  expense_number                bigint generated by default as identity,
  description                   text,
  amount                        numeric(14,2),
  category                      text,
  payment_method                text,
  cost_center                   text,
  project_code                  text,
  currency                      text,
  expense_date                  date,
  status                        text,
  receipt                       jsonb,
  notes                         text,
  created_by                    text,
  approved_by                   text,
  rejection_reason              text,
  petty_cash_fund_id            uuid references petty_cash_funds(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint expenses_category_chk check ("category" is null or "category" in ('Viáticos', 'Transporte', 'Alimentación', 'Hospedaje', 'Compras menores', 'Papelería', 'Materiales', 'Otros')),
  constraint expenses_payment_method_chk check ("payment_method" is null or "payment_method" in ('Caja chica', 'Tarjeta corporativa', 'Reembolso empleado')),
  constraint expenses_cost_center_chk check ("cost_center" is null or "cost_center" in ('Reclutamiento e Incentivos', 'Logística', 'Moderaciones', 'Management', 'Otros')),
  constraint expenses_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD')),
  constraint expenses_status_chk check ("status" is null or "status" in ('Borrador', 'Enviado a aprobación', 'Aprobado', 'Rechazado'))
);
create trigger expenses_set_updated before update on expenses for each row execute function set_updated_at();

-- ─── Commercial Dashboard Views ────────────────────────────────
create table commercial_dashboard_views (
  id                            uuid primary key default gen_random_uuid(),
  view_name                     text,
  view_id                       text,
  owner_id                      uuid references users(id) on delete set null,
  is_default                    boolean,
  is_shared                     boolean,
  filters_json                  text,
  widgets_json                  text,
  date_reference                text,
  sort_order                    numeric,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint commercial_dashboard_views_date_reference_chk check ("date_reference" is null or "date_reference" in ('Fecha de propuesta', 'Fecha de aprobación'))
);
create trigger commercial_dashboard_views_set_updated before update on commercial_dashboard_views for each row execute function set_updated_at();

-- ─── Rubro Assignments ─────────────────────────────────────────
create table rubro_assignments (
  id                            uuid primary key default gen_random_uuid(),
  rubro                         text,
  assigned_user_id              uuid references users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger rubro_assignments_set_updated before update on rubro_assignments for each row execute function set_updated_at();

-- ─── Migration Log ─────────────────────────────────────────────
create table migration_logs (
  id                            uuid primary key default gen_random_uuid(),
  project_code                  text,
  board_id                      text,
  migrated                      numeric,
  failed                        numeric,
  skipped                       numeric,
  status                        text,
  duration_seconds              numeric,
  run_by_id                     uuid references users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint migration_logs_status_chk check ("status" is null or "status" in ('Completed', 'Partial', 'Error'))
);
create trigger migration_logs_set_updated before update on migration_logs for each row execute function set_updated_at();

-- ─── Projects ──────────────────────────────────────────────────
create table projects (
  id                            uuid primary key default gen_random_uuid(),
  project_code                  text,
  full_name                     text,
  status                        text,
  client                        text,
  budget                        numeric(14,2),
  start_date                    date,
  end_date                      date,
  description                   text,
  tematica                      text,
  timeline_status               text,
  timeline_url                  text,
  timeline_updated_at           timestamptz,
  teams_channel_url             text,
  teams_channel_status          text,
  deal_vinculado_id             uuid references deals(id) on delete set null,
  lider_id                      uuid references users(id) on delete set null,
  muestra                       text,
  muestra_imagen                text,
  instrucciones_de_analisis     text,
  last_analysis_json            text,
  last_analysis_at              timestamptz,
  created_by                    text,
  created_at                    timestamptz,
  updated_at                    timestamptz not null default now(),
  constraint projects_status_chk check ("status" is null or "status" in ('Prospecto', 'En curso', 'Finalizado', 'Cancelado', 'Activo', 'Stand by')),
  constraint projects_timeline_status_chk check ("timeline_status" is null or "timeline_status" in ('Pendiente', 'Listo', 'Error')),
  constraint projects_teams_channel_status_chk check ("teams_channel_status" is null or "teams_channel_status" in ('Pendiente', 'Creando', 'Listo', 'Error'))
);
create trigger projects_set_updated before update on projects for each row execute function set_updated_at();

-- ─── Cotizaciones ──────────────────────────────────────────────
create table cotizaciones (
  id                            uuid primary key default gen_random_uuid(),
  cotizacion_name               text,
  deal_id                       uuid references deals(id) on delete set null,
  status                        text,
  currency                      text,
  total_cost                    numeric(14,2),
  client_price                  numeric(14,2),
  notes                         text,
  included                      boolean,
  created_by_id                 uuid references users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint cotizaciones_status_chk check ("status" is null or "status" in ('Borrador', 'Enviada', 'Aprobada', 'Rechazada')),
  constraint cotizaciones_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD', 'EUR'))
);
create trigger cotizaciones_set_updated before update on cotizaciones for each row execute function set_updated_at();

-- ─── Deal Documents ────────────────────────────────────────────
create table deal_documents (
  id                            uuid primary key default gen_random_uuid(),
  document_name                 text,
  deal_id                       uuid references deals(id) on delete set null,
  doc_type                      text,
  version                       text,
  file_url                      text,
  file_name                     text,
  upload_date                   date,
  notes                         text,
  content                       text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint deal_documents_doc_type_chk check ("doc_type" is null or "doc_type" in ('Brief de cliente', 'Notas de brief', 'Solicitud de cambios', 'Propuesta PPT', 'Propuesta PDF', 'Otro'))
);
create trigger deal_documents_set_updated before update on deal_documents for each row execute function set_updated_at();

-- ─── Document Blocks ───────────────────────────────────────────
create table document_blocks (
  id                            uuid primary key default gen_random_uuid(),
  block_id                      bigint generated by default as identity,
  block_content                 text,
  block_type                    text,
  author_name                   text,
  author_email                  text,
  deal_id                       uuid references deals(id) on delete set null,
  sort_order                    numeric,
  created_at                    timestamptz,
  updated_at                    timestamptz,
  checklist_data                text,
  document_json                 text,
  constraint document_blocks_block_type_chk check ("block_type" is null or "block_type" in ('Texto', 'Checklist', 'Archivo', 'Divisor', 'Minuta'))
);
create trigger document_blocks_set_updated before update on document_blocks for each row execute function set_updated_at();

-- ─── Expense Audit Log ─────────────────────────────────────────
create table expense_audit_logs (
  id                            uuid primary key default gen_random_uuid(),
  timestamp                     text,
  expense_id                    uuid references expenses(id) on delete set null,
  action                        text,
  user_email                    text,
  user_name                     text,
  comments                      text,
  expense_number                text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint expense_audit_logs_action_chk check ("action" is null or "action" in ('Creado', 'Editado', 'Enviado a aprobación', 'Aprobado', 'Rechazado', 'Eliminado'))
);
create trigger expense_audit_logs_set_updated before update on expense_audit_logs for each row execute function set_updated_at();

-- ─── Expense Comments ──────────────────────────────────────────
create table expense_comments (
  id                            uuid primary key default gen_random_uuid(),
  comment                       text,
  expense_id                    uuid references expenses(id) on delete set null,
  author_email                  text,
  author_name                   text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger expense_comments_set_updated before update on expense_comments for each row execute function set_updated_at();

-- ─── Expense Line Items ────────────────────────────────────────
create table expense_line_items (
  id                            uuid primary key default gen_random_uuid(),
  description                   text,
  expense_id                    uuid references expenses(id) on delete set null,
  category                      text,
  amount                        numeric(14,2),
  date                          date,
  receipt                       jsonb,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint expense_line_items_category_chk check ("category" is null or "category" in ('Viáticos', 'Transporte', 'Alimentación', 'Hospedaje', 'Compras menores', 'Papelería', 'Materiales', 'Otros'))
);
create trigger expense_line_items_set_updated before update on expense_line_items for each row execute function set_updated_at();

-- ─── Collection Processes ──────────────────────────────────────
create table collection_processes (
  id                            uuid primary key default gen_random_uuid(),
  project_code                  text,
  deal_id                       uuid references deals(id) on delete set null,
  client                        text,
  currency                      text,
  quoted_amount                 numeric(14,2),
  collection_amount             numeric(14,2),
  phase                         text,
  applicable_phases             text,
  proforma_created_at           timestamptz,
  proforma_sent_at              timestamptz,
  invoice_created_at            timestamptz,
  invoice_sent_at               timestamptz,
  portal_uploaded_at            timestamptz,
  gr_migo_at                    timestamptz,
  scheduled_payment_date        date,
  paid_at                       date,
  invoice_number                text,
  status                        text,
  notes                         text,
  responsible_user_id           uuid references users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint collection_processes_currency_chk check ("currency" is null or "currency" in ('MXN', 'USD', 'EUR')),
  constraint collection_processes_phase_chk check ("phase" is null or "phase" in ('Por iniciar', 'Proforma creada', 'Proforma enviada', 'Factura creada', 'Factura enviada', 'Subida al portal', 'GR / Migo', 'Cobranza programada', 'Pagada', 'Atrasada')),
  constraint collection_processes_status_chk check ("status" is null or "status" in ('Al día', 'Atrasado', 'Pagado'))
);
create trigger collection_processes_set_updated before update on collection_processes for each row execute function set_updated_at();

-- ─── Cotizacion Line Items ─────────────────────────────────────
create table cotizacion_line_items (
  id                            uuid primary key default gen_random_uuid(),
  sub_rubro                     text,
  cotizacion_id                 uuid references cotizaciones(id) on delete set null,
  rubro                         text,
  cantidad                      numeric,
  unit_cost                     numeric(14,2),
  has_markup                    boolean,
  markup_pct                    numeric(6,4),
  final_price                   numeric(14,2),
  componentes                   numeric,
  included_in_budget            boolean,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint cotizacion_line_items_rubro_chk check ("rubro" is null or "rubro" in ('Reclutamiento e incentivos', 'Moderación', 'Management', 'Logística y operación', 'Back office'))
);
create trigger cotizacion_line_items_set_updated before update on cotizacion_line_items for each row execute function set_updated_at();


-- ═══ Relaciones N-N ═══════════════════════════════════════════
-- Los tres roles de equipo de un proyecto. En Zite eran los campos
-- Users."Projects (1)(2)(3)", nombres autogenerados sin significado.

-- Projects.Analistas ↔ Users
create table projects_analistas (
  project_id                    uuid not null references projects(id) on delete cascade,
  user_id                       uuid not null references users(id) on delete cascade,
  created_at                    timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Projects.Moderadores ↔ Users
create table projects_moderadores (
  project_id                    uuid not null references projects(id) on delete cascade,
  user_id                       uuid not null references users(id) on delete cascade,
  created_at                    timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- Projects.Asistentes ↔ Users
create table projects_asistentes (
  project_id                    uuid not null references projects(id) on delete cascade,
  user_id                       uuid not null references users(id) on delete cascade,
  created_at                    timestamptz not null default now(),
  primary key (project_id, user_id)
);


-- ═══ Índices ══════════════════════════════════════════════════════
-- Derivados de los filtros que ejecutan los 207 endpoints, no de suposiciones.
-- board_columns.board_id se filtra en 102 lugares; cell_values.board_id en 56.

create index on board_columns (board_id);
create index on board_columns (column_type);
create index on cell_values (board_id);
create index on cell_values (row_id);
create index on cell_values (board_id, row_id, column_id);
-- getDashboardData.ts filtra "¿en qué celdas está asignado este usuario?"
-- (text_value = user.id) para calcular tareas/eventos asignados por columna
-- dinámica. Sin índice en text_value, Postgres hacía Parallel Seq Scan sobre
-- las ~2.8M filas de cell_values buscando 0-pocas coincidencias — confirmado
-- con EXPLAIN ANALYZE: 8.8s de Seq Scan, ~90% del tiempo total del dashboard.
create index on cell_values (text_value);
-- Unicidad parcial real de producción (ver comentario de CONFLICT_TARGETS arriba
-- en este archivo) — no proviene del export de Zite, se agregó directo en
-- Supabase tras encontrar celdas duplicadas vivas para la misma posición.
create unique index cell_values_posicion_viva_uniq on cell_values (board_id, row_id, column_id) where deleted_at is null;
create index on boards (project_code);
create index on boards (board_name);
create index on boards (board_type);
create index on recruitment_rows (project_code);
create index on recruitment_rows (phone);
create index on recruitment_rows (email);
-- No viene del export de Zite (ahí tampoco existía, Zite nunca lo impidió):
-- se agregó tras encontrar 4 pares de proyectos duplicados con el mismo
-- project_code, creados por 3 rutas distintas (diálogo manual, botón "Crear
-- Proyecto" del deal, aprobación automática en approveDeal.ts) sin que
-- ninguna verificara si el código ya existía. case-insensitive y con trim
-- porque los duplicados reales diferían solo en mayúsculas ("Pacífico Day"
-- vs "Pacifico day"). Parcial (excluye código vacío/NULL) para no bloquear
-- los pocos proyectos sin código todavía.
create unique index projects_project_code_uniq on projects (lower(trim(project_code))) where project_code is not null and trim(project_code) <> '';
create index on projects (project_code);
create index on tasks (project_code);
create index on calendar_events (project_code);
create index on purchase_orders (project_code);
create index on purchase_orders (status);
create index on expenses (status);
create index on payments (status);
create index on supplier_invoices (status);
-- getMessages filtra por channel y ordena/pagina por sent_at (asc en la carga
-- inicial, desc al pedir mensajes anteriores) — sin este índice, ambas
-- consultas hacían Seq Scan (confirmado con EXPLAIN). La tabla es chica hoy
-- (1,743 filas), pero es el mismo patrón que ya costó caro en cell_values.
create index on messages (channel, sent_at);
-- Parcial, no un unique index simple: Zite representa "sin token" como "" (no
-- NULL), y a diferencia de NULL, Postgres exige que los strings vacíos sean
-- únicos entre sí. Con un índice simple, la primera fila sin token bloquea a
-- las demás (se vio en vivo: 250 de 462 Shared Views rechazadas por esto).
create unique index shared_views_token_uniq on shared_views (token) where token is not null and token <> '';
create unique index on users (lower(email));

-- El código filtra participantes con `contains`, que en Postgres es
-- ILIKE '%…%' y no aprovecha un btree. Requiere trigram.
create extension if not exists pg_trgm;
create index on recruitment_rows using gin (participant_name gin_trgm_ops);

-- REVISAR: project_code se usa como llave de negocio en 6 tablas pero es text
-- suelto, sin FK a projects. Decidir si se normaliza a project_id (recomendado)
-- o se deja denormalizado con FK a projects(project_code) unique.