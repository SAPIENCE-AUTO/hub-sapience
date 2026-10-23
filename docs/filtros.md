# Filtros (screeners) — guía de construcción

Guía viva del feature **Filtros** (en el código todavía se llama *Formularios*). Cada sesión que trabaje en él:

1. **Lee esta guía completa y el código que menciona antes de tocar nada.**
2. Trabaja solo en la fase que le toca.
3. **Al terminar, actualiza la guía:** el estado de su fase, lo que construyó, las decisiones nuevas y lo que quedó pendiente (sección «Bitácora»).

Diseño de producto (cómo debe verse y funcionar, con bocetos): documento «Filtros en el Hub: diseño de punta a punta» — https://claude.ai/artifact/WBs2tSpYCVRBurGLqP25n8

## Qué es

Filtros reemplaza a Fillout dentro del Hub. De las notas de un proyecto sale un screener que se revisa y corrige en pantalla, y de ese **único diseño** salen:

- el Word o PDF para el cliente;
- el formulario que contestan los participantes;
- las filas del tablero de Reclutamiento;
- los registros de la base de participantes.

Usuario: Sergio (`sergio@sapience.com.mx`). **Solo él lo ve hasta la fase 6** (`FORMULARIOS_ALLOWED_EMAILS` en `src/lib/formularios/acceso.ts`; el candado real es del servidor, `exigirAccesoFormularios`).

## Lo que ya existe

Commits en `main`: `890cb77`, `255381b`, `a91f52e` y `c8431ca` (21 y 22 de octubre de 2026); fase 1 en `3d5bbfd`.

**Base de datos** (fuera del pipeline de `generate.py`, como Swipe; los endpoints usan `pool.query`):

- `formularios`: `id`, `proyecto_id` (→ `projects.id`), `codigo` (va en el enlace `/f/:codigo`, al azar), `titulo` (interno), `plantilla`, `definicion jsonb` (copia del screener al crearlo), `estado` (`borrador` | `prueba` | `en_vivo` | `cerrado`; «en vivo» aún no se ofrece), `vinculo jsonb` (tablero de Reclutamiento), `created_by`, fechas.
- `formulario_respuestas`: `respuestas jsonb`, `resultado jsonb` (lo calcula el servidor), `califica`, `es_prueba`, `nombre`, `telefono`, `device_token`, `duracion_seg`.
- Bucket **privado** `formularios` en Supabase Storage: fotos de participantes, carpeta por formulario; se ven con URL firmada.
- Script: `server/scripts/add-formularios-tables.ts`. Es aditivo e idempotente, y **ya se corrió en producción**. Si una fase necesita columnas nuevas, se agregan ahí con `alter table … add column if not exists`, y **se pide el OK de Sergio antes de correrlo**.

**Lógica compartida** (`src/lib/formularios/`, funciones puras que usan el navegador y el servidor):

- `tipos.ts`: **el contrato** (ver abajo), con la tabla `TIPOS` y `leerDefinicion` (lee versiones guardadas).
- `paises.ts` y `nse.ts` (fase 1): países con su asociación de NSE y su dirección; reglas de NSE como data.
- `revisar.ts` (fase 1): `revisarDefinicion`, que dice en palabras qué está mal armado en un screener.
- `motor.ts`:
  - `pantallas`: qué pantallas y preguntas se ven con las respuestas actuales.
  - `validar` / `validarPantalla`.
  - `terminacion`.
  - `evaluar`: calificación completa.
  - `definicionPublica`: quita lo interno antes de mandarlo al navegador.
  - `describir`.
  - `explicarResultado`.
- `tabla.ts`: `columnas(def, filas, { completas })`, con una columna por pregunta y clave estable. La usan el Excel y el tablero.
- `excel.ts`: Excel con el membrete del de Reclutamiento.
- `plantillas/along2.ts`: screener de ALONG 2 (primer ensayo). `plantillas/pruebaTipos.ts` (fase 1): «Prueba · todos los tipos de pregunta». `plantillas/index.ts`: lista de plantillas.

**Servidor:**

- `src/serverUtils/formularios/`:
  - `acceso.ts`;
  - `storage.ts` (bucket privado);
  - `reclutamiento.ts`: vínculo con tablero, `asegurarColumnas` crea **todas** las columnas al vincular, `pasarAlReclutamiento` no duplica por tablero gracias a `source_form = «Formulario Hub · título|id»`, y `vinculoVigente` relee el nombre del tablero.
