# NDA a participantes (liga para firmar)

Guía viva del acuerdo de confidencialidad que firman los participantes desde su celular. Nació el 2026-11-04: primero el botón «NDA» solo marcaba la fila, luego mandó el correo con el texto y, el mismo día, pasó a este flujo con firma.

## Cómo funciona

1. **El equipo manda el NDA** con el botón «NDA» de la tabla de Reclutamiento (o la columna de tipo botón con la acción «Enviar NDA»). Toma de la fila el nombre y el correo, crea un **envío** con su **liga personal** (`https://sharpli.mx/nda/<token>`) y manda un correo con el botón «Leer y firmar».
2. **La persona abre la liga** (sin cuenta, sin instalar nada): lee el acuerdo, confirma su nombre completo (viene de la fila pero puede corregirlo), dibuja su firma, marca «Leí y acepto» y toca «Firmar y enviar». O toca «No acepto» (con motivo opcional).
3. **El Hub guarda la firma**, y enseguida hace el **PDF firmado** (el texto con su nombre, la firma, la fecha y una constancia), lo guarda en un bucket privado de Storage y le manda **una copia por correo** a la persona.
4. **El equipo lo ve en la tabla**: la columna «NDA» muestra el estado de cada fila (ver abajo) y, al tocarlo, un detalle con la línea de tiempo, la constancia y el botón «Ver PDF firmado».

## Estados (columna «NDA» de la tabla)

Un envío pasa por: **Enviado** (gris) → **Abrió** (azul: entró a la liga) → **Firmado** (verde) o **Rechazó** (rojo). Mismo color, mismo significado que el resto del Hub (`src/lib/toolColors.tsx`). «Abrió» se marca cuando la página carga en el navegador de la persona (no con un píxel en el correo, que Apple Mail y Outlook bloquean o marcan solos). La tabla se actualiza sola cada 45 s y al volver a la pestaña. Una fila marcada «enviado» a mano antes de este flujo (sin liga) sigue mostrando «NDA ✓», que ofrece mandarlo con liga.

Desde el detalle (clic en el estado): **Ver PDF firmado**, **Copiar liga** (para mandarla por WhatsApp: firmar por ahí también queda registrado), **Reenviar correo** (misma liga), **Mandar de nuevo** (si rechazó) y **Mandar otro** (si ya firmó): los dos crean un envío nuevo con liga nueva y lo anterior queda guardado.

## Vistas externas: el estado, solo para ver (2026-11-05, pedido de Sergio)

La columna «NDA» también se ve en las **vistas externas** (la liga `/shared/<token>` de solo lectura que se comparte fuera del equipo): cada persona sale con su pill (Enviado, Abrió, Firmado, Rechazó; al pasar el cursor, qué significa y la fecha de ese paso) y quien la mira **no puede mandar, reenviar ni cambiar nada** (no hay botón, ni detalle, ni PDF).

- **Quién la muestra:** `getSharedViewData` trata `nda` como una columna fija más (`FIXED_ORDER`, después de «Estado»). Las externas ligadas a una vista interna (401 de 412 al 2026-11-05) copian en vivo sus columnas: si la vista interna **muestra** «NDA», la externa también; si la oculta, la externa tampoco (hoy lo muestran 24, en 9 proyectos; las 377 restantes lo ocultan). Para mostrarla en otra, se muestra la columna «NDA» en su vista interna. Las externas «solas» (Compartir → «Nueva vista») la traen si se marca la casilla «NDA» (nace desmarcada).
- **Qué sale y qué no:** solo `ndaEstado` y `ndaFecha` por fila (`estadoPublicoDeProyecto` en `servicio.ts`: el último envío de la fila; la fecha es la del último paso). **Nunca** la liga de firma (con ella alguien podría firmar por la persona), el correo del envío, la IP, el dispositivo, la firma, el PDF ni el id del envío. Una fila marcada «enviado» a mano antes del flujo con liga sale como «Enviado». Si la vista no muestra la columna, ni se consulta el NDA.
- **Si faltan las tablas del NDA** (una base sin el DDL), la vista sigue funcionando con lo marcado a mano, como la tabla del equipo.
- Pantalla: `SharedViewPage.tsx` (celda `nda`) con el mismo `NdaPill` de la tabla.

