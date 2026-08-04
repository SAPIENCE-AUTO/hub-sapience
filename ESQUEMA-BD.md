# Esquema de base de datos — Operations Hub (Hub Sapience)

Base Zite `512a1c4ecafe1e31` · 41 tablas · export 4

> Base tipo Airtable con campos tipados. `linked_record` = relación entre tablas.
> Al migrar a SQL: `single_select` → enum/lookup, `linked_record` → FK, `attachments` → tabla de archivos o storage externo.

## Users

| Campo | Tipo | Detalle |
|---|---|---|
| Email | `email` |  |
| First Name | `single_line_text` |  |
| Last Name | `single_line_text` |  |
| Role | `single_select` | opciones: `Owner`, `Socio`, `Head`, `Líder`, `Coordinador`, `Analista` |
| Last active at | `datetime` |  |
| Purchase Level | `single_select` | opciones: `Visor`, `Creador`, `Aprobador`, `Finanzas`, `Socios` |
| Cost Centers | `multiple_select` | opciones: `Reclutamiento e Incentivos`, `Logística`, `Moderaciones`, `Management`, `Otros` |
| Access comercial | `single_select` | opciones: `Sin acceso`, `Solo ver`, `Editar`, `Administrar` |
| Access operacion | `single_select` | opciones: `Sin acceso`, `Solo ver`, `Editar`, `Administrar` |
| Access admin | `single_select` | opciones: `Sin acceso`, `Solo ver`, `Editar`, `Administrar` |
| Access finanzas | `single_select` | opciones: `Sin acceso`, `Solo ver`, `Editar`, `Administrar` |
| Access otros | `single_select` | opciones: `Sin acceso`, `Solo ver`, `Editar`, `Administrar` |
| Max approval amount | `currency` | moneda |
| Visible Pages | `multiple_select` | opciones: `Dashboard`, `Chat`, `CRM / Deals`, `Dashboard comercial`, `Cotizaciones`, `Proyectos`, `Órdenes de compra`, `Proveedores`, `Pagos a proveedores`, `Facturas de proveedores`, `Cobranza`, `Costos por proyecto`, `Dashboard financiero`, `Tableros flexibles`, `Comprobación de gastos` |
| Deals | `linked_record` | → **Deals** |
| Hidden From Chat | `checkbox` |  |
| Profile Photo | `url` |  |
| Departamento | `single_select` | opciones: `Finanzas`, `Análisis`, `Reclutamiento`, `Logística` |
| Projects | `linked_record` | → **Projects** |
| Projects (1) | `linked_record` | → **Projects** (múltiple) |
| Projects (2) | `linked_record` | → **Projects** (múltiple) |
| Projects (3) | `linked_record` | → **Projects** (múltiple) |
| Dashboard Widgets | `multiple_select` | opciones: `Mis proyectos`, `Mis tareas`, `Próximos eventos`, `Órdenes de compra`, `Menciones recientes`, `Facturas recibidas` |
| Widget Layout | `long_text` |  |
| Commercial Dashboard Views | `linked_record` | → **Commercial Dashboard Views** |
| Active Channel | `single_line_text` |  |
| Collection Processes | `linked_record` | → **Collection Processes** |
| Rubro Assignments | `linked_record` | → **Rubro Assignments** |
| Cotizacion Rubros | `multiple_select` | opciones: `Reclutamiento e incentivos`, `Moderación`, `Management`, `Logística y operación`, `Back office` |
| Migration Log | `linked_record` | → **Migration Log** |

## Projects