- Endpoints en `src/api/`:
  - de formularios: `getFormularios`, `createFormulario`, `getFormularioDetail`, `getFormularioRespuesta`, `setFormularioEstado`, `deleteFormulario`, `deleteFormularioRespuestas`, `exportFormularioRespuestas`;
  - públicos: `getFormularioPublico` y `submitFormularioRespuesta`;
  - de tableros: `getTablerosReclutamiento`, `vincularFormularioTablero`, `crearTableroParaFormulario`, `pasarFormularioAlReclutamiento`.
- Las fotos se suben por `server/upload.ts`, en la rama `formularioCodigo`: solo imágenes, 20 MB, bucket privado.

**Pantallas:**

- `src/pages/FormularioPublicoPage.tsx` (ruta pública `/f/:codigo` en `App.tsx`) y `src/components/formularios/CampoPregunta.tsx`, que reparte cada tipo a `src/components/formularios/campos/` (opciones, listas, imágenes y ordenar en `Opciones.tsx`; `Matriz`, `Escalas`, `Direccion`, `Foto`; colores en `estilo.ts`).
- `src/components/formularios/FormulariosPanel.tsx`: pestaña Tools → Formularios del proyecto (`ProjectToolsTab.tsx`). Incluye cuotas, respuestas, detalle con fotos, Excel y la tarjeta de Reclutamiento.

**Pruebas:** `cd server && npx tsx scripts/test-formularios.ts` (36 pruebas del motor, la revisión, las reglas de NSE, las columnas y el Excel; datos inventados, no toca la base).

## El contrato del screener (`src/lib/formularios/tipos.ts`)

Todo depende de esto; cambiarlo afecta a todas las fases.

- **Un screener es data, no código.** La `Definicion` es un JSON que se guarda en `formularios.definicion` al crear el filtro. Si después cambia una plantilla, los filtros ya creados no cambian.
- **Versión 2** (fase 1): `version: 2` y `pais` (código ISO, ver `paises.ts`). Lo guardado en versión 1 (el ensayo de ALONG 2) se lee con `leerDefinicion`, que solo le agrega `pais: 'MX'` y el origen de su NSE: mismos tipos, mismas claves de respuesta y de columna. **Todo endpoint que lee `formularios.definicion` pasa por `leerDefinicion`.** No se reescribió nada en la base. Las respuestas nuevas del ensayo ya se califican con el NSE como alerta; las ya guardadas conservan su resultado.
- **Estructura:** `secciones[]` → `preguntas[]`. Cada pregunta tiene `id`, `tipo`, `texto` y, según el tipo, `opciones`, `filas` (matriz), `min`/`max`/`paso`/`etiquetas` (escalas), `patron`, `imagen`, `mostrarSi`, etc. `nota` es lógica para el equipo y nunca llega al participante.
- **Tipos** (`TIPOS` en `tipos.ts`, con su nombre y qué guarda cada uno):
  - se escriben: `texto`, `texto_largo`, `numero`, `telefono`, `correo`, `direccion`;
  - de opciones, **una o varias dicho por el tipo, nunca deducido**: `unica`/`multiple` (botones), `lista`/`lista_multiple` (desplegable y selección en lista con buscador), `imagen_unica`/`imagen_multiple` (la imagen va en `opcion.imagen` como URL), `matriz`/`matriz_multiple` (una o varias por fila), `ordenar`;
  - escalas, que dan número: `escala` (0–10 si no se dice), `estrellas` (1–5), `deslizador` (0–100; sin respuesta hasta que se toca);
  - `casilla` (marcada = `'si'`; si es obligatoria hay que marcarla) e `interruptor` (arranca y se guarda en `'no'`);
  - `foto`;
  - `contenido`: texto o imagen sin pregunta. Una sección con solo contenido es una pantalla de instrucciones o de concepto; no da columna ni sale en el detalle.
