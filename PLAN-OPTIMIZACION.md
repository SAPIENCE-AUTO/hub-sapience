# Plan de optimización — Hub Sapience

Derivado del código real, del volumen real de datos (2.8 M celdas) y del historial
de desarrollo en Zite. Ordenado por relación impacto / esfuerzo.

**Regla que gobierna todo:** primero portar con paridad de comportamiento, después
optimizar. Optimizar durante el port convierte cada uno de los 207 archivos en una
decisión de rediseño y el proyecto se muere a la mitad.

---

## El hallazgo que cambia el plan

**Ya guardas cada celda dos veces:**

1. `cell_values` — una fila por celda, **2.8 millones de filas** (modelo EAV)
2. `recruitment_rows.cellData` — un JSON con todas las celdas de esa fila

Y `useDynamicColumns.ts` línea 254 ya construye el mapa de celdas **desde `cellData`**,
no desde la tabla EAV. El comentario del código lo dice: *"Build cell map from rows'
denormalized cellData JSON"*.

O sea: **el camino de lectura ya está medio resuelto.** La tabla de 2.8 M sigue viva
como fuente de verdad, y cada escritura toca las dos. De ahí salen las 13 consultas
de `saveCellValue`.

Y de ahí sale también un bug que ya tuvieron que rodear. `useDynamicColumns` línea 122:

> *"saveCellValue does a read-modify-write on cellData. Running two ops for the same
> row concurrently causes a race: both read stale cellData and the second write
> overwrites the first. Serialising per-row eliminates this."*

Por eso el cliente serializa las escrituras por fila y limita a 5 filas concurrentes.
Es un candado artificial que sacrifica velocidad para evitar perder datos.

**En Postgres ese bug desaparece solo**, porque `jsonb_set` es atómico. No hay lectura
previa que pueda quedar rancia, así que no hace falta serializar nada.

---

## Fase 1 — Ganancias inmediatas (días, después del port)

### 1.1 `saveCellValue`: de 13 consultas a 1

Hoy hace: resolver board → buscar celda → update **o** create → leer la fila → escribir
`cellData` → buscar la columna → listar todas las columnas del board (a veces dos veces)
→ sincronizar `Tasks`.

Con `cellData` como `jsonb` y un índice único natural, es una sentencia:

```sql
-- Escritura atómica, sin lectura previa, sin carrera posible
update recruitment_rows
   set cell_data = jsonb_set(coalesce(cell_data, '{}'::jsonb), array[$2], $3::jsonb, true),
       updated_at = now()
 where id = $1
returning cell_data;
```

Y si conservas `cell_values` durante la transición, un upsert en lugar de find+branch:

```sql
create unique index on cell_values (board_id, row_id, column_id);

insert into cell_values (board_id, row_id, column_id, text_value, number_value, date_value, boolean_value)
values ($1,$2,$3,$4,$5,$6,$7)
on conflict (board_id, row_id, column_id)
do update set text_value = excluded.text_value,
              number_value = excluded.number_value,
              date_value = excluded.date_value,
              boolean_value = excluded.boolean_value,
              updated_at = now();
```

**Efecto:** editar una celda deja de tardar. Y se puede quitar la serialización por fila
del cliente, así que pegar 50 celdas de golpe pasa de secuencial a paralelo.

**Cambiar `cellData` de `text` a `jsonb`** es requisito. Hoy es un string con JSON dentro,
lo que obliga a parsear en el cliente y hace imposible filtrar en SQL.

### 1.2 Los 190 `findAll` sin filtros

De ~230 llamadas, **190 no llevan filtro**: traen la tabla completa y filtran en JavaScript.
El caso peor es `getRecruitmentRows`, que además pagina en bucle secuencial de 2000 en 2000
y descarta las filas borradas *después* de transportarlas.

```diff
- const todas = await RecruitmentRows.findAll({});           // trae todo
- const vivas = todas.records.filter(r => !r.deletedAt);     // descarta en JS
+ const vivas = await RecruitmentRows.findAll({
+   filters: { projectCode, deletedAt: null },
+   fields: ['id','participantName','email','phone','cellData','groupId'],
+ });
```

Y elimina el bucle de paginación: con índice, una consulta trae lo que necesitas.