| Campo | Tipo | Detalle |
|---|---|---|
| Project Code | `single_line_text` |  |
| Full Name | `single_line_text` |  |
| Status | `single_select` | opciones: `Prospecto`, `En curso`, `Finalizado`, `Cancelado`, `Activo` |
| Client | `single_line_text` |  |
| Budget | `currency` | moneda |
| Start Date | `date` |  |
| End Date | `date` |  |
| Description | `long_text` |  |
| Temática | `single_line_text` |  |
| Timeline status | `single_select` | opciones: `Pendiente`, `Listo`, `Error` |
| Timeline URL | `url` |  |
| Timeline updated at | `datetime` |  |
| Teams channel URL | `url` |  |
| Teams channel status | `single_select` | opciones: `Pendiente`, `Creando`, `Listo`, `Error` |
| Deal vinculado | `linked_record` | → **Deals** |
| Líder | `linked_record` | → **Users** |
| Analistas | `linked_record` | → **Users** (múltiple) |
| Moderadores | `linked_record` | → **Users** (múltiple) |
| Asistentes | `linked_record` | → **Users** (múltiple) |
| Muestra | `long_text` |  |
| Muestra Imagen | `url` |  |
| Instrucciones de Análisis | `long_text` |  |
| Last Analysis JSON | `long_text` |  |
| Last Analysis At | `datetime` |  |
| Created By | `email` |  |
| Created At | `datetime` |  |

## CRM Items

| Campo | Tipo | Detalle |
|---|---|---|
| Item Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Client | `single_line_text` |  |
| Status | `single_select` | opciones: `Prospecto`, `Propuesta enviada`, `Negociación`, `Ganado`, `Perdido` |
| Proposal Date | `date` |  |
| Contract Date | `date` |  |
| Budget | `currency` | moneda |
| Revenue | `currency` | moneda |
| Assigned To | `single_line_text` |  |
| Notes | `long_text` |  |

## Participants

| Campo | Tipo | Detalle |
|---|---|---|
| Full Name | `single_line_text` |  |
| Email | `email` |  |
| Phone | `phone_number` |  |
| ID Number | `single_line_text` |  |
| City | `single_line_text` |  |
| Gender | `single_select` | opciones: `Femenino`, `Masculino`, `Otro` |
| Age | `number` |  |
| Total Sessions | `number` |  |
| Notes | `long_text` |  |

## Recruitment Rows

| Campo | Tipo | Detalle |
|---|---|---|
| Row Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Board Name | `single_line_text` |  |
| Participant Name | `single_line_text` |  |
| Email | `email` |  |
| Phone | `phone_number` |  |
| ID Number | `single_line_text` |  |
| Status | `single_select` | opciones: `Pendiente`, `Contactado`, `Confirmado`, `Asistió`, `No show`, `Descartado`, `Rechazado`, `Posible Candidato`, `Canceló participante`, `OK`, `Checar`, `Back Up`, `ABANDONO`, `CANCELADO`, `Rechazado por perfil`, `Rechazado por NSE`, `BU`, `CANCELO`, `Se pasa de edad`, `Cuota llena`, `NO CONTINUO`, `No es el perfil`, `Se baja de NSE`, `Prueba`, `Posible Candidata`, `No contesta`, `Ya en proyectos`, `No puede`, `MARCAR`, `FALTA CONFIRMAR`, `Duplicado`, `Canceló`, `NSE CT`, `BU LOYAL ENSURE`, `sesiones`, `Cuota llena - Posible candidato`, `Filtro duplicado`, `OK - DUPLA 1`, `OK - ENTREVISTA`, `OK - DUPLA 2`, `BU - DUPLA 2`, `BU - DUPLA 1`, `Consume ambas`, `Ya participó`, `Cancela`, `llenar nuevo filtro`, `OK - Principal`, `OK - Back Up`, `Principal / OK`, `Back Up / OK (para los 2)`, `No es perfil`, `FORTALEZA`, `Se baja NSE`, `No contesto nada`, `RECHAZADA`, `No termino el filtro`, `No subió foto`, `CLIENTE`, `SAPIENCE`, `CANCELADA`, `Rechazado por dirección`, `Rechazado /No es perfil`, `Rechazado / Se baja de NSE`, `XÓLOTL`, `Rechazado por perfil/Participó en otro proyecto`, `ES DE CDMX`, `Rechazado / Filtro mal llenado`, `QRO`, `Rechazado / No es el perfil`, `Rechazado / por edad`, `No es el rango de edad`, `Vetada`, `Vetado`, `Rechazada / No es Perfil`, `Ya participo`, `.`, `Rechazado / Multiproyectos`, `14`, `Status`, `56`, `61`, `66`, `70`, `Rechazado - no es perfil`, `Rechazado - Se baja de NSE`, `PP T2`, `Posible Candidato T6`, `Posible Candidato T2`, `Posible Candidato T1`, `GREEN - T1`, `PP T1`, `Posible Participante S5` |
| Group | `single_line_text` |  |
| Parent Row ID | `single_line_text` |  |
| Level | `number` |  |
| NDA Sent | `checkbox` |  |
| NDA Sent Date | `datetime` |  |
| Notes | `long_text` |  |
| Source Form | `single_line_text` |  |
| Deleted at | `single_line_text` |  |
| Cell data | `long_text` |  |
| Row Order | `number` |  |
| Board ID | `single_line_text` |  |