- **`revisarDefinicion`** (`revisar.ts`) rechaza lo ambiguo: «exclusiva» o máximo de opciones en una pregunta de una sola respuesta, opciones en un tipo que no las lleva, selector con imágenes sin imágenes, repetir por una pregunta que no es de varias, NSE que suma preguntas que no existen, lógica que apunta a preguntas que no existen. `createFormulario` no crea un filtro con problemas; el editor de la fase 2 debe usarla al guardar.
- **Secciones que se repiten:** `repetirPor` = id de una pregunta múltiple; la sección se repite por cada opción marcada (`repetirSolo` acota). `{opcion}` en los textos se reemplaza por `opcion.corto ?? opcion.label`.
- **Claves de respuesta:** `id` de la pregunta; dentro de una repetición `id@opcion`; el texto de «Otra» en `clave#otra`. Valores: opción = id; varias = ids (en `ordenar`, en el orden elegido); matriz = fila → id o ids; dirección = `{ calle, numero, colonia, ciudad, estado, cp }`; escalas = número; casilla e interruptor = `'si'`/`'no'`; fotos = `[{ ruta, nombre }]`. Por eso los ids no llevan `@`, `#` ni punto.
- **Lógica** (`Condicion`):
  - formas básicas: `pregunta` + `incluye` / `noIncluye` / `incluyeTodas` (con `instancia` opcional), `numero` + `entre` (también escalas y estrellas; `instancia` opcional), `bloque` (una repetición existe y no fue descartada), `instanciaEs`, `nse`;
  - combinaciones: `todas`, `alguna`, `no`.
  - En las opciones:
    - `termina`: el filtro termina;
    - `descarta`: solo esa repetición;
    - `excluyeGrupos`: fuera de los frentes de ese grupo;
    - `exclusiva`: tipo «Ninguno»;
    - `otra` y `fija`.
  - En la pregunta: `terminaFuera` (número fuera de rango) y `terminaSi`.
- **Frentes y cuotas:** `frentes[] = { id, nombre, grupo, meta, califica: Condicion }`. **Alertas:** `alertas[]`.
- **NSE: alerta, nunca descarte.** `nse = { regla, porConfirmar, puntos, cortes }` es una **copia** de la regla del país (`reglaNse(pais)` y sus preguntas estándar `preguntasNse(pais)` en `nse.ts`). En un frente, lo que pide de NSE no saca a nadie: la persona entra al frente y, si su NSE no es el que pide el camino por el que entró, sale la alerta «NSE C, el frente Aerosoles / Pure pide C+» y el frente queda en `resultado.nse.fueraDe`. El panel lo marca en la lista y lo cuenta en las cuotas («Con NSE distinto»). Si un filtro trae una regla que ya no es la vigente del país (`reglaVigente`), el panel lo dice («AMAI 2018 (la vigente es AMAI 2022)»); el filtro no se toca.
- **El servidor decide:** `evaluar` corre en el servidor con la definición completa. Al navegador solo llega `definicionPublica` (sin frentes, NSE, alertas, notas ni motivos).
- **Claves de columna estables** (`tabla.ts`): el mapa clave → columna del tablero vive en `formularios.vinculo.columnas`. No cambiar claves de preguntas ya existentes sin migrar ese mapa. Matriz: `clave.fila`; dirección: `clave.calle`, `clave.cp`, etc.; escalas como columna de número; lo marcado se lee en el orden de las opciones (menos `ordenar`). Las 156 columnas del ensayo siguen idénticas.

## Reglas para diseñar screeners (de Sergio)

- Máximo **10 minutos**. Lo dicen sus tres versiones del screener de ALONG 2.
- **De lo general a lo particular:** categorías → formatos o tipos → el detalle solo dentro de cada uno.
- **Abiertas solo donde una lista sesgaría:** aromas, variantes y, cuando importa, la marca actual. Marcas, lugar de compra, tiempos y tamaños van de opción.
- **Otras categorías solo para disimular**, sin preguntas propias. **Nunca se menciona al cliente** en lo que ve el participante.
- **Opción única u opción múltiple, decidido por lo que se pregunta.** Ojo: en Fillout se usaron casillas para preguntas de una sola respuesta porque la integración con Monday no aceptaba opción única. No copiar ese tipo de los formularios viejos.
- **Controles contra quien inventa:** una marca que no existe como trampa, fotos con marca y aroma visibles, y preguntas que se cruzan.
- **Filtros de seguridad estándar:** giros, estudios recientes y aceptación de las condiciones.

## Requisitos del producto (2026-10-22)

