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

`accessMode: external`, **signup deshabilitado**. Conectado a **Supabase Auth** real
(`server/auth.ts` + `src/shims/zite-auth-sdk.ts` + `src/pages/LoginPage.tsx`), reemplazando el
`MOCK_USER` fijo que inyectaba `server/index.ts`. Único método activo hoy: **magic link**. El
`Google sign-in` que Zite ofrecía se quitó de `LoginPage.tsx` — era una opción heredada que el
equipo nunca usó, todas las cuentas son de Microsoft/Azure, no de Google.

**Pendiente para después del despliegue:** conectar **Azure AD (Microsoft) como proveedor OAuth
principal** en el dashboard de Supabase (Authentication → Providers), para que el equipo entre con
su cuenta de Microsoft en vez de solo magic link. Requiere registrar el redirect URI de Supabase en
el mismo tenant de Azure que ya usa `server/microsoft/graph.ts` (o uno nuevo) y agregar el permiso
delegado de sign-in — no se hizo antes del despliegue porque el flujo de Graph API (`MS_CLIENT_ID`
et al.) usa credenciales de aplicación (app-only), un registro distinto al que necesita OAuth de
usuario para login.

Verificación por correo contra `users` (case-insensitive, vía `pool.query` en `resolveAuth()`) —
sin signup, un correo autenticado que no exista en la tabla se rechaza con `NOT_PROVISIONED` (403)
antes de llegar al endpoint. Los 9 endpoints que en Zite eran públicos sin `authenticated`
declarado ya están resueltos: `filloutWebhook`, `filloutNativeWebhook`, `getSupplierPortalData`,
`uploadSupplierInvoice`, `getSharedViewData` → `false` (webhooks externos o auth propia por token);
`getStreetViewUrl`, `createBoardWithTemplate`, `duplicateCotizacion`, `migrateAgeColumns` → `true`
(uso exclusivamente interno — `getStreetViewUrl` contradice lo que se pensaba originalmente aquí,
confirmado por grep de sus únicos llamadores, todos dentro de `Layout`).

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

**La migración a Postgres ya ocurrió.** `schema.sql`, `server/compat/schema-map.ts` y
`server/compat/types.ts` están **generados por `server/generate.py`** a partir de
`export-zite-schema.json` (el export de Zite con la metadata de las 41 tablas) — **no se editan
a mano**. Los tres salen de la misma fuente a propósito: si se necesita un cambio de esquema,
se ajusta `generate.py` (o el JSON) y se vuelve a correr, no se tocan los archivos generados
directamente. Las pocas decisiones que no son derivables del export (qué `CHECK` ampliar, cuáles
quitar por ser listas acumuladas sin validar, el índice parcial de `shared_views.token`) están
codificadas explícitamente en `generate.py` (`CHECK_SKIP` / `CHECK_EXTRA`), con el porqué en
comentario — no en un parche SQL aparte.

**Los 6 campos `autonumber`** (`Payment ID`, `Cell ID`, `Limit ID`, `Block ID`, `Message ID`,
`Expense Number`) se generan como `bigint generated by default as identity`. La carga masiva
inicial insertó los valores del export de Zite tal cual, sin sincronizar la secuencia de Postgres
después — cualquier `INSERT` nuevo (sin especificar el id) arrancaba la secuencia desde 1,
**colisionando con datos históricos reales** (`payments.payment_id` llegó a asignar `1` cuando ya
existían 310 pagos reales). Se corrigió con `setval()` sobre las 6 secuencias, apuntándolas al
`max()` real de cada tabla. Si se vuelve a hacer una carga masiva con ids explícitos en cualquiera
de estas 6 columnas, hay que repetir el `setval()` — si no, el bug reaparece en silencio.

**Los campos `currency`/`number`/`percent`** (kind `'number'` en `schema-map.ts`) requieren el
parser de `pg` para el OID 1700 (`numeric`), registrado en `server/compat/datetimeParsers.ts` /
`db.ts` junto con los de fecha — sin él, `pg` los devuelve como `string`, no como `number`. Este
bug pasó desapercibido en el primer lote porteado porque `createEndpoint` solo advertía (no
tronaba) si la salida no calzaba con el `outputSchema` — apareció hasta que algo hacía aritmética
real sobre el valor (`getPayments`/`amount`).