## Suppliers

| Campo | Tipo | Detalle |
|---|---|---|
| Supplier Name | `single_line_text` |  |
| Tax ID | `single_line_text` |  |
| Contact Name | `single_line_text` |  |
| Email | `email` |  |
| Phone | `phone_number` |  |
| Bank Name | `single_line_text` |  |
| Bank Account | `single_line_text` |  |
| Notes | `long_text` |  |
| Categories | `multiple_select` | opciones: `Reclutamiento e Incentivos`, `Logística`, `Moderaciones`, `Management`, `Otros`, `RECLUTAMIENTO`, `MODERADORES` |
| Identifier | `single_line_text` |  |
| Address | `long_text` |  |
| Tax regime | `single_select` | opciones: `General de Ley Personas Morales`, `RESICO`, `Régimen de Incorporación Fiscal`, `Actividades Empresariales y Profesionales`, `Sueldos y Salarios`, `Arrendamiento`, `Sin obligaciones fiscales`, `Otro`, `Persona Física con Actividad Empresarial` |
| Person type | `single_select` | opciones: `Física`, `Moral` |
| Country | `single_line_text` |  |
| Access token | `single_line_text` |  |
| Portal password | `single_line_text` |  |

## Purchase Orders

| Campo | Tipo | Detalle |
|---|---|---|
| PO Number | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Supplier Name | `single_line_text` |  |
| Issue Date | `date` |  |
| Total Amount | `currency` | moneda |
| Status | `single_select` | opciones: `Borrador`, `Enviada a aprobación`, `Aprobada`, `Factura recibida`, `Factura validada`, `Pago programado`, `Pagada`, `Cancelada` |
| PDF URL | `url` |  |
| Notes | `long_text` |  |
| Category | `single_select` | opciones: `Reclutamiento e Incentivos`, `Logística`, `Moderaciones`, `Management`, `Otros` |
| Payment Terms | `single_select` | opciones: `Contado`, `15 días`, `30 días`, `60 días`, `1 día`, `10 días`, `28 días`, `wrf`, `34`, `334`, `greqt`, `1`, `30 dias`, `30`, `28`, `7 días`, `Un día`, `a 30 días`, `día siguiente`, `7`, `2`, `5` |
| Currency | `single_select` | opciones: `MXN`, `USD` |
| Created By | `single_line_text` |  |
| Approved By | `single_line_text` |  |
| Service description | `long_text` |  |
| Billing entity | `single_line_text` |  |
| Email sent at | `datetime` |  |
| Email sent to | `single_line_text` |  |
| Tipo de OC | `single_select` | opciones: `Normal`, `Anticipo`, `Cierre` |
| PO Audit Log | `linked_record` | → **PO Audit Log** |
| Rejection reason | `long_text` |  |
| PDF file | `attachments` |  |
| PDF base64 | `long_text` |  |
| PoAttachments | `linked_record` | → **PoAttachments** |
| Origen | `single_select` | opciones: `Migrada`, `Sistema` |

## PO Line Items

| Campo | Tipo | Detalle |
|---|---|---|
| Description | `single_line_text` |  |
| PO ID | `single_line_text` |  |
| Category | `single_line_text` |  |
| Quantity | `number` |  |
| Unit Price | `currency` | moneda |
| Total | `currency` | moneda |
| Parent Item ID | `single_line_text` |  |

## Tasks

