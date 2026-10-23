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

Commits en `main`: `890cb77`, `255381b`, `a91f52e` y `c8431ca` (21 y 22 de octubre de 2026); fase 1 en `3d5bbfd`. Fase 2 (editor) aprobada por Sergio el 2026-10-22.

**Base de datos** (fuera del pipeline de `generate.py`, como Swipe; los endpoints usan `pool.query`):

- `formularios`: `id`, `proyecto_id` (→ `projects.id`), `codigo` (va en el enlace `/f/:codigo`, al azar), `titulo` (interno), `plantilla`, `definicion jsonb` (el screener; el editor lo corrige), `estado` (`borrador` | `prueba` | `en_vivo` | `cerrado`; «en vivo» aún no se ofrece), `vinculo jsonb` (tablero de Reclutamiento), `created_by`, fechas.
  - Fase 2: `revision int` (sube con cada guardado del editor; con ella no se pisan cambios de otra persona) y `editando jsonb` (quién tiene abierto el editor: `{ sesion: { nombre, email, hasta } }`).
- `formulario_versiones` (fase 2): `formulario_id`, `revision`, `definicion jsonb`, `nota` (vacía = automática), `created_by`, `created_at`.
- `formulario_respuestas`: `respuestas jsonb`, `resultado jsonb` (lo calcula el servidor), `califica`, `es_prueba`, `nombre`, `telefono`, `device_token`, `duracion_seg`.
- Bucket **privado** `formularios` en Supabase Storage: fotos de participantes, carpeta por formulario; se ven con URL firmada.
- Script: `server/scripts/add-formularios-tables.ts`. Es aditivo e idempotente, y **ya se corrió en producción** (lo de la fase 2, el 2026-10-22 con el OK de Sergio). Si una fase necesita columnas nuevas, se agregan ahí con `alter table … add column if not exists`, y **se pide el OK de Sergio antes de correrlo**.

**Lógica compartida** (`src/lib/formularios/`, funciones puras que usan el navegador y el servidor):

- `tipos.ts`: **el contrato** (ver abajo), con la tabla `TIPOS` y `leerDefinicion` (lee versiones guardadas).
- `paises.ts` y `nse.ts` (fase 1): países con su asociación de NSE y su dirección; reglas de NSE como data.
- `revisar.ts` (fase 1): `revisarDefinicion`, que dice en palabras qué está mal armado en un screener. Fase 2: `revisarConLugar` dice además en qué pregunta o sección está cada problema (el editor lleva ahí), y revisa que la lógica no dependa de algo que va después y que las imágenes estén en una dirección pública.
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
- Fase 2 (editor):
  - `palabras.ts`: la lógica en palabras (`condicionEnPalabras`, `logicaDeOpcion`, `logicaDePregunta`, `logicaDeSeccion`, `frenteEnPalabras`, `alertaEnPalabras`). Cada línea dice su tipo (termina, descarta, frentes…) para su color, y deja corregir el motivo.
  - `flujo.ts`: `mapaFlujo`, un bloque por sección con lo que se repite, lo que aparece si aplica, dónde termina, qué descarta, qué frentes toca, alertas y NSE.
  - `duracion.ts`: `duracionEstimada` (típico y máximo, en minutos) contra `TOPE_MINUTOS = 10`; calibrada para que ALONG 2 dé 10.
  - `editar.ts`: los cambios a mano como funciones puras (texto, opciones, filas, preguntas, secciones, tipo, frentes, «mostrar solo si» simple), ids nuevos al azar (`idNuevo`), dónde se usa algo antes de quitarlo (`usosDePregunta`, `usosDeOpcion`, `usosDeSeccion`) y `diferencias` entre dos versiones.
- `plantillas/along2.ts`: screener de ALONG 2 (primer ensayo). `plantillas/pruebaTipos.ts` (fase 1): «Prueba · todos los tipos de pregunta». `plantillas/index.ts`: lista de plantillas.

**Servidor:**

