# Hub Sapience — Gestor de Proyectos de Investigación

Plataforma interna de operaciones de **Sapience** (agencia de investigación de mercados, México).
Este documento es el contexto autoritativo para trabajar sobre el código. Fue derivado del export
oficial de Zite (`___ZITE_EXPORT_VERSION___: 4`), no de inferencias.

---

## 1. Qué es la app

Flujo de negocio que cubre, de punta a punta:

```
CRM/Deal → Cotización → Proyecto → Reclutamiento de participantes → Sesiones (Teams)
         → Órdenes de compra → Facturas de proveedor → Pagos → Cobranza
         → Costos y P&L por proyecto
```

Más capas transversales: chat interno con presencia, tableros flexibles tipo Monday,
editor de documentos por bloques, dashboards configurables y portal externo de proveedores.

**Usuarios:** equipo interno de Sapience con roles (`Owner`, `Socio`, `Head`, `Líder`,
`Coordinador`, `Analista`) y permisos granulares por área (comercial, operación, admin,
finanzas) + niveles de compra (`Visor`, `Creador`, `Aprobador`, `Finanzas`, `Socios`)
+ lista blanca de páginas visibles por usuario.

---

## 2. Plataforma: Zite

⚠️ **Dato crítico:** la app **no es un proyecto Vite/Next estándar**. Corre en **Zite**
(plataforma de Fillout). No hay `package.json`, `tsconfig.json` ni `index.html` en el repo:
Zite los abstrae. Por eso el export trae `zite.config.json` y `zite.lock`.

### Backend: endpoints

Cada archivo en `src/api/` es **un endpoint** que exporta por default `createEndpoint(...)`
del SDK `zite-integrations-backend-sdk`, con validación zod de entrada y salida:

```ts
import { z } from 'zod';
import { createEndpoint, Deals } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Get all deals',
  inputSchema: z.object({}),
  outputSchema: z.object({ deals: z.array(DealOut) }),
  execute: async () => {
    const result = await Deals.findAll({});
    return { deals: result.records.map(...) };
  },
});
```

- **207 endpoints** compilados (`build.bundledEndpoints`).
- El acceso a datos es vía **modelos con nombre exportados del SDK** (`Deals`, `CellValues`, …),
  estilo ORM sobre la base de Zite. No hay SQL ni cliente de BD.
- `authenticated: true` es el default de facto; el portal de proveedores usa tokens.

### Frontend

- React + **react-router-dom** (`BrowserRouter` / `Routes`), con `ErrorBoundary` propio en `App.tsx`.
- **Tailwind** (`tailwind.config.ts`) + **shadcn/ui** (`@/components/ui/*`) + **lucide-react**.
- **PWA habilitada** (`pwaSettings`), título "Hub Sapience".
- Providers globales: `ProjectProvider` (`src/context/ProjectContext.tsx`) y
  `TeamMembersProvider` (exportado desde `components/DynamicColumns.tsx`).

### Autenticación

`accessMode: external`, **signup deshabilitado**. Métodos: **magic link** y **Google sign-in**
(SSO apagado). Los usuarios se sincronizan contra la tabla `Users` vía `userSync` en `zite.config.json`.

---

## 3. Base de datos: "Operations Hub"

41 tablas, base tipo Airtable con campos tipados (ver `ESQUEMA-BD.md` para el detalle completo).

Tipos usados: `single_line_text` (160), `single_select` (64), `long_text` (50),
`linked_record` (42), `currency` (27), `datetime` (26), `date` (22), `number` (22),
`checkbox` (13), `email` (12), `url` (12), `attachments` (7), `multiple_select` (6),
`autonumber` (6), `created_at` (5), `percent` (4), `phone_number` (3), `rich_text` (2), `updated_at` (1).

### Tablas por dominio

| Dominio | Tablas |
|---|---|
| Identidad | `Users`, `App Settings`, `Approval Limits` |
| Comercial | `Deals`, `CRM Items`, `Cotizaciones`, `Cotizacion Line Items`, `Deal Documents`, `Commercial Dashboard Views` |
| Proyectos | `Projects`, `Tasks`, `Task Comments`, `Calendar Events`, `Calendar Audit Log` |
| Reclutamiento | `Participants`, `Recruitment Rows` |
| Compras | `Purchase Orders`, `PO Line Items`, `PO Audit Log`, `PoAttachments`, `Suppliers`, `Supplier Invoices` |
| Finanzas | `Expenses`, `Expense Line Items`, `Expense Audit Log`, `Expense Comments`, `Payments`, `Invoices`, `Petty Cash Funds`, `Billing Entities`, `Collection Processes`, `Rubro Assignments` |
| Tableros | `Boards`, `Board Columns`, `Cell Values`, `Shared Views` |
| Documentos | `Documents`, `Document Blocks` |
| Chat | `Chat Conversations`, `Messages` |
| Infra | `Migration Log` |