**Empieza por los cinco que más pesan:** `getRecruitmentRows`, `getDashboardData`,
`getSharedViewData` (17 consultas), `getMultiProjectCostAnalysis`, `getCellValues`.

### 1.3 Realtime: dejar de recargar todo

Hoy publicas eventos granulares (`rowId`, `changeType`) — eso está bien hecho. El problema
es el receptor: llama `silentReload()`, que recarga el tablero completo. De ahí los 7 a 10
segundos que reportaste, y de ahí que los grupos llegaran mal (carrera entre `rows` y
`groupDynCols`).

**Arreglo:** que el evento traiga la fila completa ya cruzada, y el receptor haga *patch*
de esa fila en su estado. Sin refetch.

```ts
// en lugar de silentReload()
setRows(prev => prev.map(r => r.id === evt.rowId ? { ...r, ...evt.row } : r));
```

Eso vuelve el realtime instantáneo y elimina la carrera de raíz.

### 1.4 Chat: `sendMessage` hace 17 operaciones de base

Para un mensaje: busca la conversación, crea el mensaje, actualiza al usuario, vuelve a
buscar la conversación, la actualiza, y si es respuesta busca el mensaje padre **dos veces**.

El front ya es optimista (pinta el mensaje antes de esperar), así que el usuario no debería
notarlo — pero `scheduleOptimisticSafetyRefresh` puede sobrescribir lo pintado. Eso explica
el *"se envía y tarda tantito en mostrarse"*.

**Arreglos, en orden:**

- **Guardar `authorName` y `authorEmail` en el mensaje** en lugar de buscarlos. Ya lo haces
  en `addExpenseComment`; replícalo aquí. Elimina la consulta a `Users`.
- **`lastMessageAt` de la conversación: fuera del camino crítico.** No hace falta esperarlo
  para responder al cliente.
- **Guardar un fragmento del mensaje padre** al crear la respuesta, en lugar de buscarlo
  dos veces al enviar.
- **Quitar el refresh de seguridad** una vez que el realtime sea confiable (punto 1.3).
  Es un parche sobre un parche.

Objetivo: de 17 operaciones a 2 o 3.

### 1.5 El patrón sistémico: 32 endpoints ordenan en JavaScript

**Zite no soportaba `ORDER BY`.** Por eso, en todos lados donde el código necesita
"los últimos N" o "los más recientes", trae la tabla completa y ordena en memoria.

El caso más claro es `getMessages`, y su propio comentario lo delata:

> *"Full fetch (initial load): get all messages, sort ascending, keep only the LAST N"*

```ts
// hoy: descarga 2000 mensajes para mostrar 60
const { records } = await Messages.findAll({ filters: { channel }, limit: 2000 });
const sorted = records.map(sanitize).sort((a,b) => +new Date(a.sentAt) - +new Date(b.sentAt));
const recent = sorted.slice(sorted.length - 60);
```

En Postgres:

```sql
select * from messages where conversation_id = $1 order by sent_at desc limit 60;
```

**Está en 32 de los 207 endpoints.** Es la mejora más barata del port: agregar `sorts` a
la llamada y borrar el `.sort()`. La capa de compatibilidad ya lo soporta.

Índices que lo hacen instantáneo:

```sql
create index on messages (conversation_id, sent_at desc);
create index on tasks (project_code, task_order);
create index on recruitment_rows (project_code, row_order);
```

---

### 1.6 Chat: los huecos de producto

Además de los puntos anteriores (1.4 sobre las 17 operaciones al enviar, 1.5 sobre los
2000 mensajes), el chat tiene tres huecos de producto que Postgres resuelve fácil.

### Búsqueda de mensajes

No existe. Con el historial acumulado, encontrar algo dicho hace meses es imposible.
Postgres trae full-text search nativo:

```sql
alter table messages add column content_tsv tsvector
  generated always as (to_tsvector('spanish', coalesce(content,''))) stored;
create index on messages using gin (content_tsv);

-- buscar en todo el historial, con ranking
select id, conversation_id, content, sent_at
  from messages
 where content_tsv @@ websearch_to_tsquery('spanish', $1)
 order by ts_rank(content_tsv, websearch_to_tsquery('spanish', $1)) desc, sent_at desc
 limit 50;
```

Nota el diccionario `'spanish'`: hace que "cotizaciones" encuentre "cotización".

### Editar y borrar mensajes