| Campo | Tipo | Detalle |
|---|---|---|
| Task Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Status | `single_select` | opciones: `Pendiente`, `En progreso`, `Completada`, `Bloqueada` |
| Assigned To | `single_line_text` |  |
| Start Date | `date` |  |
| End Date | `date` |  |
| Parent Task ID | `single_line_text` |  |
| Order | `number` |  |
| Notes | `long_text` |  |
| Board Name | `single_line_text` |  |
| Board ID | `single_line_text` |  |

## Calendar Events

| Campo | Tipo | Detalle |
|---|---|---|
| Event Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Calendar Name | `single_line_text` |  |
| Event Date | `datetime` |  |
| Duration Hours | `number` |  |
| Location | `single_line_text` |  |
| Attendees | `long_text` |  |
| Invite Sent | `checkbox` |  |
| Notes | `long_text` |  |
| Parent Event ID | `single_line_text` |  |
| Invite Status | `single_select` | opciones: `Por crear`, `Por actualizar`, `Por cancelar`, `Enviado`, `Cancelado` |
| Outlook Event ID | `single_line_text` |  |
| Outlook Event Link | `url` |  |
| Invite Body HTML | `long_text` |  |
| Invite emails | `long_text` |  |
| Board ID | `single_line_text` |  |
| Restringir Reenvío | `checkbox` |  |

## Messages

| Campo | Tipo | Detalle |
|---|---|---|
| Message ID | `autonumber` |  |
| Channel | `single_line_text` |  |
| Sender Name | `single_line_text` |  |
| Sender Email | `single_line_text` |  |
| Content | `long_text` |  |
| Sent At | `datetime` |  |
| Parent message ID | `single_line_text` |  |
| Reactions | `long_text` |  |
| Pinned | `checkbox` |  |
| Attachments | `long_text` |  |

## Board Columns

| Campo | Tipo | Detalle |
|---|---|---|
| Column Name | `single_line_text` |  |
| Board ID | `single_line_text` |  |
| Column Type | `single_select` | opciones: `Texto`, `Número`, `Fecha`, `Checkbox`, `Select`, `Persona`, `Email`, `Teléfono`, `Archivo`, `Rating`, `Botón`, `Datetime`, `Status`, `chart1`, `chart2`, `Color`, `chart3`, `__fillout_link__`, `chart4`, `chart5`, `primary`, `destructive`, `muted`, `orange-1`, `yellow-1`, `purple-3`, `red-1`, `purple-1`, `green-2`, `green-1`, `blue-1`, `red-2`, `orange-2`, `yellow-2`, `blue-2`, `purple-2`, `red-3`, `orange-3`, `yellow-3`, `green-3`, `blue-3`, `red-4`, `orange-4`, `yellow-4` |
| Options JSON | `long_text` |  |
| Column Order | `number` |  |
| Deleted at | `single_line_text` |  |
| Deleted By | `single_line_text` |  |

## Cell Values

| Campo | Tipo | Detalle |
|---|---|---|
| Cell ID | `autonumber` |  |
| Board ID | `single_line_text` |  |
| Row ID | `single_line_text` |  |
| Column ID | `single_line_text` |  |
| Text Value | `long_text` |  |
| Number Value | `number` |  |
| Date Value | `datetime` |  |
| Boolean Value | `checkbox` |  |
| File URL | `url` |  |
| Deleted at | `single_line_text` |  |

## Invoices

| Campo | Tipo | Detalle |
|---|---|---|
| Invoice Number | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Client | `single_line_text` |  |
| Type | `single_select` | opciones: `Factura`, `Nota de crédito` |
| Amount | `currency` | moneda |
| Currency | `single_select` | opciones: `MXN`, `USD` |
| Issue Date | `date` |  |
| Due Date | `date` |  |
| Status | `single_select` | opciones: `Pendiente`, `Pagada`, `Vencida`, `Cancelada` |
| PDF URL | `url` |  |
| Notes | `long_text` |  |

## Payments