**`STRICT_OUTPUT=true` está activo en `.env` durante todo el port**, a propósito: convierte esa
advertencia en un `throw`, así que cualquier endpoint recién portado que no calce con su
`outputSchema` truena de inmediato en vez de pasar silencioso. Fue así como se encontró el bug de
`numeric` de arriba, y confirmó uno más grande al activarlo: Zite nunca devuelve `null` en un campo
vacío (lo omite, equivale a `undefined`), pero Postgres sí manda `null` — como casi todos los
`outputSchema` declaran esos campos `.optional()` (no `.nullable()`), **cualquier campo vacío
tronaba el endpoint**. Se corrigió en un solo lugar (`model.ts` → `stripNullScalars`, corre después
de `wrapLinks` en `findAll`, así que `create`/`update`/`findOne`/`bulkCreate` lo heredan gratis al
pasar todos por ahí) en vez de tocar el `outputSchema` de cada endpoint. Antes de bajar
`STRICT_OUTPUT` a `false`, confirmar que ya no hace falta para el port en curso.

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
| **Talks** | App aparte de sesiones en vivo con participantes (`~/estudio-sapience`, `talks.mx`). El Hub le crea la sesión de cada evento del calendario (ver «Talks» abajo) |

### n8n como capa de automatización

Cuatro webhooks de n8n hacen el trabajo pesado fuera de la app:

- `ZITE_N8N_ODC_WEBHOOK_URL` — genera PDFs y envía correos de **Órdenes de Compra**
- `ZITE_N8N_CALENDAR_WEBHOOK_URL` — genera Excel de calendarios y lo sube a **SharePoint**
- `ZITE_N8N_TIMELINE_WEBHOOK_URL` — crea/actualiza timelines en Excel
- `ZITE_N8N_OUTLOOK_WEBHOOK_URL` — crea/actualiza/cancela eventos de Outlook

**`ZITE_N8N_TEAMS_WEBHOOK_URL` ya no se usa** (agosto 2026) — la creación de
canales de Teams migró a una llamada directa a Microsoft Graph
(`createTeamsChannel.ts`) en cuanto se concedió el permiso de aplicación
`ChannelSettings.ReadWrite.All` (antes solo se tenían `Calendars.ReadWrite.All`,
`Files.ReadWrite.All`, `Group.ReadWrite.All` y `Mail.Send`). De paso se corrigió
un bug real: el código creaba las 7 carpetas del canal vía Graph **además** de
lo que ya hacía el flujo de n8n, duplicándolas (14 en vez de 7) — con un solo
mecanismo de creación, el bug desaparece junto con la dependencia de n8n.

⚠️ **Los flujos de n8n no están en este export.** Son dependencia externa: si se migra la app,
hay que exportarlos aparte o reimplementar esa lógica.

### Variables de entorno

`ZITE_FILLOUT_API_KEY`, `ZITE_ABLY_API_KEY`, `ZITE_GOOGLE_MAPS_API_KEY`,
`ZITE_OUTLOOK_SEND_AS_EMAIL`, y los 5 `ZITE_N8N_*` de arriba.

Para Talks: `TALKS_URL` y `TALKS_API_KEY` (ver la sección siguiente).

### Talks (sesiones en vivo)

Talks es una app aparte (`~/estudio-sapience`, `talks.mx`, servicio propio en Render) que corre sesiones en vivo con participantes sobre LiveKit. **Se desarrolla en su propia sesión y no se edita desde el Hub.** El contrato completo vive en su `docs/integracion-hub.md`.