## Qué se guarda (`nda_envios` y `nda_eventos`, ver `server/generate.py` → EXTRA_TABLES)

- Por envío: token, fila, proyecto, nombre y correo con que se mandó, estado y sus fechas, el nombre que la persona confirmó al firmar, la **huella (SHA-256) del texto exacto** que firmó (versión del texto + texto con su nombre), la firma (PNG en base64), IP y dispositivo, ruta y huella del PDF, y quién lo mandó.
- **Bitácora `nda_eventos`**: enviado, reenviado, abierto, firmado, rechazado, pdf_creado, pdf_fallido, copia_enviada, copia_fallida. Solo se agrega: un trigger rechaza UPDATE, DELETE y TRUNCATE (`add-nda-tables.ts`). No tiene FK a `recruitment_rows` a propósito: la evidencia sobrevive aunque borren a la persona del tablero. Las dos tablas traen una secuencia `n` (identity): el último envío de una fila y la línea de tiempo se ordenan por `n` y no por la fecha, para que dos movimientos del mismo instante no queden revueltos.
- **PDF**: bucket privado `nda` (ruta `<año>/<envío>.pdf`); solo se ve con liga temporal de 10 min (`getNDAPdfUrl`). La IP sale de `X-Forwarded-For` (primer salto) y es aproximada: apoya la constancia, no la prueba por sí sola. **Una sola hoja**: el acuerdo, la firma y la constancia van juntos en la misma página (la constancia está en dos columnas para ocupar poco alto). El contenido se mide al ancho real de la hoja y, si pasara del alto, se achica solo lo justo (hasta 80 %; `ajustarAUnaHoja` en `pdf.ts`): lo normal usa ≈ 86 % de la hoja sin achicar y con lo más largo que permiten los límites (nombre de 120 caracteres, lugar de 200) basta achicar ≈ 2 %. Si algún día no cupiera ni a 80 %, sigue en una segunda hoja y la constancia no se parte. Dos pruebas con PDF real cuidan que sea una hoja.

## Reglas

- No manda nada sin nombre, sin correo, con un correo que no es correo (o con varios) o si la fila está eliminada (`deleted_at` es TEXTO: viva = `NULL` o `''`).
- Un envío pendiente (sin firmar ni rechazar) se **reenvía con la misma liga**; uno ya firmado o rechazado no se vuelve a mandar salvo que se pida «nuevo».
- Dos clics casi juntos mandan un solo correo (el envío se aparta en `recruitment_rows.nda_sent_date` antes de mandarlo; no se manda otro en el mismo minuto).
- Si Outlook no lo acepta no queda nada a medias (ni envío, ni marca, ni fecha) y se puede reintentar enseguida.
- Cada cambio de estado es **una sola sentencia con condición** que además escribe la bitácora: dos firmas a la vez dejan una firma y un PDF; firmar después de rechazar (o al revés) no se puede.
- Se valida que la firma sea un PNG con trazo de verdad (un recuadro vacío o un punto no cuentan) y se reduce a 600 px; el nombre debe tener al menos dos palabras; hay que marcar «Leí y acepto».
- **El PDF se hace después de guardar la firma**: si Chrome, Storage o el correo fallan, la firma queda a salvo, se anota `pdf_fallido`/`copia_fallida` y «Ver PDF firmado» lo rehace (y manda la copia que no salió).
- Límites por IP en los tres endpoints públicos (`server/index.ts`, `PUBLIC_RATE_LIMITS`).

## El texto

Está en `src/serverUtils/nda/correo.ts` (`NDA_SECCIONES`), palabra por palabra como lo redactó Sergio. **Si cambia el texto, subir `NDA_TEXTO_VERSION`** (queda guardada con cada firma) y cambiar también `ORIGINAL` en `server/scripts/test-nda.ts`. Conviene que lo revise un abogado.