| Campo | Tipo | Detalle |
|---|---|---|
| Payment ID | `autonumber` |  |
| PO ID | `single_line_text` |  |
| Invoice ID | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Type | `single_select` | opciones: `Pago a proveedor`, `Cobro de cliente` |
| Amount | `currency` | moneda |
| Payment Date | `date` |  |
| Method | `single_select` | opciones: `Transferencia`, `Cheque`, `Efectivo`, `Otro` |
| Reference | `single_line_text` |  |
| Status | `single_select` | opciones: `Programado`, `Realizado`, `Cancelado` |
| Notes | `long_text` |  |
| Supplier name | `single_line_text` |  |
| Currency | `single_select` | opciones: `MXN`, `USD` |
| Attachment | `attachments` |  |
| Due date | `date` |  |
| Supplier invoice number | `single_line_text` |  |
| Destination account | `single_line_text` |  |
| Source company | `single_line_text` |  |
| Source bank | `single_select` | opciones: `BBVA`, `Banorte`, `Santander`, `HSBC`, `Banamex / Citibanamex`, `Scotiabank`, `Banregio`, `Inbursa`, `Afirme`, `Otro` |
| Source account | `single_line_text` |  |

## Documents

| Campo | Tipo | Detalle |
|---|---|---|
| Document Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Category | `single_select` | opciones: `Propuesta`, `Contrato`, `Entregable`, `Guía de discusión`, `Reporte`, `Presentación`, `Otro`, `Timeline`, `Calendario` |
| File URL | `url` |  |
| Uploaded By | `single_line_text` |  |
| Upload Date | `date` |  |
| Version | `single_line_text` |  |
| Notes | `long_text` |  |

## Boards

| Campo | Tipo | Detalle |
|---|---|---|
| Board Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Board Order | `number` |  |
| Deleted At | `datetime` |  |
| Board Type | `single_line_text` |  |
| Excel Columns JSON | `long_text` |  |
| Calendar version | `number` |  |
| Calendar file URL | `url` |  |
| Timeline Version | `number` |  |

## Shared Views

| Campo | Tipo | Detalle |
|---|---|---|
| View Name | `single_line_text` |  |
| Board ID | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| Board Name | `single_line_text` |  |
| Token | `single_line_text` |  |
| Filters JSON | `long_text` |  |
| Visible Columns JSON | `long_text` |  |
| Created By | `email` |  |
| Active | `checkbox` |  |
| Type | `single_select` | opciones: `Internal`, `External` |
| Shared Token | `single_line_text` |  |
| View Order | `number` |  |

## Chat Conversations

| Campo | Tipo | Detalle |
|---|---|---|
| Conversation name | `single_line_text` |  |
| Type | `single_select` | opciones: `DM`, `Group` |
| Members | `long_text` |  |
| Created by | `email` |  |
| Created at | `datetime` |  |
| Last message at | `datetime` |  |

## Billing Entities

| Campo | Tipo | Detalle |
|---|---|---|
| Company name | `single_line_text` |  |
| RFC | `single_line_text` |  |
| Address | `single_line_text` |  |
| Postal code | `single_line_text` |  |
| City | `single_line_text` |  |
| State | `single_line_text` |  |

## Supplier Invoices

| Campo | Tipo | Detalle |
|---|---|---|
| Invoice number | `single_line_text` |  |
| PO ID | `single_line_text` |  |
| Supplier ID | `single_line_text` |  |
| Supplier name | `single_line_text` |  |
| PO number | `single_line_text` |  |
| Amount | `currency` | moneda |
| Currency | `single_select` | opciones: `MXN`, `USD` |
| PDF file | `attachments` |  |
| XML file | `attachments` |  |
| Support file | `attachments` |  |
| Status | `single_select` | opciones: `Pendiente`, `En revisión`, `Validada`, `Rechazada` |
| Upload date | `datetime` |  |
| Uploaded by | `single_line_text` |  |
| Review notes | `long_text` |  |
| Reviewed by | `single_line_text` |  |
| Reviewed at | `datetime` |  |
| Project code | `single_line_text` |  |
| Supplier comment | `long_text` |  |
| Subtotal | `currency` | moneda |
| IVA Rate | `percent` |  |
| IVA Amount | `currency` | moneda |
| Retención IVA | `currency` | moneda |
| Retención ISR | `currency` | moneda |

## Approval Limits