- `src/serverUtils/formularios/`:
  - `acceso.ts`;
  - `storage.ts` (bucket privado);
  - `reclutamiento.ts`: vínculo con tablero, `asegurarColumnas` crea **todas** las columnas al vincular, `pasarAlReclutamiento` no duplica por tablero gracias a `source_form = «Formulario Hub · título|id»`, y `vinculoVigente` relee el nombre del tablero.
- Endpoints en `src/api/`:
  - de formularios: `getFormularios`, `createFormulario`, `getFormularioDetail`, `getFormularioRespuesta`, `setFormularioEstado`, `deleteFormulario`, `deleteFormularioRespuestas`, `exportFormularioRespuestas`;
  - públicos: `getFormularioPublico` y `submitFormularioRespuesta`;
  - de tableros: `getTablerosReclutamiento`, `vincularFormularioTablero`, `crearTableroParaFormulario`, `pasarFormularioAlReclutamiento`;
  - del editor (fase 2): `saveFormularioDefinicion` (revisa, no pisa otra revisión, guarda sola una versión automática), `getFormularioVersiones`, `getFormularioVersion`, `createFormularioVersion` y `pingFormularioEditor` (quién más lo tiene abierto).
- Las fotos se suben por `server/upload.ts`, en la rama `formularioCodigo`: solo imágenes, 20 MB, bucket privado.
- Las imágenes de las preguntas (fase 2) van al bucket público `zite-uploads`, carpeta `formularios-imagenes`, por la ruta normal de `server/upload.ts`. En local también se suben de verdad (excepción en `src/shims/zite-file-upload-sdk.ts`, como las fotos de participantes).

**Pantallas:**

- `src/pages/FormularioPublicoPage.tsx` (ruta pública `/f/:codigo` en `App.tsx`): carga el filtro, guarda el avance en el celular y envía. El formulario en sí es `src/components/formularios/Participante.tsx` (fase 2), el mismo que usa la vista Celular del editor. Cada tipo lo pinta `CampoPregunta.tsx`, que lo reparte a `src/components/formularios/campos/` (opciones, listas, imágenes y ordenar en `Opciones.tsx`; `Matriz`, `Escalas`, `Direccion`, `Foto`; colores en `estilo.ts`).
- `src/components/formularios/FormulariosPanel.tsx`: pestaña Tools → Formularios del proyecto (`ProjectToolsTab.tsx`). La lista de filtros y el filtro abierto van uno tras otro; el filtro abre en su Documento y tiene las pestañas Documento, Flujo, Celular y Respuestas.
- `src/components/formularios/PanelRespuestas.tsx`: la pestaña Respuestas (Reclutamiento, cuotas, respuestas con «Ver», detalle con fotos y Excel), en tarjetas en pantallas angostas.
- `src/components/formularios/editor/` (fase 2):
  - `useEditorFiltro.ts`: el estado (deshacer y rehacer, guardado solo, conflicto con otra ventana, aviso de quién más lo tiene abierto);
  - `EditorFiltro.tsx`: la barra (deshacer, guardado, minutos, versiones) y los avisos;
  - `Documento.tsx`, `PreguntaDoc.tsx`, `Opciones.tsx` y `Ajustes.tsx`: el documento editable;
  - `MapaFlujo.tsx`, `VistaCelular.tsx` y `Versiones.tsx`;
  - `TextoEditable.tsx`, `comun.tsx` e `imagenes.ts` (achicar y subir, con lo de Swipe).