1. Las respuestas alimentan la **base de participantes**, para reusar gente en otros proyectos.
2. **Generador con IA:** recibe notas, propuesta y transcripción del kick-off (Notetaker) y trabaja en dos etapas: estructura con supuestos y luego preguntas. Mismo patrón que Propuestas y la guía de tópicos (`paquetes/guias-topicos/`).
3. **Word o PDF que se sienta hecho por una persona:** sin recuadros de colores, flechas, etiquetas ni numeración 01/02.
4. **Lo primero que se ve es el screener como documento en pantalla**, igual al Word, con el **mapa del flujo** al lado. Hay tres vistas: Documento, Flujo y Celular. Se corrige ahí mismo:
   - a mano;
   - con el botón **IA** por pregunta, que muestra su propuesta antes de aplicarla;
   - con **comentarios por sección** para la lógica.
   - Además: supuestos con «Ya lo revisé» y deshacer.
5. Vive **en cada proyecto** (pestaña «Filtros») **y en la biblioteca «Filtros»** del menú, con un solo origen. La biblioteca permite buscar, filtrar, ver en qué proyectos se usó, ver la incidencia y relanzar duplicando a otro proyecto.
6. **NSE por país como indicador y alerta, nunca como descarte.** Reglas: AMAI en México, APEIM en Perú, ABEP en Brasil, AIM en Chile, SAIMO en Argentina y estrato en Colombia. Centroamérica no tiene regla única. Hay que confirmar la versión vigente de cada una.
7. **Formulario bonito pero neutro:** sin marca de cliente ni de agencia, colores sobrios. Enlace en un **dominio de Sharpli**, y en ese dominio solo se ven formularios.
8. **Todos los tipos de pregunta de Fillout**, empezando por los más usados (ver fase 1).
9. **Imágenes de las preguntas:** se arrastran o pegan en el editor y van a una carpeta pública, como en Swipe.
10. **Fotos y videos de participantes:** con tope, subida directa a Storage con barra de avance, privados, y se reproducen con Mux.

## Convenciones para trabajar en este feature

- **Lenguaje llano con Sergio:** sin jerga de código; las decisiones se plantean como pregunta simple.
- **Pantallas del Hub con el sistema del moodboard** (`src/lib/toolColors.tsx`):
  - teal `#0F3D4D`, gold `#F4C025`, Info, Éxito, Alerta y Peligro;
  - pills sólidos chicos con puntito blanco y botones teal con profundidad suave;
  - fondo blanco, sin avatares ni morado.
  - **El formulario del participante es la excepción:** va en neutros, sin teal ni gold.
- Endpoints con `createEndpoint` y zod de entrada y salida. `STRICT_OUTPUT=true` está activo: la salida tiene que calzar con su esquema.
- **Sin datos reales en commits ni en pruebas:** nombres como «Persona Prueba», correos `@ejemplo.test`, teléfonos `5500000000`.
- **En los commits va solo lo de Filtros.** El árbol de trabajo tiene cambios de otros features sin subir (Conciliación, por ejemplo, en `App.tsx` y `src/shims/zite-endpoints-sdk.ts`). En esos archivos se preparan solo las líneas propias con `git hash-object` + `git update-index`, sin tocar la copia de trabajo. **Commit y push solo con el OK de Sergio.** Se publica con `git push origin main` y Render despliega solo.
- **Probar en local:** `.claude/launch.json` tiene `hub-sapience` (5173) y `hub-sapience-api` (8787), con `VITE_MOCK_USER=true` como Sergio.
  - **La base local es la de producción.** Usar proyectos de prueba: el ensayo vive en **«3 MAYO PRUEBA 3»**, código `o81xrb8`.
  - La URL de un proyecto usa su código: `/operacion/proyectos/3%20MAYO%20PRUEBA%203?tab=tools`.
  - Un endpoint nuevo en `src/api/` exige reiniciar `hub-sapience-api` y registrarlo en `src/shims/zite-endpoints-sdk.ts`.
- **Trampa conocida:** en `recruitment_rows` y `board_columns`, `deleted_at` es texto y lo vivo trae `''`. Contar con `(deleted_at is null or deleted_at = '')`.
- **Revisión de tipos:** el `tsconfig.json` del front falla con TypeScript 7 por `baseUrl`. Hay que usar una copia sin `baseUrl` con rutas absolutas y filtrar los errores a los archivos propios; los demás ya existían.

## Fases