| Campo | Tipo | Detalle |
|---|---|---|
| Limit ID | `autonumber` |  |
| Cost center | `single_select` | opciones: `Reclutamiento e Incentivos`, `Logística`, `Moderaciones`, `Management`, `Otros` |
| Approval level | `single_select` | opciones: `Área`, `Finanzas` |
| Max amount | `currency` | moneda |

## PO Audit Log

| Campo | Tipo | Detalle |
|---|---|---|
| Timestamp | `datetime` |  |
| Purchase order | `linked_record` | → **Purchase Orders** |
| Action | `single_select` | opciones: `Creada`, `Editada`, `Enviada`, `Aprobada`, `Rechazada`, `Cancelada`, `Eliminada`, `Enviada a aprobación`, `Email enviado` |
| User email | `email` |  |
| User name | `single_line_text` |  |
| Comments | `long_text` |  |
| PO number | `single_line_text` |  |

## PoAttachments

| Campo | Tipo | Detalle |
|---|---|---|
| Name | `single_line_text` |  |
| Purchase order | `linked_record` | → **Purchase Orders** |
| File URL | `url` |  |
| Description | `single_line_text` |  |
| Uploaded by email | `email` |  |
| Uploaded by name | `single_line_text` |  |
| Uploaded at | `datetime` |  |

## App Settings

| Campo | Tipo | Detalle |
|---|---|---|
| Setting Key | `single_line_text` |  |
| Default Visible Pages | `multiple_select` | opciones: `Dashboard`, `Chat`, `CRM / Deals`, `Dashboard comercial`, `Proyectos`, `Órdenes de compra`, `Proveedores`, `Pagos a proveedores`, `Facturas de proveedores`, `Cobranza`, `Costos por proyecto`, `Dashboard financiero`, `Tableros flexibles` |

## Deals

| Campo | Tipo | Detalle |
|---|---|---|
| Deal Name | `single_line_text` |  |
| Phase | `single_select` | opciones: `Prospecto`, `Brief recibido`, `Cotización enviada`, `Negociación`, `Ganado`, `Perdido` |
| Client | `single_line_text` |  |
| Project Type | `single_line_text` |  |
| Tematica | `single_line_text` |  |
| Owner | `linked_record` | → **Users** |
| Proposal Date | `date` |  |
| Approval Date | `date` |  |
| Currency | `single_select` | opciones: `MXN 🇲🇽`, `USD 🇺🇸`, `EUR 🇪🇺` |
| Client Price | `currency` | moneda |
| Taxes Pct | `percent` |  |
| Quoted Cost | `currency` | moneda |
| Notes | `long_text` |  |
| Cotizaciones | `linked_record` | → **Cotizaciones** |
| Deal Documents | `linked_record` | → **Deal Documents** |
| Retenciones (%) | `percent` |  |
| Document Blocks | `linked_record` | → **Document Blocks** |
| Projects | `linked_record` | → **Projects** |
| Empresa operadora | `single_select` | opciones: `AGC`, `EME` |
| Punto de contacto | `single_line_text` |  |
| Status propuesta | `single_select` | opciones: `Por hacer`, `Haciendo`, `Listo` |
| Hecha por | `single_line_text` |  |
| Fecha de brief | `date` |  |
| Fecha perdida | `date` |  |
| Gerente | `single_line_text` |  |
| Exchange Rate | `number` |  |
| Collection Processes | `linked_record` | → **Collection Processes** |

## Cotizaciones

| Campo | Tipo | Detalle |
|---|---|---|
| Cotizacion Name | `single_line_text` |  |
| Deal | `linked_record` | → **Deals** |
| Status | `single_select` | opciones: `Borrador`, `Enviada`, `Aprobada`, `Rechazada` |
| Currency | `single_select` | opciones: `MXN`, `USD`, `EUR` |
| Total Cost | `currency` | moneda |
| Client Price | `currency` | moneda |
| Notes | `long_text` |  |
| Cotizacion Line Items | `linked_record` | → **Cotizacion Line Items** |
| Included | `checkbox` |  |

## Cotizacion Line Items