- **Variables:** `TALKS_URL` (hoy `https://talks-y08o.onrender.com`, luego `https://talks.mx`) y `TALKS_API_KEY` (la misma `HUB_API_KEY` que Talks tiene en Render). Van en las variables del servicio del Hub en Render. La llave real nunca va en un archivo versionado ni en el chat. Solo se acepta `http://` si la dirección es localhost (pruebas). No hay `.env.example` en el repo.
- **Qué hace el Hub:** en cada evento del calendario ya guardado, el bloque «Talks» de la Sala de observación (`components/pm/TalksSessionPanel.tsx`). La primera vez dice «Crear links de sesión»: `createTalksSession` arma o recupera la transmisión de Mux (`provisionObservationSession` con `{ conZoom: false }`: sin reunión de Zoom, porque Talks la reemplaza; «Crear stream» y la columna «Botón» siguen creándola) y le pide a Talks la sesión (`POST /api/v1/sesiones`, con el id del evento como `externoId`, así que apretar dos veces no crea nada doble). Después dice «Abrir en Talks» y muestra los links con botón de copiar. `getTalksSession` consulta sin crear. El cliente de Talks está en `server/talks/client.ts`.
- **El mismo botón en la fila de la lista del calendario:** `EventsTable.tsx` tiene una columna «Talks» pegada a la pastilla de Zoom (entre «Crear stream» y las dos columnas de link; `components/pm/TalksFilaCell.tsx` hace la lógica y `TalksFilaVista.tsx` solo dibuja). Usa el mismo `createTalksSession`. Sin links: «Crear links de sesión». Con links: «Abrir en Talks» (link del moderador) y tres botones que copian el link de Participantes, el de Moderador (los dos de Talks) y el de Observación del cliente (`/s/<slug>`, armado por `urlDeObservacion` con la misma dirección que la Sala). **La fila no consulta evento por evento:** los datos de todos los eventos viajan en la misma carga de `getTasks` (`talksSessionId`, `talksLinkEquipo`, `talksLinkParticipantes`, `observationUrl`; una sola consulta, `leerTalksDeEventos` en `src/serverUtils/talksSession.ts`, igual que el estado de Zoom) y nunca llevan la llave de Mux. Si esa consulta falla (por ejemplo, falta la migración), la lista carga igual y avisa una vez en los registros. La fila y la ventana del evento se pasan lo recién creado o consultado por `src/lib/talksCompartido.ts`, así que no se esperan a que se recargue la lista; lo guardado en la base manda al abrir o recargar. Un evento sin guardar (id provisional `temp-...`) no muestra el botón.
- **Qué guarda:** en `observation_sessions`, las columnas `talks_session_id`, `talks_link_equipo` y `talks_link_participantes`. Esa tabla no sale de `generate.py` (la crea `add-observation-room-tables.ts`), así que las columnas las agrega `server/scripts/add-observation-talks-columns.ts`. **No se ejecuta solo y hay que correrlo antes de subir el código que lo usa.** Si falta, el botón avisa en claro y no rompe el resto de la Sala.
- **Seguridad:** `mux_stream_key` es la única credencial que permite transmitir a la sala de un evento. Solo viaja en el cuerpo del POST a Talks: ni en URLs, ni en registros (todo texto que viene de Talks se limpia de ella), ni en la respuesta de los endpoints. Un error de Talks nunca sale como 401 hacia el navegador, porque parecería que se venció la sesión de quien aprieta el botón.
- **«Abrir en Talks» entra directo, sin volver a pedir el correo:** el Hub y Talks son dos sitios y el navegador no comparte el inicio de sesión, así que el botón (los DOS lugares: `TalksSessionPanel.tsx` y la fila, `TalksFilaCell.tsx` + `TalksFilaVista.tsx`) ya no es un link: el clic abre primero una ventana en blanco (si no, el navegador la bloquea al esperar), llama a `getTalksAccessLink` y pone en esa ventana la dirección que llegue. El endpoint toma el correo SIEMPRE de `context.user.email` (la entrada solo trae el id del evento; un correo mandado en la petición se ignora), busca el `talks_session_id` guardado y llama a Talks `POST {TALKS_URL}/api/v1/acceso-equipo` con la misma llave (`pedirAccesoEquipoTalks` en `server/talks/client.ts`; el contrato está en «Acceso directo» de `docs/integracion-hub.md` de Talks). Talks contesta un pase de UN solo uso que vale 60 segundos y va en la parte `#` de la dirección: se pide uno nuevo en cada clic y NO se guarda, ni se cachea, ni se escribe en registros (ni la dirección ni la respuesta). Si no se puede (404; 401; 400; un 403; Talks caído; más de 8 segundos sin respuesta; una dirección que no es de Talks o no es https), el endpoint responde con el `motivo` (nunca un error de pantalla) y la ventana abre el `linkEquipo` de siempre con un aviso en español llano («No pudimos entrar directo a Talks; te va a pedir tu correo»); el motivo y el código quedan en el registro del servidor, sin la dirección del pase ni el correo. La lógica de la pantalla (sin React) está en `src/lib/talksAbrir.ts`; la conexión con la ventana, el servidor y los avisos, en `components/pm/abrirEnTalksReal.ts`. Los botones de copiar siguen copiando el `linkEquipo` normal, sin pase (es para compartirlo). No hay variables nuevas. **Quién entra a Talks desde el botón lo decide el Hub, no Talks:** Talks ya no tiene otra lista para quien llega con un pase (no revisa `EQUIPO_PERMITIDO`), así que cualquier persona con sesión verificada y dada de alta en la tabla de usuarios del Hub (lo que ya garantiza `authenticated: true`) que pase por `getTalksAccessLink` entra a la consola de Talks (crear y abrir sesiones). Si algún día solo ciertos roles deben usar Talks, el filtro se pone en ese endpoint, antes de pedir el pase. No hay que agregar a cada persona nueva en `EQUIPO_PERMITIDO` de Render: esa lista solo manda para quien escribe la dirección de Talks y entra con su correo. Quien salga del Hub conserva su sesión de Talks ya abierta hasta 12 horas, pero no podrá pedir otro pase.
- **Pruebas:** `server/scripts/test-talks.ts` (un Talks y un Mux de mentira más una base en memoria; cualquier llamada a otra dirección hace fallar la prueba), `server/scripts/test-talks-fila.ts` (la columna de la fila: la lista trae los datos en una sola consulta, sincronía fila-ventana sin crear nada doble, la lista no se rompe si faltan las columnas, y cómo se dibuja la celda) y `server/scripts/test-talks-acceso.ts` («Abrir en Talks» directo: el correo es el de la sesión, cualquier persona con sesión del Hub recibe su pase, un pase nuevo en cada clic, cada fallo cae al link normal con su aviso, el pase no queda en registros ni en la base, y la lógica de la ventana).

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