**Pruebas:** `cd server && npx tsx scripts/test-formularios.ts` (50 pruebas: el motor, la revisión, las reglas de NSE, las columnas y el Excel; desde la fase 2, también la lógica en palabras, el mapa, la duración y los cambios del editor; datos inventados, no toca la base).

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
- **`revisarDefinicion`** (`revisar.ts`) rechaza lo ambiguo: «exclusiva» o máximo de opciones en una pregunta de una sola respuesta, opciones en un tipo que no las lleva, selector con imágenes sin imágenes, repetir por una pregunta que no es de varias, NSE que suma preguntas que no existen, lógica que apunta a preguntas que no existen. `createFormulario` no crea un filtro con problemas, y el editor (fase 2) no guarda mientras haya alguno: lo revisa en el navegador y otra vez `saveFormularioDefinicion`. Desde la fase 2 también rechaza la lógica que depende de algo que va después (mostrar si, de dónde salen las opciones, por qué se repite una sección) y las imágenes que no están en una dirección pública (`https://` o dibujadas en el screener con `data:image/`).
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
| 2 | Editor: documento en pantalla + mapa del flujo, edición a mano, imágenes, versiones; panel con «Ver» y pantallas angostas | **Hecha** (2026-10-22, aprobada por Sergio) |
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

### Fase 2 · Editor

Sale del documento de diseño («Lo primero que se ve y cómo se corrige» y la tabla de fases). Al terminarla se puede armar y corregir un filtro completo sin tocar código.

**Qué entra:**

- **Tres vistas del mismo screener.** Al abrir un filtro, lo primero que se ve es el Documento.
  - **Documento:** el screener de arriba abajo con la redacción final, como lo leerá el cliente en el Word.
    - Bajo cada opción que termina, descarta o deja fuera de un frente se lee la regla en palabras, como la escribiría una persona: «Si marca esta, termina el filtro: trabaja en publicidad».
    - También van en palabras: qué aparece según qué, qué se repite, de dónde salen las opciones, rangos, orden aleatorio, notas para el equipo, frentes con su cuota, alertas y regla de NSE.
    - En pantallas anchas lleva al lado el mapa del flujo en chico.
  - **Flujo:** el mapa de bloques a pantalla completa y en orden.
    - Muestra cuáles se repiten y por qué pregunta, cuáles aparecen solo si aplica, dónde puede terminar alguien, cuáles descartan un bloque, qué toca frentes o da alerta y dónde está el NSE.
    - Un clic en un bloque lleva a esa parte del documento.
  - **Celular:** el formulario tal cual lo contesta un participante, dentro de un marco de celular, con lo que está en pantalla aunque no se haya guardado.
    - No guarda respuestas: al terminar dice si esa prueba calificaría y por qué.
    - Las fotos se ven, pero no se suben.
- **Edición a mano en el Documento:**
  - un clic en cualquier texto lo vuelve editable: pregunta, ayuda, opción, título e intro de sección, bienvenida, despedida, mensaje de no califica, notas y motivos. **Esc** deshace y **Cmd+Enter** guarda (también al salir del cuadro), como en la guía de tópicos;
  - opciones: agregar, quitar, subir y bajar. También se marca si termina el filtro (con su motivo), si descarta el bloque (solo en secciones que se repiten), si es «Ninguno» (exclusiva), si pide «Otra, ¿cuál?» y si queda fija en orden aleatorio;
  - preguntas: agregar eligiendo el tipo, quitar, subir y bajar, cambiar de tipo, obligatoria u opcional, orden aleatorio, máximo de opciones, rango de números y escalas, filas de una matriz;
  - secciones: agregar, quitar, subir y bajar;
  - «mostrar solo si» en su forma simple («solo si en tal pregunta marcó tal o tal opción»), en preguntas y secciones;
  - frentes: nombre y cuota;
  - **imágenes:** se arrastran o se pegan sobre la opción o la pregunta, o se eligen con un clic. Se achican al subir y se publican solas en una carpeta pública, como en Swipe.
- **Reglas del guardado:**
  - cada cambio se guarda solo, después de pasar por `revisarDefinicion`. Mientras haya algo mal armado, se dice en palabras qué es y no se guarda hasta corregirlo;
  - los ids de preguntas y opciones nunca cambian, porque son la clave de su columna en el tablero. Lo nuevo lleva un id nuevo y estable;
  - lo guardado en versión 1 se lee con `leerDefinicion` y se guarda en versión 2.