| Campo | Tipo | Detalle |
|---|---|---|
| Sub Rubro | `single_line_text` |  |
| Cotizacion | `linked_record` | → **Cotizaciones** |
| Rubro | `single_select` | opciones: `Reclutamiento e incentivos`, `Moderación`, `Management`, `Logística y operación`, `Back office` |
| Cantidad | `number` |  |
| Unit Cost | `currency` | moneda |
| Has Markup | `checkbox` |  |
| Markup Pct | `percent` |  |
| Final Price | `currency` | moneda |
| Componentes | `number` |  |
| Included In Budget | `checkbox` |  |

## Deal Documents

| Campo | Tipo | Detalle |
|---|---|---|
| Document Name | `single_line_text` |  |
| Deal | `linked_record` | → **Deals** |
| Doc Type | `single_select` | opciones: `Brief de cliente`, `Notas de brief`, `Solicitud de cambios`, `Propuesta PPT`, `Propuesta PDF`, `Otro` |
| Version | `single_line_text` |  |
| File URL | `url` |  |
| File Name | `single_line_text` |  |
| Upload Date | `date` |  |
| Notes | `long_text` |  |
| Content | `rich_text` |  |

## Document Blocks

| Campo | Tipo | Detalle |
|---|---|---|
| Block ID | `autonumber` |  |
| Block content | `rich_text` |  |
| Block type | `single_select` | opciones: `Texto`, `Checklist`, `Archivo`, `Divisor`, `Minuta` |
| Author name | `single_line_text` |  |
| Author email | `email` |  |
| Deal | `linked_record` | → **Deals** |
| Sort order | `number` |  |
| Created at | `datetime` |  |
| Updated at | `datetime` |  |
| Checklist data | `long_text` |  |
| Document JSON | `long_text` |  |

## Petty Cash Funds

| Campo | Tipo | Detalle |
|---|---|---|
| Fund Name | `single_line_text` |  |
| Initial Amount | `currency` | moneda |
| Current Balance | `currency` | moneda |
| Cost Center | `single_select` | opciones: `Reclutamiento e Incentivos`, `Logística`, `Moderaciones`, `Management`, `Otros` |
| Status | `single_select` | opciones: `Activo`, `Cerrado` |
| Last Replenishment Date | `date` |  |
| Notes | `long_text` |  |
| Created At | `created_at` |  |
| Expenses | `linked_record` | → **Expenses** |

## Expenses

| Campo | Tipo | Detalle |
|---|---|---|
| Expense Number | `autonumber` |  |
| Description | `single_line_text` |  |
| Amount | `currency` | moneda |
| Category | `single_select` | opciones: `Viáticos`, `Transporte`, `Alimentación`, `Hospedaje`, `Compras menores`, `Papelería`, `Materiales`, `Otros` |
| Payment Method | `single_select` | opciones: `Caja chica`, `Tarjeta corporativa`, `Reembolso empleado` |
| Cost Center | `single_select` | opciones: `Reclutamiento e Incentivos`, `Logística`, `Moderaciones`, `Management`, `Otros` |
| Project Code | `single_line_text` |  |
| Currency | `single_select` | opciones: `MXN`, `USD` |
| Expense Date | `date` |  |
| Status | `single_select` | opciones: `Borrador`, `Enviado a aprobación`, `Aprobado`, `Rechazado` |
| Receipt | `attachments` |  |
| Notes | `long_text` |  |
| Created By | `single_line_text` |  |
| Approved By | `single_line_text` |  |
| Rejection Reason | `single_line_text` |  |
| Petty Cash Fund | `linked_record` | → **Petty Cash Funds** |
| Created At | `created_at` |  |
| Expense Audit Log | `linked_record` | → **Expense Audit Log** |
| Expense Comments | `linked_record` | → **Expense Comments** |
| Expense Line Items | `linked_record` | → **Expense Line Items** |

## Expense Audit Log

| Campo | Tipo | Detalle |
|---|---|---|
| Timestamp | `single_line_text` |  |
| Expense | `linked_record` | → **Expenses** |
| Action | `single_select` | opciones: `Creado`, `Editado`, `Enviado a aprobación`, `Aprobado`, `Rechazado`, `Eliminado` |
| User Email | `single_line_text` |  |
| User Name | `single_line_text` |  |
| Comments | `long_text` |  |
| Expense Number | `single_line_text` |  |

## Expense Comments

