# Microsoft Graph con app propia (Opción B)

Reemplaza los tokens que Zite inyectaba (`ZITE_OUTLOOK_ACCESS_TOKEN` y
`ZITE_MICROSOFTTEAMS_ACCESS_TOKEN`) por un registro de aplicación propio en Azure.

## Qué hace la app con Graph

Siete endpoints, cinco operaciones:

| Operación | Endpoints | Ruta de Graph |
|---|---|---|
| Enviar correo | `sendPoEmail`, `sendPaymentReceipt`, `cancelPurchaseOrder`, `reviewSupplierInvoice` | `/me/sendMail` → cambia |
| Eventos de calendario | `syncOutlookInvite` (crear, actualizar, cancelar) | `/me/events` → cambia |
| Carpeta de un canal de Teams | `createTeamsChannel` | `/teams/{id}/channels/{id}/filesFolder` |
| Subir archivo a SharePoint | `createTeamsChannel`, `reviewSupplierInvoice` | `/drives/{id}/items/{id}/children` |
| Listar canales | `listTeamsChannels` | — |

## Paso 1: registrar la aplicación

1. Entra al portal de Azure → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Nombre: `Hub Sapience`
3. Tipo de cuenta: **Accounts in this organizational directory only** (solo el tenant de Sapience)
4. Redirect URI: **déjalo vacío**. Con credenciales de aplicación no hay login de usuario.
5. Registrar

Del resumen, copia y guarda:
- **Application (client) ID** → `MS_CLIENT_ID`
- **Directory (tenant) ID** → `MS_TENANT_ID`

## Paso 2: generar el secreto

**Certificates & secrets** → **New client secret**. Elige la duración máxima.

Copia el **Value** en ese momento: no se vuelve a mostrar. Va en `MS_CLIENT_SECRET`.

⚠️ **El secreto caduca.** Pon un recordatorio en tu calendario un mes antes del vencimiento.
Es la causa número uno de "de la nada dejaron de salir los correos de OCs".

## Paso 3: permisos

**API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
(no "Delegated": la app actúa sola, sin usuario).

Agrega:

| Permiso | Para qué |
|---|---|
| `Mail.Send` | Correos de OCs y comprobantes de pago |
| `Calendars.ReadWrite` | Eventos de Outlook de las sesiones |
| `Files.ReadWrite.All` | Subir facturas y archivos a SharePoint |
| `Group.Read.All` | Leer canales de Teams y su carpeta de archivos |

Luego **Grant admin consent for Sapience**. Si no eres administrador del tenant,
aquí necesitas que alguien que sí lo sea le dé clic. Sin esto, Graph responde 401
aunque el token se genere bien.

## Paso 4: restringir el alcance del correo (importante)

`Mail.Send` con permisos de aplicación permite enviar **como cualquier buzón del tenant**.
Eso es más poder del que necesitas y un administrador con criterio te lo va a señalar.

Se limita con una política de acceso en Exchange Online, vía PowerShell:

```powershell
New-ApplicationAccessPolicy `
  -AppId "<MS_CLIENT_ID>" `
  -PolicyScopeGroupId "<correo-del-buzon-o-grupo>" `
  -AccessRight RestrictAccess `
  -Description "Hub Sapience solo puede enviar desde este buzon"
```

Con eso la app queda limitada al buzón que uses para las OCs. Vale la pena hacerlo.

## Paso 5: variables de entorno

```
MS_TENANT_ID=...
MS_CLIENT_ID=...
MS_CLIENT_SECRET=...
MS_SEND_AS_EMAIL=ordenes@sapience.mx
```

El último es el buzón desde el que salen las OCs; equivale al viejo
`ZITE_OUTLOOK_SEND_AS_EMAIL`.

## Paso 6: cambios en el código

Menos de lo que parece. Cinco cambios en total.

**Los cuatro endpoints de correo** (`sendPoEmail`, `sendPaymentReceipt`,
`cancelPurchaseOrder`, `reviewSupplierInvoice`):

```diff
- const accessToken = process.env.ZITE_OUTLOOK_ACCESS_TOKEN;
- const graphResp = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
-   method: 'POST',
-   headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
-   body: JSON.stringify(mailPayload),
- });
+ import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';
+ const graphResp = await graphFetch(`${graphMailboxBase()}/sendMail`, {
+   method: 'POST',
+   body: JSON.stringify(mailPayload),
+ });
```

**`syncOutlookInvite`** — una sola línea, y cubre las cinco llamadas de calendario
(crear, actualizar, cancelar, consultar):

```diff
- const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me';
+ import { graphMailboxBase } from '../../server/microsoft/graph';
+ const GRAPH_BASE = graphMailboxBase();
```

Y sustituir los `fetch` con `Authorization` manual por `graphFetch`.

**Teams y SharePoint** (`createTeamsChannel`, `listTeamsChannels`): las rutas no usan
`/me`, así que quedan igual. Solo cambia de dónde sale el token: `graphFetch` en lugar
de `process.env.ZITE_MICROSOFTTEAMS_ACCESS_TOKEN`. Con un solo registro de app cubres
correo, calendario, Teams y SharePoint; ya no necesitas dos tokens separados.

## Cómo probar que quedó

Antes de tocar endpoints, verifica que el token se emite:

```ts
import { getGraphToken } from './server/microsoft/graph';
const t = await getGraphToken();
console.log('token obtenido, largo:', t.length);
```

Si eso funciona, prueba un envío real a tu propio correo. Si da 401, casi siempre es
consentimiento de administrador faltante, no el token.

## Qué puede salir mal

**401 con token válido** → falta el admin consent del Paso 3.

**403 al enviar correo** → la política de acceso del Paso 4 está bloqueando el buzón,
o el buzón no existe.

**Los correos salen pero no llegan** → revisa SPF/DKIM del dominio. Enviar desde Graph
con un buzón real normalmente no da problema, pero vale descartarlo.

**Dejó de funcionar meses después** → caducó el secreto del Paso 2.