**Si se migra a SQL:** `single_select` → enum o tabla de lookup, `linked_record` → FK
(ojo: varios permiten múltiples → tabla puente), `attachments` → storage externo + tabla de archivos.

---

## 4. Integraciones externas

Configuradas en `zite.config.json`:

| Integración | Uso |
|---|---|
| **Outlook** (`svc_412995`) | Eventos de calendario, envío de OCs con *Send As* |
| **Microsoft Teams** (`svc_426239`) | Creación de canales por proyecto/sesión |
| **OpenAI** (`svc_427532`) | ⚠️ Confirmar en qué endpoints se usa realmente |
| **Ably** | Realtime: chat, presencia, typing, eventos de tablero y documentos |
| **Fillout** | Formularios de screening/reclutamiento + webhooks de respuestas |
| **Google Maps** | Street View en popover de direcciones |

### n8n como capa de automatización

Cinco webhooks de n8n hacen el trabajo pesado fuera de la app:

- `ZITE_N8N_ODC_WEBHOOK_URL` — genera PDFs y envía correos de **Órdenes de Compra**
- `ZITE_N8N_CALENDAR_WEBHOOK_URL` — genera Excel de calendarios y lo sube a **SharePoint**
- `ZITE_N8N_TIMELINE_WEBHOOK_URL` — crea/actualiza timelines en Excel
- `ZITE_N8N_TEAMS_WEBHOOK_URL` — crea canales de Teams
- `ZITE_N8N_OUTLOOK_WEBHOOK_URL` — crea/actualiza/cancela eventos de Outlook

⚠️ **Los flujos de n8n no están en este export.** Son dependencia externa: si se migra la app,
hay que exportarlos aparte o reimplementar esa lógica.

### Variables de entorno

`ZITE_FILLOUT_API_KEY`, `ZITE_ABLY_API_KEY`, `ZITE_GOOGLE_MAPS_API_KEY`,
`ZITE_OUTLOOK_SEND_AS_EMAIL`, y los 5 `ZITE_N8N_*` de arriba.

---

## 5. Glosario (indispensable)

| Término | Significado |
|---|---|
| **ODC** | **Órdenes de Compra** (purchase orders). Explica `parseOdcCsv`, `importOdcFromCsv`, `OdcMappingPanel`, `OdcImportSection` |
| **Rubro** | Categoría contable. Dimensión transversal: aparece en cotizaciones (`Cotizacion Rubros`) y en costos (`CostRubroChart`). Valores: Reclutamiento e incentivos, Moderación, Management, Logística y operación, Back office |
| **Cotización** | Presupuesto al cliente, previo al deal aprobado |
| **Minuta** | Minuta de reunión por proyecto (sobre `Document Blocks`) |
| **Cobranza** | `Collection Processes` — seguimiento de cuentas por cobrar |
| **Empresa operadora** | `Billing Entities` — entidad que factura |
| **Sharpli** | `sharpli.ai`, integración vía iframe. Solo existe `SharpliTestPage.tsx`, marcada "Prueba temporal" → **desechable** |

⚠️ **Naming mezclado español/inglés en toda la codebase** (`saveCotizacion` junto a
`saveQuotationLineItem`, `Rubro`, `Minuta`, `Odc`). Al tocar código nuevo, seguir la convención
local del módulo en lugar de normalizar todo de golpe: un rename masivo rompe los nombres de
campo del SDK, que están atados al esquema de la base.

---

## 6. Arquitectura y convenciones a preservar

- **Un archivo por operación** en `src/api/` (207 endpoints). No agrupar en controladores.
- **Módulos grandes encapsulados** con sus `types.ts` / `constants.ts` / `utils.ts` locales:
  `components/pm/`, `lib/commercial-dashboard/`, `components/commercial/brief/`.
- **Separación lógica/UI**: `lib/commercial-dashboard/` calcula (filtros, métricas, agrupación,
  datos de gráficas), `components/commercial-dashboard/` renderiza. Replicar en módulos nuevos.
- **Estado global mínimo**: un solo context (`ProjectContext`). El resto vive en hooks y datos
  del servidor. **No introducir Redux ni Zustand.**