**El cierre del acuerdo (2026-11-04, pedido de Sergio):** «Declaraciones finales» termina con dos párrafos que agregó él: la **aceptación expresa** («Al firmar, acepto los términos y condiciones de este acuerdo y confirmo que soy mayor de edad, que lo leí y lo entendí, y que la firma que aparece aquí es mía») y el **aviso de privacidad** («Conozco el aviso de privacidad de Asesores Globales Corporativos SC, disponible en sharpli.mx/f/aviso, y acepto que se registren mi nombre, mi firma, la fecha y hora, mi dispositivo y mi dirección IP como constancia de esta firma»). Así la aceptación queda en el texto que se hashea y en el PDF firmado, no solo en la casilla «Leí y acepto» de la página (esa casilla no se guarda ni sale en el PDF). La dirección del aviso es una liga en la página (abre en otra pestaña, para leerlo antes de aceptar) y en el PDF. El aviso publicado es el Word «Aviso de Privacidad AGC» (actualizado 05/11/2026; se cambia con `scripts/subir-aviso-privacidad.ts`, que guarda una copia con fecha de cada versión): nombra a AGC como responsable y su lista de datos es «enunciativa, no limitativa», pero no nombra firma, IP ni dispositivo; por eso el párrafo lo dice. Versión vigente del texto: `2026-11-04-2`.

**La confidencialidad también va en el aviso (2026-11-05):** a petición de Sergio, el aviso trae la sección «CONFIDENCIALIDAD DE LA PARTICIPACIÓN»: quien acepta el aviso (primer paso de todo filtro) ya aceptó guardar confidencialidad sobre lo que conozca de un estudio, y este NDA, que se firma por sesión, lo refuerza con nombre, firma y constancia. El aviso es de AGC y lo lee toda persona que entra a un filtro, así que ahí va lo general; lo propio de cada sesión (día, hora, lugar) sigue en este acuerdo. Detalle y copias con fecha en `docs/filtros.md` (aviso de privacidad). El mismo día la cláusula de «Modificaciones» del aviso pasó de «www.agcmx.com» a «sharpli.mx/f/aviso», la misma dirección que cita el NDA. Pendiente de la revisión del abogado.

## Piezas

- Servidor: `src/serverUtils/nda/` (`correo.ts` texto y correos · `outlook.ts` envío por Graph · `enviar.ts` fila → envío → correo · `servicio.ts` todo el SQL y el ciclo de vida · `pdf.ts` PDF con Chrome · `storage.ts` bucket). Endpoints: públicos `getNDAPublic`, `signNDA`, `rejectNDA`; del equipo `sendNDAEmail`, `getNDAStatuses`, `getNDADetail`, `getNDAPdfUrl`. `executeButtonAction` (`send_nda`) usa el mismo envío.
- Front: página pública `src/pages/NdaPage.tsx` (ruta `/nda/:token`, hermana de `<Layout>`), `src/components/nda/` (`SignaturePad`, `NdaPill`, `NdaDetailDialog`), la celda «NDA» y el diálogo de confirmación en `RecruitmentPage.tsx`, y `src/lib/nda.ts`.
- Correo: sale de `sesiones@sapience.com.mx` (el buzón de Prework; `NDA_SEND_AS_EMAIL` lo cambia) y deja copia en «Enviados»; el correo sí lleva el logo y el nombre de Sapience, la página de firma no. La liga es del dominio de los participantes (ver abajo); `NDA_PUBLIC_URL` la cambia.

## La liga vive en sharpli.mx (pedido de Sergio, 2026-11-04)

Es el dominio neutro donde contestan los participantes de Filtros (`docs/filtros.md`): el mismo sitio de Render que el Hub, pero ahí solo se cargan las pantallas de los participantes y nunca el código del Hub.