- **Deshacer y rehacer**, con botones y con Cmd+Z / Cmd+Shift+Z.
- **Versiones guardadas:** una automática antes de cada tanda de cambios y las que se guardan a mano con un nombre. Se pueden ver y restaurar.
- **Aviso si otra persona tiene abierto el mismo filtro.** Si guardó cambios mientras tanto, se avisa en lugar de pisarlos.
- **Duración estimada**, que se actualiza con cada cambio, contra el tope de 10 minutos: lo típico y lo máximo, si alguien marca todo lo que abre bloques.
- **Panel:** botón «Ver» en cada respuesta y todo legible en pantallas angostas. La lista de respuestas y las cuotas pasan a tarjetas, y la lista de filtros y el filtro abierto van uno tras otro.
- **Base de datos:** una tabla de versiones y dos columnas en `formularios` (número de revisión y quién lo tiene abierto), agregadas en `server/scripts/add-formularios-tables.ts`. Se corre solo con el OK de Sergio.
- **Pruebas** de lo que es lógica pura: la lógica en palabras, el mapa, la duración, los ids nuevos y las operaciones del editor (cambiar de tipo, mover, quitar sin romper la lógica).

**Qué NO entra** (es de otras fases):

- el botón IA por pregunta y los comentarios a la IA por sección (fase 3);
- los supuestos con «Ya lo revisé» (fase 3, porque los escribe la IA);
- corregir a mano la lógica combinada: quién entra a cada frente y las condiciones con «y», «o» y «no». Se lee en palabras y se corrige con la IA en la fase 3;
- el Word (fase 4);
- la segunda tanda de tipos de pregunta (video, voz, fecha, tabla, moneda…), «en vivo» y la biblioteca.

**Listo cuando:**

- en local, con los filtros de prueba de «3 MAYO PRUEBA 3», el ensayo `o81xrb8` y `lv4los` se leen completos en Documento y en Flujo, y la lógica en palabras coincide con lo que hace el motor;
- se corrige a mano un filtro de prueba: textos, opciones, imágenes arrastradas y pegadas, tipo de pregunta y «mostrar solo si». Se deshace, se restaura una versión y el formulario público refleja el cambio;
- el aviso aparece con el filtro abierto en dos ventanas, y un cambio guardado en una no se pisa desde la otra;
- la vista Celular se contesta de punta a punta y dice si calificaría;
- el panel con «Ver» y las tres vistas se leen bien en una pantalla angosta y en tamaño celular;
- las 156 columnas del ensayo siguen idénticas;
- las pruebas pasan y la revisión de tipos no da errores en los archivos del feature;
- Sergio da el OK para commit y push, con solo los archivos de Filtros.

**Alcance aprobado por Sergio el 2026-10-22** tal como está arriba («Sí, así»), y su OK para agregar a la base la tabla de versiones y las dos columnas (se corrió el script ese día).

**Qué se construyó (2026-10-22):**

- **Panel:** la lista de filtros y el filtro abierto van uno tras otro, en vez de lado a lado, y así caben el documento y su mapa. El filtro abre en **Documento** y tiene las pestañas Documento, Flujo, Celular y Respuestas. Enlace, estado y borrar quedan arriba, en todas las pestañas.
- **Documento:** el screener como hoja, con la lógica en palabras y en colores del moodboard: rojo lo que termina, ámbar lo que descarta o da alerta, azul lo que deja fuera de frentes y verde los frentes.
  - Al final van «Al terminar» (despedida y mensaje de no califica), los frentes con su cuota y las alertas.
  - «{opcion}» se ve como una marca «opción».
  - En pantallas anchas (desde 1280 px) lleva a un lado el mapa en chico, con pills.
- **Flujo:** los bloques en orden.
  - Lo que aparece solo si aplica va corrido a la derecha con borde punteado, y lo que se repite lleva sombra.
  - Cada bloque lleva pills de qué hace: se repite, solo si aplica, puede terminar, descarta el bloque, fuera de frentes, toca frentes, alerta y NSE. Junto a cada pill va el detalle.
  - Cierra con «Al terminar» (frentes y cuotas). Un clic lleva al bloque en el documento y lo resalta.