| # | Fase | Estado |
|---|---|---|
| 1 | Base: tipos de pregunta, lógica, opción única/múltiple, NSE por país como alerta | **Hecha** (`3d5bbfd`, 2026-10-22) |
| 2 | Editor: documento en pantalla + mapa del flujo, edición a mano, imágenes, versiones; panel con «Ver» y pantallas angostas | Pendiente |
| 3 | Generador con IA: insumos, estructura con supuestos, preguntas, comentarios a la IA, tope de uso | Pendiente |
| 4 | Salidas: Word/PDF humano, formulario neutro en dominio Sharpli, captcha, aviso de privacidad, fotos y videos | Pendiente (necesita decisiones) |
| 5 | Operación: en vivo, paso solo al tablero, base de participantes con historial, cerrar cuotas | Pendiente (necesita decisiones) |
| 6 | Biblioteca «Filtros», relanzar, incidencia, abrir al equipo | Pendiente |

### Fase 1 · Base del screener

**Qué entra:**

- **Tipos de pregunta nuevos en el contrato, el formulario público, la validación, el panel (`describir`), el Excel y las columnas del tablero:**
  - texto corto y largo, número, teléfono y correo (ya existen);
  - **dirección** (calle, número, colonia, ciudad, estado, código postal);
  - opción única y múltiple, con tope de cuántas;
  - **lista desplegable** y **selección múltiple en lista**, para listas largas;
  - **selector con imágenes**, de una o de varias. La imagen va en la opción como URL; subirla con arrastrar es de la fase 2.
  - **matriz** de una o de varias respuestas por fila;
  - **escala de opinión**, **estrellas** y **deslizador**, con etiquetas en los extremos;
  - **ordenar** (ranking);
  - **casilla única** e **interruptor sí/no**;
  - **foto** (ya existe);
  - **pantallas de texto o imagen sin pregunta**, para instrucciones o para mostrar un concepto;
  - el **captcha** se deja anotado para la fase 4, porque depende del dominio.
- **Opción única y múltiple siempre explícitas** en el contrato, nunca deducidas.
- **NSE por país como alerta:**
  - la `Definicion` lleva `pais`;
  - las reglas de NSE viven como data por país; se arranca con México AMAI y la estructura queda lista para las demás;
  - el NSE **sale de las condiciones de los frentes**: si no coincide con el frente, genera una alerta («NSE C, el frente pide C+») en lugar de sacar a la persona;
  - los puntos AMAI actuales son de la regla 2018 y hay que marcarlos como «por confirmar» (resuelto: Sergio pasó el cuestionario oficial de la AMAI 2022 y es la que se usa).
- **Versión del contrato:** `version: 2`. Las definiciones ya guardadas (el ensayo y la plantilla de ALONG 2) se migran o se leen de forma compatible, sin romper el ensayo de «3 MAYO PRUEBA 3».
- **Pruebas:** ampliar `server/scripts/test-formularios.ts` con cada tipo nuevo y con la alerta de NSE.

**Qué NO entra** (es de otras fases): el editor, el generador con IA, el Word, el dominio de Sharpli, los videos, «en vivo», la base de participantes y la biblioteca.

**Qué se construyó (2026-10-22):**

- Contrato versión 2 con los tipos de arriba, `pais`, `TIPOS`, `leerDefinicion` y `revisarDefinicion`.
- `paises.ts`: México completo (asociación AMAI, nombres de la dirección, 32 estados, código postal de 5 dígitos); Perú, Brasil, Chile, Argentina y Colombia con su asociación anotada y sin regla cargada; Centroamérica sin regla única.
- `nse.ts`: regla **«AMAI 2022», la vigente y confirmada**, tomada del cuestionario oficial que pasó Sergio («Cuestionario para la aplicación de la regla AMAI 2022 y tabla de clasificación»; él la llamó «la 2024, la más reciente», el documento dice 2022). Mismos puntos que la 2018; cambian los cortes: A/B desde 202, C+ 168, C 141, C- 116, D+ 95, D 48, E 0 (la 2018 era 205, 166, 136, 112, 90). Sus 6 preguntas estándar conservan los ids de ALONG 2; se ajustó la redacción al cuestionario oficial («jefe o jefa de tu hogar», autos «contando camionetas cerradas, con cabina o con caja», «en el último mes») y «Carrera comercial» y «Carrera técnica» van separadas (23 puntos las dos; la opción nueva es `comercial`). ALONG 2 toma de ahí sus preguntas y su regla, así que un filtro nuevo de ALONG 2 ya sale con la 2022; el ensayo ya guardado conserva la 2018.
- Motor: validación de cada tipo nuevo, NSE como alerta en los frentes (también en caminos con «alguna»), `textoRespuesta` compartido por el detalle del panel, el Excel y el tablero.
- Formulario del participante con todos los tipos, en neutros (un solo acento oscuro `#1F1F23`, sin teal ni gold). El logo de Sapience sigue en el encabezado: quitarlo va con el formulario neutro de la fase 4.
- Panel: país y regla de NSE («México · NSE AMAI 2022»; si es una anterior, «(la vigente es …)»; si está por confirmar, «(puntos por confirmar)»), NSE distinto marcado en la lista, columna «Con NSE distinto» en las cuotas.
- Plantilla «Prueba · todos los tipos de pregunta» (imágenes dibujadas dentro de la plantilla, sin carpeta pública).
- De paso: la tarjeta de Reclutamiento del panel conservaba el nombre del primer formulario abierto y así nombraba el tablero nuevo de otro (así salieron «Screener ALONG 2 · ensayo (2)» y «(3)»). Ya se reinicia por formulario.