- **Qué carga:** `main.tsx` detecta el dominio (`lib/formularios/dominio.ts`) y monta `SoloFormularios.tsx`, que ahora tiene `/f/:codigo` (formulario) y `/nda/:token` (esta página). Cualquier otra dirección dice «Este enlace no existe». La página no lleva marca (título «Acuerdo de confidencialidad», sin ícono) y ningún archivo de esa pantalla puede mencionar a Sapience: lo cuida una prueba. Revisado también en el build: lo que baja `sharpli.mx` no incluye el `App` del Hub ni la palabra Sapience.
- **Qué le contesta el servidor:** desde `sharpli.mx` el navegador solo puede llamar los servicios de los participantes (`server/corsFormularios.ts`: `FORMULARIO_ENDPOINTS`, que ahora incluye `getNDAPublic`, `signNDA` y `rejectNDA`). Los del equipo (`sendNDAEmail`, `getNDAStatuses`, `getNDADetail`, `getNDAPdfUrl`) se rechazan desde ahí. **Si la página de firma llega a llamar otro servicio, hay que agregarlo a esa lista**: si no, solo falla en producción, en silencio, por CORS; una prueba cuida que los tres públicos estén y los del equipo no.
- **Quién arma la liga:** el servidor (`enlaceDe` en `servicio.ts`): `https://sharpli.mx/nda/<token>`, o `NDA_PUBLIC_URL` si está puesta (p. ej. `http://sharpli.localhost:5173` para verla como la ve el participante, o `http://localhost:5173` contra el Hub local). La misma página también abre en el dominio del Hub (`/nda/:token`), por si hace falta.
- **Al desplegar:** el front (sitio estático) y el API (servicio web) salen con el mismo push, pero no a la vez: en esos minutos una liga puede decir «Este enlace no existe» (front viejo) o fallar por CORS (API viejo). Conviene mandar los primeros NDA un rato después de que terminen los dos.

## Despliegue

1. **Antes de subir el código**: `cd server && npx tsx --env-file=../.env scripts/add-nda-tables.ts` (crea las dos tablas, los índices, el trigger de la bitácora y el bucket privado `nda`; solo agrega, es idempotente). Si el código sale antes, el botón avisa que faltan las tablas y no manda nada, y la tabla muestra el botón de siempre.
2. Render ya instala Chrome en el build (`npx puppeteer browsers install chrome`), que el PDF necesita. No hay variables nuevas obligatorias (`NDA_SEND_AS_EMAIL` y `NDA_BUCKET` son opcionales).

## Cuidado al probar en local

`.env` trae la base de PRODUCCIÓN y las credenciales REALES de Outlook: un clic de verdad en el botón desde el Hub local manda un correo real a una persona real, con una liga real de `sharpli.mx` (si no se pone `NDA_PUBLIC_URL`). Para ver las pantallas sin riesgo, parchar `window.fetch` en el navegador para `sendNDAEmail`, `executeButtonAction` y `markNDASent` (y simular `getNDAPublic`, `signNDA`, `rejectNDA`, `getNDAStatuses`, `getNDADetail`, `getNDAPdfUrl`) y comprobar que el parche atrapa una llamada de prueba; la página pública se carga por navegación interna (`history.pushState`) DESPUÉS de instalar el parche; para verla como el participante, abrirla en `http://sharpli.localhost:5173` (el mismo sitio, en su versión neutra). Las pruebas automáticas no mandan nada: simulan Graph y Storage.

## Lo que todavía no hace

- Escribir el resultado en las columnas «Status NDA» / «NDA Firmado» de cada tablero (hoy el estado vive en la columna fija «NDA»).
- Filtrar o agrupar la tabla por estado del NDA; mandar a varias filas de una vez; recordatorios a quien no ha firmado.
- Firma con validación de identidad y sello NOM-151 (proveedor): el paso de firma es una sola página (`NdaPage` + `signNDA`) y se puede cambiar por proyecto; ver la memoria `project_nda_participantes`.
- Confirmar mayoría de edad; revisión del texto por abogado.

## Pruebas

`node server/node_modules/.bin/tsx server/scripts/test-nda.ts` (49 pruebas: base en memoria con el esquema real y el SQL real del script, Graph y Storage simulados, la regla de CORS de `sharpli.mx`, las rutas de la página y un PDF real con Chrome leído de vuelta; datos inventados).

`node server/node_modules/.bin/tsx server/scripts/test-vista-externa-nda.ts` (11 pruebas de la columna en vistas externas: ligada a la vista interna o «sola», con y sin la columna, último envío, marca a mano, que no salga nada del envío —ni liga, ni IP, ni firma— y que mirar la vista no cambie nada; también sin las tablas del NDA).