- **Celular:** `Participante` dentro de un marco de celular, con lo que está en pantalla aunque no se haya guardado. No guarda nada y las fotos no se suben. Al terminar dice «Calificaría» o «No calificaría», con el frente, el motivo, el NSE y las alertas, calculados con el mismo motor del servidor.
- **A mano:**
  - todo texto se corrige con un clic: Esc deshace, Cmd+Enter o salir del cuadro guarda, y en títulos y opciones Enter también guarda. Lo recién agregado abre listo para escribir encima;
  - **opciones:** agregar (antes de «Ninguno» y «Otra»), quitar, subir y bajar. En su menú: termina el filtro (con el motivo «Marcó «…»», que se corrige ahí mismo), no cuenta este bloque, quita las demás, pide cuál, fija con orden aleatorio, y poner o quitar imagen;
  - **preguntas:** agregar eligiendo el tipo, subir y bajar, cambiar tipo, obligatoria, orden aleatorio, cuántas marca u ordena, rango y «termina si está fuera de», mostrar solo si, ayuda, nota, imagen arriba y quitar;
  - **secciones:** título, texto de entrada, mostrar solo si, subir, bajar y quitar;
  - **frentes:** nombre y cuota.
  - Antes de quitar algo que se usa en otra parte, se dice dónde («el frente Aerosoles / Pure», «abre su bloque…») y se pide confirmar. Una sección siempre pide confirmar.
  - Las preguntas del NSE (cuestionario oficial) se ven con candado y no se corrigen.
- **Imágenes:** se arrastran o se pegan sobre la opción o la pregunta (al pegar cuenta dónde está el cursor), o se eligen en el menú. Se achican a 1200 px de lado largo en JPEG; una chica de formato común, o un GIF, se sube tal cual. Van a la carpeta pública `formularios-imagenes`. Si la opción es de una pregunta que no muestra imágenes (opción única o múltiple, lista), la pregunta pasa sola al selector con imágenes y se avisa.
- **Guardado:** cada cambio se guarda solo a los ~0.7 s.
  - Mientras haya algo mal armado, la barra dice «Sin guardar: N cosas por corregir». Al abrirla se lee cada problema con el texto de la pregunta, un clic lleva ahí, y hay botón para deshacer.
  - Si se cierra la pestaña sin guardar, se pide confirmar.
- **Deshacer y rehacer:** botones y Cmd+Z / Cmd+Shift+Z, hasta 100 pasos; los cuadros de texto tienen el suyo.
- **Versiones:** una automática con cómo estaba antes de una tanda de cambios (si la última tiene más de 30 minutos) y las que se guardan a mano con un nombre. «Ver» compara con lo de ahora en palabras («Le falta 1 pregunta de hoy, 1 texto distinto…»). «Restaurar» la carga como un cambio más: se guarda sola y se puede deshacer.
- **Dos personas o dos ventanas:** cada ventana avisa cada 30 s que sigue abierta, y las otras lo ven («También lo tiene abierto…», o «También lo tienes abierto en otra ventana»). Recargar reusa la sesión de la pestaña, para no avisarse a sí misma. Si otra ventana guardó, lo de esta no se guarda y aparece «Cargar lo guardado»; lo propio queda en Deshacer.
- **Duración** en la barra, «≈ 10 min · hasta 16 · tope 10»: verde si todo cabe, ámbar si lo máximo se pasa y rojo si lo típico se pasa.
- **Reclutamiento:** al pasar gente se crean en el tablero todas las columnas que falten, no solo las contestadas. Así una pregunta agregada en el editor después de vincular también llega al tablero.

**Decisiones de la fase 2:**