**Probado en local:** formulario «Prueba fase 1 · todos los tipos» (código `lv4los`) en «3 MAYO PRUEBA 3», contestado de punta a punta en tamaño celular (dos respuestas: una califica con alerta de NSE C, otra termina por una opción de la lista); detalle, Excel (una columna por campo de dirección y por fila de matriz, escalas como número) y tablero «Prueba fase 1 · todos los tipos» (44 columnas, una fila «Pendiente»). El ensayo `o81xrb8` abre, avanza y conserva sus 156 columnas. **Quedan en la base:** ese formulario de prueba con sus 2 respuestas y ese tablero; se borran con «Borrar pruebas» y desde Reclutamiento.

**Pendientes de la fase 1:**

- Cargar la regla del siguiente país cuando haya estudio en puerta (estructura lista en `nse.ts`/`paises.ts`).
- Captcha: fase 4, con el dominio.
- No hay condición «quedó en primer lugar» para `ordenar`; agregarla si un filtro la pide.

**Listo cuando:**

- las pruebas del motor pasan y la revisión de tipos no da errores en los archivos del feature;
- en local, un formulario de prueba que usa **todos los tipos nuevos** se contesta de punta a punta en tamaño celular;
- el panel, el Excel y el tablero muestran bien cada tipo;
- el ensayo existente sigue funcionando;
- Sergio da el OK para commit y push, con solo los archivos de Filtros.

## Decisiones pendientes (las toma Sergio)

| Decisión | Recomendación | Frena |
|---|---|---|
| Modelo de Word | Un screener hecho a mano por el equipo | Fase 4 |
| Dominio de Sharpli | `encuestas.sharpli.ai`; quién administra el DNS; agregarlo en Render | Fase 4 |
| Aviso de privacidad | Enlace discreto que nombra a Sapience y dice que los datos sirven para otros estudios (revisión legal) | Fase 4 |
| Cómo reconocer a la misma persona | Celular obligatorio y correo opcional; buscar por los dos | Fase 5 |
| Quién entra a la base | Todos los que aceptan el aviso y terminan; al tablero solo los que califican | Fase 5 |
| Países del NSE para arrancar | México ya está (AMAI 2022, confirmada); falta el siguiente con estudio en puerta | — |
| Columnas al tablero | Todas, con una vista de solo las clave | — |
| Imágenes de conceptos confidenciales | Caso por caso | — |
| Pagos, agendar citas y registros de otra base | Fuera hasta que se pidan | — |
| A quién se abre en la fase 6 | Primero a quien tiene Swipe | — |

## Bitácora

- **2026-10-21/22 · versión inicial:** formularios en Tools, página pública, motor, panel, Excel, vínculo con Reclutamiento (todas las columnas desde que se vincula) y el screener de ALONG 2 como plantilla. Se diseñó el feature completo (documento de diseño) y se escribió esta guía.
- **2026-10-22 · fase 1 (base del screener):** contrato versión 2 con todos los tipos de la fase 1, una o varias dicho por el tipo, país y NSE por país como alerta, revisión de definiciones, formulario en neutros, panel con NSE distinto y plantilla de prueba con todos los tipos. Con el cuestionario oficial que pasó Sergio se cargó la AMAI 2022 (cortes nuevos, redacción oficial) como regla vigente de México; 36 pruebas. Probado en local de punta a punta. Subido a `main` con el OK de Sergio (`3d5bbfd`).