- **Patrón UI de módulos financieros**: `FormSheet` (captura) + `DetailSheet`/`DetailDialog` (consulta).
  Consistente en purchases, expenses y payments.
- **Realtime**: `useRealtimeChannel.ts` es el hook base; los especializados por dominio
  (`useRealtimeBoardEvents`, `useRealtimePurchases`, `useRealtimeUserNotifications`,
  `useDocumentChannel`, `useCollaborativeDocument`, `useProjectPresence`) se construyen sobre él.
- **Auditoría por módulo**: `PO Audit Log`, `Expense Audit Log`, `Calendar Audit Log`, `Migration Log`.
- **Borrado en 3 etapas**: trash (`getTrashItems`) → `restoreFromTrash` / `purgeDeletedRows` →
  `permanentlyDelete`.
- **Validación zod obligatoria** en input y output de cada endpoint.

### Piezas delicadas

**`src/serverUtils/smartWrite.ts`** — capa de resolución de `boardId` para escrituras en
`Cell Values`. Maneja la coexistencia de UUIDs y IDs compuestos legacy, con estrategia explícita
(`uuid-direct` | `uuid-resolved` | `legacy-fallback` | `input-passthrough`) y fallback tolerante.
Trabaja con `resolveBoardId.ts` / `lookupBoardUUID`. **No reimplementar sin leerlo completo**:
es la deuda técnica de la migración a UUID y toca todas las escrituras del grid.

**`src/components/commercial/brief/`** — editor de documentos por bloques tipo Notion.
`DocumentCanvas` + `ParagraphEditor` + `ImageBlockEditor` + `InlineRenderer` / `TokenRenderer`,
con menciones de entidades (`EntityMentionMenu`, `MentionWrapper`) y referencias dinámicas
(`ReferencePicker` → `getReferenceOptions` → `lib/referenceOptionsCache.ts`) que jalan datos
vivos de otras entidades dentro del documento. Colaboración vía `publishDocEvent` +
`useCollaborativeDocument`. Esquema propio en `docTypes.ts`. **La pieza más compleja del front.**

**`src/components/PendingSavesBar.tsx`** — guardado optimista con cola de cambios pendientes.
Acoplado al comportamiento de escritura del grid.

---

## 7. Deuda técnica identificada

### Archivos que exceden todo límite razonable

| Archivo | Tamaño |
|---|---|
| `src/pages/RecruitmentPage.tsx` | **165 KB** |
| `src/pages/ChatPage.tsx` | **156 KB** |
| `src/pages/PMPage.tsx` | **102 KB** |
| `src/components/DynamicColumns.tsx` | **98 KB** |
| `src/pages/SettingsPage.tsx` | 82 KB |
| `src/components/Layout.tsx` | 70 KB |
| `src/pages/SupplierPortalPage.tsx` | 66 KB |
| `src/pages/ProjectsPage.tsx` | 66 KB |

Estos 8 archivos son ~800 KB de los 3.3 MB totales. **Prioridad #1 de refactor**: no caben
cómodamente en contexto, lo que hace lento y riesgoso cualquier cambio. Extraer siguiendo el
patrón que ya existe en `components/pm/` (subcarpeta por módulo con types/constants/utils locales).

`DynamicColumns.tsx` es caso especial: además de ser enorme, **exporta `TeamMembersProvider`**,
que se usa en `App.tsx`. Separar el provider antes de tocar lo demás.

### Scripts one-off en `src/api/`

`cleanupPJT001`, `migrateAgeColumns`, `migrateProjectToUUID`, `migrateCellValuesToUUID`,
`fixOrphanedCellValues`, `cleanupDuplicateCellValues`, `backfillExchangeRates`, `fixCellData`.
Se ejecutan desde `MigrationRunnerPage.tsx`. Decidir si se archivan; si se conservan, moverlos a
`src/api/migrations/` para que no contaminen la lista de endpoints productivos.

### Otros

- `PlaceholderPage.tsx` y `SharpliTestPage.tsx` → desechables.
- Dos webhooks de Fillout (`filloutWebhook.ts`, `filloutNativeWebhook.ts`): aclarar cuál está vivo.
- `Users` tiene `Projects`, `Projects (1)`, `Projects (2)`, `Projects (3)` — cuatro relaciones a la
  misma tabla, con nombres autogenerados. Documentar qué significa cada una o consolidar.

---

## 8. Archivos de referencia

- `ARBOL-REAL.md` — los 370 archivos, agrupados por carpeta.
- `ESQUEMA-BD.md` — las 41 tablas con todos sus campos, tipos y opciones de select.
- `proyecto/` — el código fuente completo extraído del export.