*Migración de `board_id` legacy a UUID real (Postgres, no Zite):* se migraron 402,726 filas de
`cell_values` y 3,901 de `board_columns` con prefijo `recruitment-{project_code}-{board_name}`
(sufijo opcional `::groups`) a la UUID de `boards` correspondiente, cruzando por
`project_code`+`board_name` (case-insensitive, trim) contra tableros con `deleted_at is null`.
Quedó un **residuo intencional sin migrar**, por diseño (no por error):

| Categoría | `cell_values` | `board_columns` | Motivo |
|---|---|---|---|
| Prefijo `recruitment-` sin tablero vivo (el único candidato con ese nombre está `deleted_at` no-null) | ~140k de las 173,101 | mayoría de las 797 | no hay UUID real al que mapear |
| Ambiguo entre tableros vivos duplicados (2 casos: `ENERGÍA`/`STATUS RECLUTAMIENTO`, `EMPATHY PROGRAM 2026`/`EMPATHY LDAs BEER LOVERS`) | ~370 | ~100 | dos boards vivos con el mismo `project_code`+`board_name` (bug de doble-submit al crear); no se adivina cuál es el real |
| `NEW NEWS` / `DOS DOS` | 27,750 | ~336 | confirmado que nunca tuvieron tablero registrado |
| Destino ya tenía celdas propias | resto de las 173,101 | resto de las 797 | se dejó el legacy intacto para no mezclar datos de dos orígenes |
| Prefijos `cal-` / `pm-` / `events-` (tableros de calendario y timeline) | 788 (465 `cal-`, 318 `pm-`, 5 `events-`) | 13 (`events-`) | **mismo problema, prefijo distinto — no fue parte de esta migración**, sigue pendiente de su propio análisis |