- El formulario del participante salió de la página pública a `Participante.tsx` para que la vista Celular sea exactamente lo que se contesta. La página solo carga, guarda el avance y envía.
- Los ids nuevos son al azar (`p_k3x9q2`, `o_…`, `f_…`, `s_…`), nunca consecutivos. Así una pregunta nueva no reusa la clave de una que se quitó y sus respuestas no caen en la columna vieja del tablero.
- Una pregunta no se mueve a una sección que se repite distinto, porque cambiaría la clave de su columna (`id` contra `id@opción`).
- La versión automática guarda cómo estaba antes del cambio: así siempre se puede volver a como estaba al empezar a editar.
- «Cargar lo guardado» no mezcla cambios: carga lo de la otra persona y deja lo propio en Deshacer.
- En local, las imágenes de los filtros se suben de verdad, porque con el usuario simulado el Hub no subía nada y daba una dirección que solo existe en ese navegador. La revisión ya no deja guardar una imagen así.
- El ensayo `o81xrb8` no se editó: sigue en versión 1. Al primer guardado desde el editor quedará en versión 2, con las mismas claves.

**Probado en local (2026-10-22):**

- El ensayo `o81xrb8` y `lv4los` se leen completos en Documento y en Flujo, en ancho (1440), angosto (800) y celular (375).
- En `lv4los` (`3 MAYO PRUEBA 3`):
  - textos, opción nueva con «termina el filtro», motivo corregido (Esc deshace, Cmd+Enter guarda), pregunta nueva de varios tipos, «mostrar solo si», quitar preguntas, cambio de tipo que deja algo por corregir y se deshace;
  - imagen soltada sobre una opción (subida y achicada a 1200 px), imagen pegada sobre una pregunta, y una opción única que pasó sola a selector con imágenes;
  - versión con nombre, comparación y restaurar con Cmd+Z;
  - dos ventanas: aviso y «Cargar lo guardado».
- El enlace público trae los cambios con el id nuevo y sin el motivo.
- En Celular se contestó de punta a punta: una vuelta termina («No hace compras para su casa») y otra califica («Prefiere lata», NSE C+). No se guardó ninguna respuesta.
- Respuestas: tarjetas y «Ver» en celular; al pasar a mano una respuesta, el tablero recibió la columna de la pregunta nueva.
- El ensayo conserva sus 156 columnas, y `lv4los` las 44 de su tablero más la nueva.
- **Quedan en la base:** `lv4los` con esos cambios (revisión 25, dos versiones, imágenes de prueba en `formularios-imagenes`) y una segunda fila en su tablero («Persona Prueba Dos»).

**Pendientes de la fase 2:**

- Si se cambia el texto de una pregunta que ya tiene columna en el tablero, la columna conserva su nombre: el tablero se ubica por la clave, no por el nombre. Falta decidir si se renombra sola.
- Quitar una pregunta deja su columna en el tablero, vacía en adelante.
- Al cerrar una ventana de golpe, las otras la ven abierta hasta un minuto y medio. El aviso de salida no alcanza a mandarse con la sesión.
- Las imágenes que se reemplazan o se quitan se quedan en la carpeta pública. Falta limpiarlas cuando se borra un filtro.
- La lógica combinada (frentes, condiciones con «y», «o» y «no») se lee en palabras; corregirla es de la fase 3.
- Con filtros **en vivo** (fase 5), editar algo que ya tiene respuestas reales merecerá un aviso antes de guardar.

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
- **2026-10-22 · fase 2 (editor):** el filtro abre como documento, con la lógica en palabras y el mapa del flujo al lado, y tiene la vista Celular para contestarlo sin guardar. Se corrige a mano: textos, opciones, imágenes arrastradas o pegadas (a una carpeta pública y achicadas), tipos, «mostrar solo si», qué termina o descarta, y nombre y cuota de los frentes. Tiene deshacer, versiones, aviso de otra ventana o persona sin pisar cambios, y los minutos contra el tope de 10. El panel quedó con «Ver» y en tarjetas en pantallas angostas. En la base, la tabla `formulario_versiones` y las columnas `revision` y `editando` (con el OK de Sergio). 50 pruebas. Probado en local y subido a `main` con el OK de Sergio.