No hay `editMessage` ni `deleteMessage`. Para un chat de trabajo es básico. Recomendación:
borrado suave (`deleted_at`) y `edited_at` visible, consistente con el patrón de auditoría
que ya usas en el resto de la app.

### Cargar historial al hacer scroll

Cero manejo de scroll: se ven los últimos 60 mensajes y lo anterior es inalcanzable desde
la interfaz, aunque esté en la base. Con el índice `(conversation_id, sent_at desc)`,
paginar hacia atrás por cursor es trivial:

```sql
select * from messages
 where conversation_id = $1 and sent_at < $2   -- cursor: el más viejo que ya tienes
 order by sent_at desc limit 40;
```

### Y lo que ya está bien hecho

Para no romperlo al tocar: el envío **ya es optimista** (pinta el mensaje antes de esperar
al servidor), los eventos de Ably son granulares, y hay indicador de escritura, presencia y
conteo de no leídos. La arquitectura de realtime del chat está sana — el problema es la
capa de datos debajo.

---

### 1.7 Portal de proveedores: manda todos los PDFs incrustados de una vez

`getSupplierPortalData` (público, por token — cualquier proveedor con su link lo puede
abrir) ya no arrastra `pdfBase64` de OCs que no va a mostrar (el filtro "tiene PDF y se
envió por correo" se empujó a SQL — ver commit de esta sesión), pero las OCs que **sí**
pasan el filtro siguen mandando su PDF completo incrustado en la misma respuesta.

Medido con el proveedor de mayor volumen en producción (Elizabeth Campos Linares): 279 OCs
totales, 242 "visibles" → **~8 MB de PDFs en una sola respuesta**. El push-down a SQL evita
traer los 37 restantes de más, pero no reduce nada para un proveedor con muchas OCs
genuinamente visibles — eso es inherente a mandar el PDF completo de cada una por adelantado,
en vez de bajo demanda.

**Arreglo, mismo patrón que ya existe para el equipo interno (`getPoPdfBase64.ts`):**

```diff
- purchaseOrders: visiblePos.map(p => ({ ...campos, pdfUrl: p.pdfUrl, pdfBase64: p.pdfBase64, pdfFile: p.pdfFile }))
+ purchaseOrders: visiblePos.map(p => ({ ...campos /* sin pdfBase64/pdfFile */ }))
```

Y un endpoint nuevo, público por el mismo token+password, que entregue el PDF de una sola
OC cuando el proveedor de verdad la abre — el frontend del portal lo pide al hacer click,
no de entrada. Paginar la lista (`limit`/`offset` o cursor) también evita que un proveedor
con muchas OCs traiga todo de golpe, aunque sea sin PDF.

---

## Fase 2 — El cambio estructural (semanas)

### 2.1 Terminar lo que ya empezaron: `cellData` como única fuente

Ya tienes el patrón funcionando para reclutamiento. Los pasos:

1. **`cellData` → `jsonb`** en `recruitment_rows`
2. **Replicar el patrón en `tasks`** y en las demás entidades que hoy dependen de
   `cell_values` (timeline, calendario). Hoy solo reclutamiento tiene la copia.
3. **Índice GIN** para poder filtrar por valores dinámicos en SQL:
   ```sql
   create index on recruitment_rows using gin (cell_data jsonb_path_ops);
   ```
4. **`cell_values` queda derivable.** Consérvala un tiempo como respaldo y auditoría;
   después bórrala. **2.8 millones de filas → decenas de miles.**

**Lo que esto habilita, y es lo que preguntaste sobre Monday:**

### 2.2 Cruzar y filtrar en el servidor, no en el navegador

Hoy el front trae filas + columnas + celdas y arma la tabla. Peor: para filtrar o agrupar,
`rowsWithGroup` **materializa todos los valores dinámicos** antes de poder filtrar. Por eso
cambiar de vista congela la tabla.

Con `cellData` en `jsonb`, el filtro vive en SQL:

```sql
select id, participant_name, email, phone, cell_data
  from recruitment_rows
 where project_code = $1
   and deleted_at is null
   and cell_data @> $2::jsonb           -- filtro por columna dinámica
 order by row_order
 limit 100 offset $3;                    -- solo la ventana visible
```

**Eso es exactamente lo que hace Monday:** no traen todas las celdas, traen la ventana
visible ya cruzada, con paginación por rango. No podías hacerlo en Zite porque no había
joins ni agregaciones. En Postgres es una consulta.

### 2.3 Retirar las siete cachés

`cellCache`, `cellMapCache`, `rowsCache`, `colCache`, prefetch de vecinos, skip-stagger,
`silentReload`.

**No fueron sobreingeniería:** eran la única defensa posible sin joins. Pero cada una trajo
sus propios bugs, y juntas hacen que el estado del tablero sea difícil de razonar.

⚠️ **El orden importa.** Primero 2.1 y 2.2, después quitar cachés. Al revés se rompe todo:
las cachés son lo único que hoy sostiene la sensación de velocidad.

---

## Fase 3 — Front (paralelo, independiente del port)

### 3.1 Code splitting

Ya está el `App.tsx` con `lazy()` listo para aplicar. Bundle de 3.98 MB → solo la ruta
activa. Se puede aplicar **hoy, en Zite**, y se lleva al proyecto nuevo.

Recorte adicional: `DynamicColumns.tsx` (98 KB) se queda en el bundle inicial porque
`App.tsx` importa de ahí el `TeamMembersProvider`. **Separar ese provider a su propio
archivo** saca 98 KB del arranque.

### 3.2 Partir `RecruitmentPage.tsx`

3,257 líneas y **103 hooks** en un componente. La tabla ya está virtualizada, así que no
renderiza 5,000 filas — pero cada cambio de estado reejecuta esas 3,257 líneas y reevalúa
los 103 hooks. Eso es la sensación pastosa al escribir o seleccionar.

**Cómo partirlo**, siguiendo el patrón que ya existe en `components/pm/`:

```
components/recruitment/
├── recruitmentTypes.ts
├── recruitmentConstants.ts
├── useRecruitmentData.ts      ← los hooks de datos
├── useRecruitmentFilters.ts   ← filtros y búsqueda
├── RecruitmentToolbar.tsx
├── RecruitmentTable.tsx
├── RecruitmentRowEditor.tsx
└── GroupPanel.tsx
```

Mismos archivos grandes con el mismo problema: `ChatPage` (156 KB), `PMPage` (102 KB),
`SettingsPage` (82 KB), `Layout` (69 KB).

### 3.3 Guardado optimista sin el parpadeo

El síntoma que reportaste — *"agrego texto a un row y tarda en aparecer, como que se borra
y luego aparece"* — es el valor optimista siendo sobrescrito por la respuesta del servidor.

**Arreglo:** que el endpoint devuelva el valor guardado y el cliente **solo reconcilie si
difiere**, en lugar de reemplazar siempre. Y quitar el refresh de seguridad cuando el
realtime sea confiable.

---

## Qué esperar de cada fase

| Fase | Síntoma que resuelve |
|---|---|
| 1.1 | Editar celdas deja de tardar; pegar en lote va en paralelo |
| 1.2 | Cargar reclutamiento y dashboards |
| 1.3 | Los 7–10 s del realtime → instantáneo; se acaban los grupos mal asignados |
| 1.4 | El chat se siente inmediato al enviar |
| 1.5 | Abrir un chat, un tablero o una lista deja de traer miles de registros de más |
| 1.6 | Búsqueda en el chat, editar/borrar mensajes, historial al hacer scroll |
| 1.7 | Portal de proveedores deja de mandar todos los PDFs de golpe |
| 2.1 + 2.2 | **La sensación "como Monday"**: columnas dinámicas al instante, cambiar de vista sin congelar |
| 3.1 | Primera carga de la app |
| 3.2 | La pastosidad al escribir y seleccionar |
| 3.3 | El parpadeo del texto en celdas |

---

## Lo que NO hay que hacer

- **No optimizar durante el port.** La capa de compatibilidad replica Zite a propósito.
  Primero paridad, después mejoras.
- **No agregar una octava capa de caché.** El problema no es falta de caché, es que el
  cruce ocurre en el lugar equivocado.
- **No borrar `cell_values` antes de tener `cellData` como fuente verificada** en *todas*
  las entidades de tablero, no solo reclutamiento.
- **No tocar Ably durante el port.** Funciona y está desacoplado.
- **No hacer el refactor del front y el port al mismo tiempo.** Son independientes: uno
  puede avanzar en Zite mientras el otro avanza en Postgres.