Respaldo completo pre-migración en `cell_values_backup` / `board_columns_backup`.

**Importante para quien toque `smartWrite.ts`/`resolveBoardId.ts`:** reconocen los prefijos
`recruitment-`, `cal-`, `pm-` y `events-` como IDs legacy — no solo `recruitment-`. Los cuatro
pueden aparecer en datos reales (ver tabla arriba), migrados o no.

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
- **Gate de `role` en el módulo de finanzas, roto para todo el mundo.** `getExpenses`,
  `saveExpense`, `deleteExpense`, `getPettyCashFunds` y `savePettyCashFund` comparan
  `context.user.role` contra `['Admin', 'Admin Financiero', 'Finanzas']` — valores que **no
  existen** en el `CHECK` de `users.role` (`Owner, Socio, Head, Líder, Coordinador, Analista`, ver
  §1). Confirmado contra los usuarios reales: ninguno tiene esos roles. Efecto: `isFinance`/
  `isAdmin` son `false` siempre (nadie ve gastos ajenos ni fondos no-Activos), y
  `savePettyCashFund` es **inutilizable para cualquier usuario**, siempre `FORBIDDEN`. Es bug
  preexistente de la época Zite, no algo que introdujo el port — se dejó igual (paridad) porque
  arreglarlo es decisión de negocio: ¿debe ser gate por `role` (agregar esos valores al enum) o por
  `purchaseLevel` (que sí tiene `'Finanzas'`)? `approveExpense`/`rejectExpense` sí usan
  `purchaseLevel` y funcionan bien — es un patrón inconsistente dentro del mismo módulo.

---

---

## 8. ⭐ La causa raíz de la lentitud (leer antes de optimizar nada)

Derivado del historial completo de desarrollo en Zite (7,474 mensajes, mayo–agosto)
y del volumen real de datos.

### El hecho central

`Cell Values` tiene **~2.8 millones de filas**: una fila por celda de tablero.
Es un modelo entidad-atributo-valor.

Las columnas base de un tablero (`participantName`, `email`, `phone`) son **columnas
reales** de su tabla → se leen en una consulta y aparecen al instante.

Las columnas dinámicas viven en `Cell Values` → hay que traer filas, columnas y celdas
por separado, y **armar el cruce en JavaScript en el navegador**.

Eso es exactamente lo que Monday.com no hace: ellos resuelven el pivote en la base.

### Los síntomas que produce, todos con la misma causa

| Síntoma reportado | Mecanismo |
|---|---|
| Las primeras columnas cargan al instante, el resto tarda | columnas reales vs `Cell Values` |
| Escribir en una celda: el texto se borra y reaparece | guardado optimista peleando con el refetch |
| 7–10 s para que otro usuario vea una fila nueva | `silentReload()` recarga de más tras el evento realtime |
| Cambiar de vista congela la tabla | los filtros dependen de `rowsWithGroup`, que materializa **todos** los valores dinámicos antes de filtrar |
| Grupos y colores llegan después de las filas | `useDynamicColumns` hace fetch aparte de columnas y celdas |

### Lo que ya se intentó (no repetir)

Siete capas de caché en el cliente: `cellCache`, `cellMapCache`, `rowsCache`, `colCache`,
prefetch de tableros vecinos, skip-stagger y `silentReload`.

Funcionaron a medias y **cada una trajo sus propios bugs** — la carrera entre `rows` y
`groupDynCols` que desacomodaba los grupos salió de ahí.

No fue mal diseño: con la base de Zite (sin joins ni agregaciones) el pivote *tenía* que
ocurrir en el navegador. Las cachés eran la única defensa posible.

### Lo que el port arregla y lo que no

**No lo arregla por sí solo.** La capa de compatibilidad replica el comportamiento de Zite
a propósito: sigue trayendo celdas por separado y cruzando en el cliente. Mejora por los
índices, pero el problema de fondo permanece.

**Lo que sí lo arregla**, y solo es posible en Postgres:

1. **Cruzar del lado del servidor.** Reescribir `getCellValues`, `getRecruitmentRows`,
   `getBoardColumns` y `saveCellValue` para devolver las filas **con sus celdas ya
   pivoteadas** en una consulta (join + agregación `jsonb`). Entonces se pueden borrar
   la mayoría de las siete cachés.
2. **Filtrar y agrupar en SQL** en lugar de materializar todo en el cliente.
3. **Considerar migrar `Cell Values` a una columna `jsonb`** en la fila. Colapsa 2.8 M de
   filas a decenas de miles. Es cambio de esquema, no port directo — evaluar después.

**Orden correcto:** portar con paridad → verificar → *luego* estos cuatro endpoints.
Hacerlo durante el port convierte cada archivo en una decisión de rediseño.

### Nota de capacidad

2.8 M de filas en `cell_values` rondan 500–800 MB con índices. **El plan gratis de
Supabase (500 MB) no alcanza**: se necesita Pro desde la carga de datos reales.

Para cargar esa tabla usar `COPY FROM STDIN` (pg-copy-streams), no inserts: la diferencia
es de horas a minutos. El `bulkCreate` de la capa de compatibilidad inserta fila por fila
y no sirve para este volumen.

---

## 9. Archivos de referencia

- `ARBOL-REAL.md` — los 370 archivos, agrupados por carpeta.
- `ESQUEMA-BD.md` — las 41 tablas con todos sus campos, tipos y opciones de select.
- `proyecto/` — el código fuente completo extraído del export.
- `docs/tablero-comercial.md` — guía viva del **Tablero comercial** (`/comercial/tablero`, el reemplazo del dashboard comercial: motor de bloques en `src/lib/tablero/`, vistas `t2_`, reglas que pidió Sergio).
- `docs/guias-topicos.md` — guía viva de las **guías de tópicos** (pestañita «Guías» dentro de Tools de cada proyecto: roadmap, guía escrita por la IA con la voz de Sapience y Word; skill en `src/serverUtils/guias/skill/`, paquete original en `paquetes/guias-topicos/`).
- `docs/clientes.md` — guía viva del **catálogo de clientes** (`/comercial/clientes`: razones sociales con datos para facturar, condiciones y proceso de cobranza por cliente, contactos; Cobranza lee de ahí y la facturación futura saldrá de ahí; tablas `client_entities` / `client_contacts` en `generate.py`, creadas con `server/scripts/add-clientes-ficha-tables.ts`).
- `docs/buscador.md` — guía viva del **buscador de gente** (`/operacion/buscar-gente`, menú Operación, **por ahora solo para Sergio**: `BUSCADOR_SOLO_PARA` en `src/lib/busqueda/acceso.ts`, en `null` se abre a todos; dónde se ha preguntado por una marca o tema en los tableros de reclutamiento, cómo se preguntó y qué contestó la gente; catálogo en las tablas `busqueda_*`, creadas con `server/scripts/add-busqueda-tables.ts`; pendiente: búsquedas guardadas, detalles opcionales, IA al armar el catálogo).
- `docs/nda.md` — guía viva del **NDA de participantes** (botón «NDA» de Reclutamiento: liga personal en `sharpli.mx/nda/<token>` donde la persona firma con el dedo, PDF firmado en bucket privado, copia por correo y estados Enviado/Abrió/Firmado/Rechazó en la tabla; servidor en `src/serverUtils/nda/`, tablas `nda_envios` / `nda_eventos` en `generate.py`, creadas con `server/scripts/add-nda-tables.ts`; CORS del dominio de participantes en `server/corsFormularios.ts`).
- `docs/pilares.md` — guía viva de **Pilares** (unidades de negocio): cada deal repartido entre Cualitativo, Cuantitativo, Digital, Estrategia… con montos en pesos de ingreso y costo y el porcentaje calculado (bloque «Pilares» de la pestaña General del deal y pantalla `/comercial/pilares`, solo Owner o Socio; el catálogo se puede ampliar; tablas `pilares` / `deal_pilares` en `generate.py`, creadas con `server/scripts/add-pilares-tables.ts`; `deals.project_type` se reescribe solo con los nombres de los pilares; pendiente: rentabilidad por pilar en Finanzas e ingresos por pilar en el Tablero).