| Campo | Tipo | Detalle |
|---|---|---|
| Comment | `long_text` |  |
| Expense | `linked_record` | → **Expenses** |
| Author Email | `single_line_text` |  |
| Author Name | `single_line_text` |  |
| Created At | `created_at` |  |

## Task Comments

| Campo | Tipo | Detalle |
|---|---|---|
| Task ID | `single_line_text` |  |
| Message ID | `single_line_text` |  |
| Task Name | `single_line_text` |  |
| Channel | `single_line_text` |  |
| Sender Name | `single_line_text` |  |
| Sender Email | `email` |  |
| Content | `long_text` |  |
| Sent At | `datetime` |  |
| Is Thread Reply | `checkbox` |  |

## Expense Line Items

| Campo | Tipo | Detalle |
|---|---|---|
| Description | `single_line_text` |  |
| Expense | `linked_record` | → **Expenses** |
| Category | `single_select` | opciones: `Viáticos`, `Transporte`, `Alimentación`, `Hospedaje`, `Compras menores`, `Papelería`, `Materiales`, `Otros` |
| Amount | `currency` | moneda |
| Date | `date` |  |
| Receipt | `attachments` |  |
| Notes | `single_line_text` |  |

## Commercial Dashboard Views

| Campo | Tipo | Detalle |
|---|---|---|
| View Name | `single_line_text` |  |
| View ID | `single_line_text` |  |
| Owner | `linked_record` | → **Users** |
| Is Default | `checkbox` |  |
| Is Shared | `checkbox` |  |
| Filters JSON | `long_text` |  |
| Widgets JSON | `long_text` |  |
| Date Reference | `single_select` | opciones: `Fecha de propuesta`, `Fecha de aprobación` |
| Sort Order | `number` |  |
| Created At | `created_at` |  |
| Updated At | `updated_at` |  |

## Calendar Audit Log

| Campo | Tipo | Detalle |
|---|---|---|
| Action | `single_line_text` |  |
| Event Name | `single_line_text` |  |
| Calendar Name | `single_line_text` |  |
| Project Code | `single_line_text` |  |
| User Email | `email` |  |
| User Name | `single_line_text` |  |
| Timestamp | `datetime` |  |
| Details | `long_text` |  |

## Collection Processes

| Campo | Tipo | Detalle |
|---|---|---|
| Project Code | `single_line_text` |  |
| Deal | `linked_record` | → **Deals** |
| Client | `single_line_text` |  |
| Currency | `single_select` | opciones: `MXN`, `USD`, `EUR` |
| Quoted Amount | `currency` | moneda |
| Collection Amount | `currency` | moneda |
| Phase | `single_select` | opciones: `Por iniciar`, `Proforma creada`, `Proforma enviada`, `Factura creada`, `Factura enviada`, `Subida al portal`, `GR / Migo`, `Cobranza programada`, `Pagada`, `Atrasada` |
| Applicable Phases | `long_text` |  |
| Proforma Created At | `datetime` |  |
| Proforma Sent At | `datetime` |  |
| Invoice Created At | `datetime` |  |
| Invoice Sent At | `datetime` |  |
| Portal Uploaded At | `datetime` |  |
| GR Migo At | `datetime` |  |
| Scheduled Payment Date | `date` |  |
| Paid At | `date` |  |
| Invoice Number | `single_line_text` |  |
| Status | `single_select` | opciones: `Al día`, `Atrasado`, `Pagado` |
| Notes | `long_text` |  |
| Responsible User | `linked_record` | → **Users** |

## Rubro Assignments

| Campo | Tipo | Detalle |
|---|---|---|
| Rubro | `single_line_text` |  |
| Assigned User | `linked_record` | → **Users** |

## Migration Log

| Campo | Tipo | Detalle |
|---|---|---|
| Project Code | `single_line_text` |  |
| Board Id | `single_line_text` |  |
| Migrated | `number` |  |
| Failed | `number` |  |
| Skipped | `number` |  |
| Status | `single_select` | opciones: `Completed`, `Partial`, `Error` |
| Duration Seconds | `number` |  |
| Run By | `linked_record` | → **Users** |
| Created At | `created_at` |  |
