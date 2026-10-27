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

Commits en `main`: `890cb77`, `255381b`, `a91f52e` y `c8431ca` (21 y 22 de octubre de 2026); fase 1 en `3d5bbfd`; fase 2 (editor) en `40d801f`; fase 3 (generador con IA) en `f450a2f`.

**Base de datos** (fuera del pipeline de `generate.py`, como Swipe; los endpoints usan `pool.query`):

- `formularios`: `id`, `proyecto_id` (→ `projects.id`), `codigo` (va en el enlace `/f/:codigo`, al azar), `titulo` (interno), `plantilla`, `definicion jsonb` (el screener; el editor lo corrige), `estado` (`borrador` | `prueba` | `en_vivo` | `cerrado`; «en vivo» desde el 2026-10-24), `vinculo jsonb` (tablero de Reclutamiento), `created_by`, fechas.
  - Fase 2: `revision int` (sube con cada guardado del editor; con ella no se pisan cambios de otra persona) y `editando jsonb` (quién tiene abierto el editor: `{ sesion: { nombre, email, hasta } }`).
- `formulario_versiones` (fase 2): `formulario_id`, `revision`, `definicion jsonb`, `nota` (vacía = automática), `created_by`, `created_at`.
- `formularios.cambios jsonb` (2026-10-24): la copia de trabajo de un filtro en vivo; los participantes contestan `definicion` hasta que se publica.
- `formulario_respuestas`: `respuestas jsonb`, `resultado jsonb` (lo calcula el servidor), `califica`, `es_prueba`, `nombre`, `telefono`, `device_token`, `duracion_seg`.
- Bucket **privado** `formularios` en Supabase Storage: fotos de participantes, carpeta por formulario; se ven con URL firmada.
- Fase 3: `formularios.generador jsonb` (insumos, estructura, secciones escritas por la IA, cuáles ya están puestas y supuestos; forma en `src/lib/formularios/generador.ts`; null en los filtros hechos de plantilla) y la tabla `formulario_ia_uso` (una fila por llamada a la IA: quién, filtro, para qué, modelo, tokens y si salió bien; con ella se aplica el tope por hora). Los PDF de los insumos van al bucket privado `formularios`, carpeta `insumos/<id del filtro>/`, y se borran con el filtro.
- Script: `server/scripts/add-formularios-tables.ts`. Es aditivo e idempotente, y **ya se corrió en producción** (lo de la fase 2 y lo de la fase 3, el 2026-10-22 con el OK de Sergio). Si una fase necesita columnas nuevas, se agregan ahí con `alter table … add column if not exists`, y **se pide el OK de Sergio antes de correrlo**.

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
- Fase 3 (generador con IA):
  - `generador.ts`: lo que guarda el generador, la estructura de la etapa 1 (`Estructura`, `SeccionPlan`, `PreguntaPlan`), sacarla de un filtro ya escrito (`estructuraDeDefinicion`), compararlas para conservar lo que no cambió (`firmaSeccion`, `compararEstructuras`, `conservarSinCambio`), ids definitivos para lo que propone la IA (`asentarEstructura`), revisarla (`revisarEstructura`), sus minutos con el mismo cálculo del editor (`minutosDeEstructura`), la sección del NSE (`seccionNse`) y poner las secciones en su lugar (`ponerSeccion`, `prepararParaEscribir`, `avanceEscritura`).
  - `ia.ts`: lo que propone la IA antes de aplicarlo: ids definitivos sin tocar los que ya existen (`asentarIds`, `conocidosDe`), el cambio como parche (`aplicarParche`), el NSE intocable (`protegerNse`), qué cambia en palabras con nombres (`cambiosEnPalabras`) y qué lógica rompe (`avisosDeLogica`, `columnasQueCambian`).
- `plantillas/along2.ts`: screener de ALONG 2 (primer ensayo). `plantillas/pruebaTipos.ts` (fase 1): «Prueba · todos los tipos de pregunta». `plantillas/index.ts`: lista de plantillas.

**Servidor:**

- `src/serverUtils/formularios/`:
  - `acceso.ts`;
  - `storage.ts` (bucket privado);
  - `reclutamiento.ts`: vínculo con tablero, `asegurarColumnas` crea **todas** las columnas al vincular, `pasarAlReclutamiento` no duplica por tablero gracias a `source_form = «Formulario Hub · título|id»`, y `vinculoVigente` relee el nombre del tablero.
  - Fase 3 (generador con IA):
    - `skill/`: **las reglas en un solo lugar**, como Propuestas y la guía de tópicos. `SKILL.md`, `references/` (`reglas.md` con las de Sergio, `redaccion.md`, `contrato.md` con el JSON del filtro para la IA y `estructura.md`) y `assets/ejemplos/` (ALONG 2 en Word y en JSON, DOPAMINA y LORO, sin marcas). Es el prompt del sistema de todas las llamadas.
    - `claude.ts`: un modelo por etapa (`MODELOS`), prompt del sistema con caché, respuesta validada con zod y un reintento con lo que encontró la revisión, error claro si se corta o si la IA se niega, respaldo automático de modelo si un filtro de seguridad se equivoca, y `conLatido`.
    - `prompts.ts` (funciones puras: lo que se pide en cada llamada), `esquemas.ts` (zod de lo que devuelve), `insumos.ts` (leer Word y PowerPoint, guardar el PDF, reuniones de Notetaker, los insumos como contenido para la IA con caché), `uso.ts` (tope por persona y por hora con `formulario_ia_uso`) y `generar.ts` (cada paso: valida con la revisión del editor, pone ids definitivos y guarda en el generador).
- Endpoints en `src/api/`:
  - de formularios: `getFormularios`, `createFormulario`, `getFormularioDetail`, `getFormularioRespuesta`, `setFormularioEstado`, `deleteFormulario`, `deleteFormularioRespuestas`, `exportFormularioRespuestas`;
  - públicos: `getFormularioPublico` y `submitFormularioRespuesta`;
  - de tableros: `getTablerosReclutamiento`, `vincularFormularioTablero`, `crearTableroParaFormulario`, `pasarFormularioAlReclutamiento`;
  - del editor (fase 2): `saveFormularioDefinicion` (revisa, no pisa otra revisión, guarda sola una versión automática), `getFormularioVersiones`, `getFormularioVersion`, `createFormularioVersion` y `pingFormularioEditor` (quién más lo tiene abierto).
  - del generador (fase 3): `saveFormularioInsumos`, `getFormularioReuniones`, `saveFormularioGenerador` (aprobar la estructura, frentes a mano, supuestos revisados, usar tal cual, descartar) y, con avance (`streaming`), `generateFormularioEstructura`, `generateFormularioSeccion`, `generateFormularioLogica` y `generateFormularioCambio`. `createFormulario` recibe el punto de partida (`origen`); `saveFormularioDefinicion` marca en la misma transacción las secciones del generador que ese guardado deja puestas; `getFormularioDetail` trae el generador y el uso de IA de la hora; `deleteFormulario` borra también los PDF de los insumos.
- Las fotos se suben por `server/upload.ts`, en la rama `formularioCodigo`: solo imágenes, 20 MB, bucket privado.
- Las imágenes de las preguntas (fase 2) van al bucket público `zite-uploads`, carpeta `formularios-imagenes`, por la ruta normal de `server/upload.ts`. En local también se suben de verdad (excepción en `src/shims/zite-file-upload-sdk.ts`, como las fotos de participantes).

**Pantallas:**

- `src/pages/FormularioPublicoPage.tsx` (ruta pública `/f/:codigo` en `App.tsx`): carga el filtro, guarda el avance en el celular y envía. El formulario en sí es `src/components/formularios/Participante.tsx` (fase 2), el mismo que usa la vista Celular del editor. Cada tipo lo pinta `CampoPregunta.tsx`, que lo reparte a `src/components/formularios/campos/` (opciones, listas, imágenes y ordenar en `Opciones.tsx`; `Matriz`, `Escalas`, `Direccion`, `Foto`; colores en `estilo.ts`).
- `src/components/formularios/FormulariosPanel.tsx`: pestaña **Filtros** del proyecto, junto a Reclutamiento (`ProjectHubPage.tsx`; hasta la fase 5 vivía en Tools). La lista de filtros y el filtro abierto van uno tras otro; el filtro abre en su Documento y tiene los modos Diseñar y Reclutar.
- `src/components/formularios/PanelRespuestas.tsx`: la pestaña Respuestas (Reclutamiento, cuotas, respuestas con «Ver», detalle con fotos y Excel), en tarjetas en pantallas angostas.
- `src/components/formularios/editor/` (fase 2):
  - `useEditorFiltro.ts`: el estado (deshacer y rehacer, guardado solo, conflicto con otra ventana, aviso de quién más lo tiene abierto);
  - `EditorFiltro.tsx`: la barra (deshacer, guardado, minutos, versiones) y los avisos;
  - `Documento.tsx`, `PreguntaDoc.tsx`, `Opciones.tsx` y `Ajustes.tsx`: el documento editable;
  - `MapaFlujo.tsx`, `VistaCelular.tsx` y `Versiones.tsx`;
  - `TextoEditable.tsx`, `comun.tsx` e `imagenes.ts` (achicar y subir, con lo de Swipe).
- `src/components/formularios/generador/` (fase 3):
  - `useGenerador.ts`: el estado del generador; escribe las secciones de tres en tres y pone cada una en el documento con `editor.aplicar` en cuanto llega; al reabrir un filtro a medias, sigue.
  - `GeneradorFiltro.tsx`, `Insumos.tsx` y `Estructura.tsx`: los pasos Insumos y Estructura;
  - `AvanceEscritura.tsx` y `Supuestos.tsx`: sobre el documento;
  - `PropuestaIA.tsx`: el botón IA de cada pregunta y Comentar de cada sección y de los frentes;
  - `comun.tsx`: botón teal, avance de la IA, uso de la hora.

**Pruebas:** `cd server && npx tsx scripts/test-formularios.ts` (el motor, la revisión, las reglas de NSE, las columnas y el Excel; desde la fase 2, también la lógica en palabras, el mapa, la duración y los cambios del editor; desde la fase 3, la estructura, los ids de lo que propone la IA, los parches, los cambios en palabras, lo que se le pide y la validación de lo que devuelve; datos inventados, no toca la base ni llama a la IA).

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
    - `termina`: no califica (se registra el motivo y sigue contestando; desde la fase 5 solo **corta** el filtro con `cortar: true`, igual en `terminaFuera`, `terminaSi` y `reglasMatriz`);
    - `descarta`: solo esa repetición;
    - `excluyeGrupos`: fuera de los frentes de ese grupo;
    - `exclusiva`: tipo «Ninguno»;
    - `otra` y `fija`.
  - En la pregunta: `terminaFuera` (número fuera de rango) y `terminaSi`.
- **Nombre corto** (`pregunta.nombre`, 2026-10-23): «Edad», «Marcas que compra». Es el encabezado de su columna en el tablero, el Excel y el panel; el participante no lo ve (`definicionPublica` lo quita). Sin él, la columna lleva el texto de la pregunta (`nombreDePregunta` en `tabla.ts`); las del NSE traen el suyo (`NOMBRES_NSE`).
- **Perfiles y cuotas:** `frentes[] = { id, nombre, grupo, meta, califica: Condicion }`. En pantalla, en los textos y en lo que escribe la IA se llaman **perfiles**; la clave del JSON sigue siendo `frentes` para no tocar lo guardado. **Alertas:** `alertas[]`.
- **NSE: alerta, nunca descarte.** `nse = { regla, porConfirmar, puntos, cortes }` es una **copia** de la regla del país (`reglaNse(pais)` y sus preguntas estándar `preguntasNse(pais)` en `nse.ts`). En un frente, lo que pide de NSE no saca a nadie: la persona entra al frente y, si su NSE no es el que pide el camino por el que entró, sale la alerta «NSE C, el perfil Aerosoles / Pure pide C+» y el frente queda en `resultado.nse.fueraDe`. El panel lo marca en la lista y lo cuenta en las cuotas («Con NSE distinto»). Si un filtro trae una regla que ya no es la vigente del país (`reglaVigente`), el panel lo dice («AMAI 2018 (la vigente es AMAI 2022)»); el filtro no se toca.
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
- **Toda subida de archivos acepta arrastrar y soltar**, además del clic: recuadro punteado que se resalta al arrastrar, y lo que no se acepta se rechaza con aviso (Sergio, 2026-10-22). Así están los insumos del generador, las imágenes del editor y la foto del participante.
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
| 2 | Editor: documento en pantalla + mapa del flujo, edición a mano, imágenes, versiones; panel con «Ver» y pantallas angostas | **Hecha** (`40d801f`, 2026-10-22) |
| 3 | Generador con IA: insumos, estructura con supuestos, preguntas, comentarios a la IA, tope de uso | **Hecha** (`f450a2f`, 2026-10-22) |
| 4 | Salidas: Word/PDF humano, formulario neutro en dominio Sharpli, captcha, aviso de privacidad, fotos y videos | **En curso:** aviso (`301e804`), Word/PDF (`9b8e584`) y formulario neutro en sharpli.mx (`99571cd`) hechos; faltan captcha, fotos y videos |
| 5 | Operación: en vivo, nadie se corta por defecto, paso solo al tablero, historial y duplicados, traer respuestas de un filtro anterior, clasificación con IA, pestaña propia | **Hecha** («En vivo» `90cadec`; lo demás `0bd0d7d`, 2026-10-24) |
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

### Fase 3 · Generador con IA

Sale del documento de diseño («Cómo se arma un screener», «Lo primero que se ve y cómo se corrige» y la tabla de fases). Al terminarla se pasa del kick-off a un filtro listo para revisar en minutos, y se corrige pidiéndole cambios a la IA además de a mano.

**Qué entra:**

- **Tres puntos de partida** al crear un filtro, junto a «Desde una plantilla», que sigue igual:
  - **Tengo insumos:** notas pegadas, la propuesta (PDF o PowerPoint; también Word) y la transcripción del kick-off, que se elige de las reuniones de Notetaker del proyecto o de su deal. Se puede usar uno solo o varios.
  - **Tengo un screener:** se sube un Word (o un PDF) que ya existe y se vuelve un filtro editable con su misma redacción. Lo que la IA tuvo que interpretar va en los supuestos; por ejemplo, una pregunta de una sola respuesta que en el Word venía con casillas por la costumbre de Fillout.
  - **Parto de un filtro anterior:** se elige uno de los filtros ya hechos, de cualquier proyecto, y se dice qué cambia. Lo que no cambia se copia tal cual. La biblioteca con búsqueda es de la fase 6; aquí es una lista.
- **Etapa 1 · Estructura**, para revisarla rápido antes de que se escriban las preguntas:
  - país, perfil que se busca y frentes con su cuota, con quién entra a cada uno en palabras;
  - las secciones en orden de embudo, de lo general a lo particular. De cada una se lee lo que pregunta (una línea por pregunta), si se repite por algo y si aparece solo en ciertos casos;
  - los minutos estimados contra el tope de 10, con el mismo cálculo de la barra del editor;
  - los **supuestos**: lo que la IA tuvo que decidir y de dónde lo sacó («tomé la edad de 25 a 55 de la lámina de target»), y las reglas de la guía que no aplican a este estudio.
  - Se corrige con un comentario a la IA («quita la sección de marcas», «el frente B es de 8») o se vuelve a proponer. El nombre y la cuota de los frentes también se cambian a mano.
- **Etapa 2 · Preguntas:** con la estructura aprobada, la IA escribe sección por sección, con sus opciones y su lógica, y cada sección aparece en el Documento en cuanto está lista.
  - Al final arma quién entra a cada frente y las alertas, y lo revisa todo con la misma revisión del editor. Si algo quedó mal armado, lo corrige una vez antes de entregarlo.
  - Las preguntas de NSE no las escribe la IA: entran del cuestionario oficial del país, como hoy.
  - Si después se cambia la estructura, se conservan las secciones que no cambiaron. En las que cambiaron se respeta lo ya escrito de las preguntas que siguen.
  - Si se cierra la ventana a medias, lo ya escrito no se pierde y se puede seguir.
- **Reglas en un solo lugar:** una skill, como la de Propuestas y la de las guías de tópicos. Lleva las reglas de Sergio para diseñar screeners, cómo se le escribe al participante y 2 o 3 screeners reales del equipo como ejemplo, anonimizados (sin marcas de clientes ni datos de personas). Si una regla no aplica al estudio, la IA lo dice en los supuestos.
- **Supuestos al inicio del Documento**, en un recuadro con «Ya lo revisé». Si la IA vuelve a decidir algo (otra estructura, una sección reescrita), el recuadro se abre otra vez con lo nuevo.
- **Botón IA en cada pregunta:** pides el cambio con tus palabras («agrega Costco y quita Farmacia», «que termine si contesta Nunca») y la IA muestra su propuesta antes de aplicarla:
  - la pregunta como quedaría;
  - qué agrega y qué quita;
  - si rompe la lógica de otra pregunta o de un frente.
  - «Aplicar» la deja como un cambio más, que se deshace con Cmd+Z. «Descartar» no toca nada.
- **Comentar una sección para la lógica:** el orden, qué aparece según qué, los descartes, las cuotas y quién entra a cada frente (también en «Frentes y cuotas»). Así se cierra el pendiente de la fase 2: la lógica con «y», «o» y «no» se corrige con la IA. La propuesta se ve antes de aplicarla, igual que en una pregunta.
- **Lo que aplica la IA sigue las reglas del editor:** pasa por deshacer y por la misma revisión, nunca cambia el id de una pregunta u opción que ya existe (es la clave de su columna en el tablero), lo nuevo lleva un id nuevo y las preguntas del NSE no las toca.
- **Tope de uso de IA** por persona y por hora: 60 llamadas, ajustable. Un filtro completo son unas 12. Al llegar al tope se dice en cuánto tiempo se puede volver a usar.
- **Base de datos**, con el OK de Sergio y en `server/scripts/add-formularios-tables.ts`:
  - una columna en `formularios` para lo del generador: insumos, estructura y supuestos;
  - una tabla con cada uso de la IA (quién, cuándo, para qué y cuánto gastó), que sirve para el tope y para saber cuánto cuesta un filtro.
  - Los PDF que se suben van a la carpeta privada `formularios`.
- **Pruebas** de lo que es lógica pura: lo que se le manda a la IA, la validación de lo que devuelve (ids que se conservan, ids nuevos, nada en las preguntas de NSE), conservar lo escrito al cambiar la estructura, los minutos de la estructura y los cambios en palabras. Con la IA se prueba la validación y el armado de lo que se le pide, no sus respuestas.

**Qué NO entra** (es de otras fases o queda para después):

- el Word y el PDF para el cliente (fase 4);
- la biblioteca con búsqueda y relanzar a otro proyecto (fase 6);
- imágenes: la IA no las genera ni las saca de la propuesta. Si propone un selector con imágenes, se ponen a mano como hoy;
- comentarios que se quedan guardados como conversación: el comentario va a la IA, se ve la propuesta y se aplica o se descarta;
- reuniones que no están en Notetaker, y audios o videos: su transcripción se pega como notas;
- abrirlo al equipo: sigue solo para Sergio.

**Listo cuando:**

- en local, en «3 MAYO PRUEBA 3», se genera un filtro de punta a punta desde insumos de prueba (notas, un PDF y una transcripción): estructura con supuestos y minutos, preguntas sección por sección, frentes y alertas, sin nada por corregir;
- el Word de ALONG 2 se vuelve un filtro editable que se lee como el Word;
- se parte de `lv4los` pidiendo un cambio y lo que no cambia queda idéntico;
- al cambiar la estructura de un filtro ya escrito, las secciones que no cambiaron quedan igual;
- el botón IA y los comentarios de sección muestran su propuesta, se aplican y se deshacen, y nunca cambian el id de lo que ya existía: el tablero de `lv4los` conserva sus columnas;
- el tope de uso frena y avisa;
- todo se lee bien en una pantalla angosta;
- las pruebas pasan y la revisión de tipos no da errores en los archivos del feature;
- Sergio da el OK para commit y push, con solo los archivos de Filtros.

**Alcance aprobado por Sergio el 2026-10-22** tal como está arriba, con ALONG 2 (v4), DOPAMINA (filtro de reclutamiento V1) y LORO (filtro de reclutamiento) como ejemplos, y su OK para agregar a la base la columna del generador y la tabla de uso de la IA.

**Qué se construyó (2026-10-22):**

- **Nuevo filtro** con cuatro puntos de partida: con IA desde los insumos, con IA desde un screener en Word, desde un filtro anterior (de cualquier proyecto) y desde una plantilla. Con la IA el filtro abre en el generador, con los pasos Insumos, Estructura y Preguntas arriba.
- **Insumos:** notas, archivos (el PDF va a la carpeta privada y la IA lo lee completo; del Word y del PowerPoint se guarda el texto, con las tablas en renglones) y las reuniones de Notetaker con transcripción del proyecto o de su deal, con casillas. En «desde un filtro anterior» es una copia: se dice qué cambia y «Adaptar con la IA», o «Usarlo tal cual».
- **Estructura:** país y regla de NSE, título que ve el participante, perfil, frentes con su cuota (nombre y cuota se corrigen ahí mismo) y quién entra en palabras, y las secciones en orden con sus preguntas en una línea, lo que aparece solo si aplica, lo que se repite y los minutos de cada una y del total contra el tope de 10. Abajo, los supuestos con «Ya lo revisé» y lo que la estructura tenga mal armado (no se aprueba hasta corregirlo). Se corrige con un comentario («¿Qué le cambiarías?») o se vuelve a proponer.
- **Preguntas:** al aprobar, la IA escribe de tres en tres secciones; cada una aparece en el documento en cuanto llega y las que faltan se ven como un hueco con «La IA está escribiendo esta sección…». Arriba, una barra con cada sección y su estado, «Reintentar lo que falta» si alguna falla, y lo que la IA haya dejado por corregir. Al final arma quién entra a cada frente, las alertas, las claves del panel y los textos de bienvenida y despedida. La sección del NSE la pone el Hub con el cuestionario oficial, sin la IA.
- **Botón «Estructura»** en la barra del editor, también en filtros hechos a mano o de plantilla: muestra la estructura de lo escrito y se cambia con un comentario. La propuesta dice qué secciones cambian, cuáles son nuevas y cuáles salen; al aprobarla solo se reescribe lo que cambia, y lo demás (incluidos los frentes, las alertas y los textos) se queda igual. También se puede descartar.
- **Botón IA** (chispa dorada) en cada pregunta, menos las del NSE: se pide el cambio con palabras y se ve la propuesta antes de aplicarla: la explicación, qué agrega, qué quita y qué cambia con nombres, si toca la lógica de otra parte, lo que quedaría mal armado y la pregunta como quedaría. «Aplicar» es un cambio más (⌘Z lo deshace); «Pedir otra cosa» y «Descartar».
- **Comentar** en cada sección (menos la del NSE) y en «Frentes y cuotas», para la lógica: orden, qué aparece según qué, descartes, cuotas y quién entra a cada frente. La propuesta se ve igual que en una pregunta.
- **Supuestos** arriba del documento, con de qué sección salen y «Ya lo revisé» (se pliega en una línea y se vuelve a abrir si la IA decide algo nuevo).
- **Tope de uso:** 60 llamadas por persona y por hora (`FORMULARIOS_IA_LIMITE_HORA`), con «IA: 12 de 60 esta hora» junto a los botones. Al llegar al tope: «Llegaste al tope de uso de la IA (60 por hora). Se libera otra en 36 minutos.».
- **Base:** la columna `formularios.generador` y la tabla `formulario_ia_uso` (corrido en producción con el OK de Sergio).
- 63 pruebas (13 nuevas).

**Decisiones de la fase 3:**

- **Modelos:** la estructura con `claude-opus-5-5` (esfuerzo alto), las secciones con `claude-opus-5-5` (medio), la lógica final con `claude-opus-5-5` (alto), los comentarios de sección con `claude-opus-5-5` (medio) y el botón IA de una pregunta con `claude-sonnet-5-5` (medio), que es más rápido. Se cambian con `FORMULARIOS_MODELO_ESTRUCTURA`, `FORMULARIOS_MODELO_PREGUNTAS` y `FORMULARIOS_MODELO_CAMBIOS`.
- **Respaldo automático:** si un filtro de seguridad de la IA rechaza algo por error, la API reintenta sola con otro modelo (`fallbacks: 'default'`). Si aun así se niega, se dice en palabras.
- **Lo que pide la IA y lo que se le pide:** el prompt del sistema es la skill completa (unos 24 mil tokens) con caché; los insumos van con caché también, así que las secciones de una misma generación los leen casi gratis. La respuesta se valida con zod y con la misma revisión del editor; si algo queda mal, se le dice qué y se reintenta una vez. Si sigue mal, se entrega igual y se dice qué corregir.
- **Ids:** la IA trabaja con los ids que se le dan; todo lo que agrega recibe un id de `idNuevo` aunque ella le haya puesto otro, y sus referencias cambian con él. Una opción nueva nunca reusa el id de una que se quitó. Lo comprobó la propia IA en una prueba: al cambiar «¿Tienes mascota?» por «¿Tienes auto propio?» dejó ids nuevos para que no cayeran en la columna de la mascota.
- **La estructura ya trae las opciones con sus ids**, así cada sección se puede escribir aparte (de tres en tres) sin romper lo que otras usan de ella. Mientras se escribe, una sección puede usar otra que todavía no llega: el editor no guarda hasta que todo cuadra y lo dice («Se guarda en cuanto la IA termine»).
- **Nada se pierde si se cierra la ventana:** el servidor guarda lo que la IA escribió y el guardado del editor marca, en la misma transacción, qué secciones ya quedaron puestas. Al volver a abrir se pone lo que faltaba y se sigue.
- **Al ajustar, la IA marca qué secciones no tocó** (`cambia: false`) y esas se quedan exactamente como estaban; los supuestos nuevos se suman a los de antes.
- **La lógica final de un filtro ajustado** no toca la bienvenida ni la despedida, y una alerta o un frente con la misma condición conserva su texto.
- La IA no usa selectores con imágenes (las imágenes se ponen a mano) ni escribe preguntas del NSE; en sus explicaciones nombra las preguntas por su texto, no por su id.
- «Comentar» no guarda conversación: el comentario va a la IA, se ve la propuesta y se aplica o se descarta (así quedó en el alcance).
- **Errores de la cuenta de la IA en palabras** (`errorDeLaIA` en `claude.ts`): sin saldo, llave inválida, demasiadas peticiones, IA saturada o sin conexión se dicen tal cual y aclaran que el filtro no tiene nada mal, en vez de «Error interno». Una llamada que falla sin llegar a la IA no cuenta para el tope. Si una sección falla, no se piden las que faltan (la causa suele ser la misma): quedan para «Reintentar lo que falta». Salió del primer uso en producción (2026-10-22): la cuenta de Anthropic se quedó sin saldo después de la estructura, las 11 secciones rebotaron como «Error interno» y los reintentos llenaron el tope.
- Costo medido en las pruebas (`formulario_ia_uso`): un filtro completo de 8 secciones sale en alrededor de 1.10 dólares (estructura ~0.50, secciones ~0.50, lógica ~0.10); un cambio con el botón IA o un comentario, de 5 a 20 centavos de dólar.

**Probado en local (2026-10-22):**

- **Desde insumos** («Prueba fase 3 · café frío con IA», código `rmbdmkg`): notas, una propuesta en PDF y un PowerPoint inventados, y una reunión de Notetaker de prueba con transcripción. La estructura salió en unos 2 minutos: 2 frentes de 8, 8 secciones en embudo, ≈ 6 min, marca trampa, foto, NSE oficial y 18 supuestos con su fuente. Un comentario a la propuesta («quita la pregunta de horarios») quitó solo esa pregunta y conservó todos los ids. Al aprobarla se escribieron las 7 secciones y la lógica: guardado, sin nada por corregir. Contestado con un script con el mismo motor: quien compra más Marca Prueba entra a su frente; uno de la competencia con NSE C- entra al suyo con alerta de NSE.
- **Botón IA** en «¿Dónde compras…?» («agrega Costco y quita farmacia»): la IA explicó que Costco ya estaba y solo quitó Farmacia; se aplicó, se guardó y ⌘Z lo deshizo.
- **Comentar:** en «Frentes y cuotas» agregó al frente de la competencia «no marcó Marca Prueba entre las marcas que compra»; en «Si te seleccionamos» reordenó dos preguntas y dejó que una solo salga si aceptó todas las condiciones. Las dos se aplicaron y se guardaron con los mismos ids.
- **Cambiar la estructura de lo escrito:** agregar una pregunta de presentación en «Tu café frío» reescribió solo esa sección; las otras 7, los frentes y las opciones de las preguntas que siguen quedaron idénticos. Agregar una sección nueva y **recargar la página a media escritura**: al volver se puso lo que el servidor ya tenía escrito, sin pedirlo otra vez a la IA, y terminó la lógica.
- **Desde el Word de ALONG 2** («Prueba fase 3 · ALONG 2 desde Word», `lsyzh34`): la estructura y el filtro escrito quedaron iguales a la plantilla hecha a mano: las mismas 12 secciones, las mismas preguntas y tipos, los 7 frentes con las mismas cuotas (40), ≈ 10 min · hasta 16, sin nada por corregir.
- **Desde un filtro anterior** (copia de `lv4los`, «Prueba fase 3 · desde lv4los»): se pidió cambiar las preguntas de mascota por unas de auto; solo cambió «En tu casa». Un segundo ajuste («quita la pregunta de comentarios») dejó idénticos los textos, los frentes y las alertas de antes.
- **`lv4los`** con el botón IA («agrega Costco y que Otra pida cuál»): mismas preguntas e ids, la opción nueva con id nuevo, el tablero con sus 45 columnas, y el enlace público ya trae «Costco».
- **Tope de uso:** con la hora llena (registros de prueba, ya borrados) el botón IA avisa en cuánto se libera otra.
- **Subir archivo** desde la pantalla y **borrar el filtro**: el PDF se fue de la carpeta privada con él.
- Ancho (1280–1440), angosto (800) y celular (375): diálogo «Nuevo», estructura, documento con supuestos, botón IA y su propuesta, sin desplazamiento a lo ancho. Sin errores en la consola en una carga limpia.
- **Quedan en la base** (proyecto «3 MAYO PRUEBA 3»): los filtros `rmbdmkg` (café), `lsyzh34` (ALONG 2 desde Word, con marcas reales como el ensayo) y «Prueba fase 3 · desde lv4los», el PDF de prueba en `insumos/` de la carpeta privada, `lv4los` con «Costco» y «Otra, ¿cuál?» en «¿En qué tipo de tienda…?» (revisión 26) y los registros de uso de la IA de estas pruebas. La reunión de Notetaker de prueba ya se borró.

**Pendientes de la fase 3:**

- Una regla como «al menos 3 de estas 6» o «marcó X en tal fila de la matriz» no tiene forma directa en el contrato: la IA la resuelve con «alguna» de combinaciones, con alerta y nota, o lo dice en los supuestos. Si se vuelve común, agregar esas condiciones al contrato.
- El texto de bienvenida dice los minutos al escribirse; si la estructura cambia mucho después, hay que corregirlo a mano.
- La propuesta de un comentario de sección se describe en palabras; no se dibujan las secciones completas como en una pregunta.
- Cada llamada con el modelo rápido escribe la skill a caché (unos centavos); si el botón IA se usa mucho, conviene caché de una hora.
- Con filtros **en vivo** (fase 5), cambiar con la IA algo que ya tiene respuestas reales merecerá el mismo aviso que a mano.

### Ajustes tras el primer uso (tanda 1, 2026-10-23, `a69aa21`)

Observaciones de Sergio al usar la fase 3: «frentes» no se entiende, los nombres de las preguntas tienen que ser cortos (son la columna del tablero, como en Fillout), quiere el tiempo por cada rama, no sabe cuándo está listo para participantes ni qué es «modo prueba», y se siente prototipo (muchos botoncitos). Se acordó hacer primero esto y, para el flujo como diagrama y la limpieza de botones (tanda 2), enseñar antes un boceto.

**Qué se construyó:**

- **Perfiles en vez de frentes** en toda la pantalla, el panel, el Excel («Perfil»), las alertas de NSE, los avisos y lo que escribe la IA (la skill y los prompts dicen «perfiles»; el JSON conserva la clave `frentes`).
- **Nombre corto por pregunta:** se ve arriba de cada pregunta en el documento (se corrige con un clic; en ámbar «Sin nombre corto» si falta) y en la estructura del generador. La IA lo escribe desde la estructura (regla en `contrato.md`: de 1 a 3 palabras, sin signos, distinto en el filtro). Las plantillas de ALONG 2 y de todos los tipos ya los traen. Para los filtros que ya existen, un aviso con **«Ponerlos con IA»** (una sola llamada con el modelo rápido, `generateFormularioNombres`; se aplican como un cambio más y ⌘Z los quita).
- **Las columnas del tablero se renombran solas** al guardar (`renombrarColumnas`, sin hacer esperar al guardado) y al pasar respuestas: solo las que dejó el Hub. El vínculo guarda el nombre que el Hub le puso a cada columna (`vinculo.nombres`); las de antes se reconocen porque se llaman como su pregunta (o «Filtro · Frente»). Si el equipo renombró una desde el tablero, se respeta. Si el nombre ya existe en el tablero, va con «(2)». Al guardar no se crean columnas nuevas.
- **Tiempo por perfil** (`duracionPorPerfil`): lo típico de quien entra a cada perfil, con lo que el perfil pide (sus bloques, su edad) seguro y lo que choca con eso fuera. Se ve al tocar los minutos de la barra, junto a lo típico y lo más largo. En ALONG 2: 9 a 10 minutos por perfil, hasta 16 si le salen todos los bloques.
- **Estados claros:** Borrador › Prueba › En vivo en pasos, con una línea de qué significa cada uno junto al enlace y el paso que sigue («Pasar a prueba»). «En vivo» se ve pero llega con la fase 5.
- **«¿Está listo?»** (`chequeosListo` en `listo.ts`): nada por corregir, perfiles con cuota, cabe en 10 minutos (cada perfil), nombre corto en cada pregunta, supuestos de la IA revisados, contestado en prueba y vinculado a un tablero. Dice qué falta en palabras; no bloquea nada.

**Probado en local (2026-10-23):** en `lv4los` «Ponerlos con IA» puso los 23 nombres («Frecuencia», «Tipo de mascota», «Contacto WhatsApp»…) en unos 10 segundos; al guardarse, las 45 columnas de su tablero de prueba tomaron el nombre corto (incluidas «Filtro · Perfil» y las del NSE). Costó unos 15 centavos de dólar, casi todo por escribir la skill a la caché del modelo rápido la primera vez. Los pasos, la lista «¿Está listo?» (en `lv4los` todo listo; en `rmbdmkg`, en borrador, faltan 4) y los minutos por perfil se ven bien a 800 de ancho, sin errores en la consola. 70 pruebas.

**Pendiente:** el filtro real «SCREENER ALONG 2» todavía no tiene nombres cortos: al abrirlo sale el aviso con «Ponerlos con IA».

### Flujo como diagrama y menos botones (tanda 2, 2026-10-23, `e823da6`)

Sergio aprobó los dos bocetos (documento limpio y flujo como diagrama de proceso) antes de construir.

**Qué se construyó:**

- **Flujo como diagrama** (`filasFlujo` en `flujo.ts`, `MapaFlujo.tsx`): los pasos de arriba abajo unidos con flechas; a la derecha, en rojo, dónde termina alguien en cada paso; las secciones que solo salen si aplica, punteadas y lado a lado como **ramas** que se juntan otra vez en el primer paso para todos; los bloques que se repiten con «↻ uno por cada opción de …» (con el nombre corto de la pregunta); el NSE como «solo alerta»; al final, los perfiles con su cuota. Una rama empieza en una sección condicional (o que se repite) y sigue con las que dependen de ella. Un clic en una caja lleva a su parte del documento (también «Perfiles y cuotas»). En celular, lo que termina va dentro de la caja.
- **Herramientas solo en la pregunta elegida:** al tocar una pregunta se marca con un recuadro y aparece arriba a la derecha «IA» y «⋯» (subir, bajar, tipo, obligatoria, mostrar solo si, ayuda, nota, imagen, quitar). Las demás preguntas no muestran botones, ni sus opciones, ni «+ Opción» o «+ Fila». Esc o un clic fuera la suelta. «Sin nombre corto» solo se ve en la elegida (el aviso de arriba cuenta cuántas faltan). Las secciones muestran Comentar y «⋯» (con subir y bajar) al pasar el mouse.
- **Encabezado más simple:** título con Borrador › Prueba › En vivo a la derecha; abajo, una línea con qué significa el estado, «¿Está listo?» y el paso que sigue. Pestañas subrayadas y, a su derecha, «Guardado», los minutos como rango por perfil («9 a 10 min», el detalle al tocarlos) y un solo menú «⋯» con deshacer, rehacer, estructura, versiones, copiar y abrir el enlace, volver a borrador, cerrar, borrar y el uso de la IA.
- Se quitó el mapa chico junto al documento (lo cubre la pestaña Flujo) y textos que solo explicaban.

**Probado en local (2026-10-23):** con «Prueba fase 3 · ALONG 2 desde Word» el flujo salió como el boceto (aromatizantes y limpiadores en dos ramas que se juntan en «Marcas»); el clic en «Perfiles y cuotas» lleva a esa sección; elegir una pregunta muestra solo sus herramientas; el menú «⋯» y la lista «¿Está listo?» funcionan; en celular (375) sin desplazamiento a lo ancho. 71 pruebas.

### Celular, correo y dirección más finos para el participante (2026-10-23)

Sergio pidió que esos campos se sientan de producto: lada en el celular y ayuda para la dirección. Primero eligió el código postal con el catálogo de Correos de México, pero esa página (y datos.gob.mx) no abre ni desde aquí ni para él; entonces eligió las sugerencias de Google mientras escriben. La geolocalización no se recomendó: pide permiso, asusta en un filtro y da dónde está la persona, no dónde vive.

**Qué se construyó:**

- **Celular:** la lada y la bandera del país del filtro a la vista (🇲🇽 +52) y el número en grupos mientras se escribe («55 1234 5678»), con teclado de números. Cada país dice cuántos dígitos lleva (`telefono` en `paises.ts`: México 10, Centroamérica 8, Perú y Chile 9, Brasil 11); antes eran 10 para todos. Se guardan solo los dígitos, sin la lada (si la pegan con ella, se quita), así el tablero y el panel no cambian.
- **Correo:** si el dominio parece mal escrito («gmial.com», «hotmail» sin .com), sugiere el bueno («¿Quisiste decir …@gmail.com?»); no corrige solo (`correo.ts`).
- **Dirección por código postal (México, `buscaCp`):** se empieza por el código postal; con los 5 dígitos se llenan solos el municipio y el estado y la colonia se elige de la lista (o «No está en la lista» para escribirla). Si la persona ya cambió el municipio o el estado, un código postal nuevo no se lo pisa. Si el código no se encuentra, todo se escribe a mano. Los países sin catálogo siguen como antes.
- **Catálogo:** tabla `codigos_postales` (en `add-formularios-tables.ts`, ya creada en la base con el OK de Sergio) y `scripts/cargar-codigos-postales.ts`, que lee el archivo de Correos de México (.txt o .zip, en Latin-1) y deja los estados con los nombres del Hub («México» → «Estado de México», «Veracruz de Ignacio de la Llave» → «Veracruz»…). La consulta es pública (`getCodigoPostal`); mientras el país no tenga catálogo cargado (`catalogo: false`), no avisa nada y la dirección se escribe a mano.

- **«Busca tu dirección» con Google (Places API New):** un cuadro arriba de la dirección; van escribiendo (desde 4 letras) y salen hasta 5 sugerencias del país del filtro, con «Sugerencias de Google» como pide Google. Al elegir una se llenan calle, número, colonia, código postal, municipio y estado (por tipo de cada parte, con el nombre de estado del Hub) y solo se revisan o se agrega el número interior. «No la encuentro: escribirla a mano» abre los campos. Las llamadas van por el servidor (`sugerirDireccion`, `detalleDireccion`, públicos) con la llave de mapas del Hub, `ZITE_GOOGLE_MAPS_API_KEY`, que nunca llega al navegador. Cada búsqueda lleva un token de sesión y la dirección elegida solo pide `addressComponents` y `formattedAddress` (tarifa Essentials). Solo responde para filtros en prueba o en vivo (o a quien entra al Hub) y con tope por búsqueda y por filtro. Si no hay llave o Google no responde (el servicio apagado), el cuadro no aparece y se escribe a mano. Costo (tabla de Google de 2026): 10 mil búsquedas y 10 mil direcciones elegidas gratis al mes; una persona usa unas 5 búsquedas y 1 dirección.

**Probado en local (2026-10-23):** en `/f/lv4los` en celular: la lada, el número agrupado al pegarlo con «+52», la sugerencia del correo y la dirección sin catálogo (se escribe a mano); con una respuesta simulada en el navegador (sin datos en la base), municipio y estado llenos, la lista de colonias y escribir una que no está. «Busca tu dirección» con respuestas de Google simuladas en el navegador (datos inventados): sugerencias, elegir una llena los seis campos y la lista no se vuelve a abrir; sin la llave en local, el cuadro no aparece. 75 pruebas.

**Probado en producción (2026-10-23, `8a0d635`):** Sergio prendió «Places API (New)» en el proyecto «Sapience maps» de Google Cloud. En `/f/lv4los` (sin enviar nada) «Avenida Vallarta 1500 Guadalajara» dio sugerencias reales y al elegirla quedaron calle, colonia (Americana), municipio (Guadalajara), estado (Jalisco) y código postal (44600). Por la API: Naucalpan con «Estado de México» bien puesto; en la Ciudad de México Google no da la alcaldía (pone «Ciudad de México»), así que ahí el campo se deja vacío para que la escriban. El servidor de la API en producción es `hub-sapience-api.onrender.com` (el sitio, `hub.sapience.com.mx`).

**Pendiente:** el catálogo de códigos postales sigue sin cargar: si algún día se consigue, la tabla y el script ya están.

### Preguntas con imágenes: sin bloqueo, la IA puede y enlaces (2026-10-23, `0dd8ff3`)

Sergio no podía cambiar una pregunta a «Selector con imágenes»: a mano el editor dejaba de guardar hasta que alguna opción tuviera imagen, y a la IA se lo prohibía la skill (y lo dijo como «el contrato no lo permite»).

**Qué se construyó:**

- **Se guarda aunque falten imágenes.** Ya no es un problema de `revisarDefinicion`: al participante una opción sin imagen le sale como renglón de texto. Lo que falta es un pendiente: en la pregunta («· faltan 3 imágenes») y en «¿Está listo?» («Las preguntas con imágenes tienen sus imágenes»; `imagenesQueFaltan` en `revisar.ts`). «Ninguno» y «Otra» no cuentan.
- **Pegar el enlace de una imagen:** en el menú de la opción («Pegar enlace de imagen…»), en el de la pregunta («Imagen arriba desde un enlace…») o con ⌘V de un enlace sobre una opción o pregunta. El servidor la descarga (`traerImagenDeEnlace` → `imagenesEnlace.ts`): solo http(s) de internet (no la red interna del servidor, ni en las redirecciones), solo JPG, PNG, WebP o GIF, hasta 10 MB y 15 segundos. El editor la achica y la sube como cualquier imagen: el Hub guarda su copia y no depende de esa página.
- **La IA puede usar selectores con imágenes** cuando se lo piden o cuando el screener que convierte los trae. Si le dan enlaces, los pone y el servidor guarda la copia (si uno no se puede traer, lo quita y lo dice); nunca inventa enlaces; si no hay, deja las opciones sin imagen y lo explica. En el ejemplo de ALONG 2 (`hogar.json`), las dos preguntas que en el Word son selector con imágenes ya van así. Y en sus explicaciones no nombra la skill, el contrato ni el JSON.

**Probado en local (2026-10-23):** en «Prueba fase 3 · desde lv4los», una opción de «Eres…» con el enlace del logo de Google: la imagen quedó en la carpeta del Hub, la pregunta pasó sola a selector con imágenes con «faltan 3 imágenes» y se guardó; ⌘Z lo dejó como estaba. Enlaces a la propia máquina, a la red interna, a la dirección de datos de la nube, `ftp://` o a una página que no es imagen se rechazan con su motivo. El botón IA («Cámbiala a selector con imágenes») propuso el cambio y explicó en palabras simples que faltan las imágenes; se cerró sin aplicar. 76 pruebas.

### Aviso de privacidad, «Antes de empezar» fijo y revisión de la identificación (2026-10-23, `301e804`)

Sergio pidió, con capturas de su Fillout, que todo filtro arranque igual: el aviso de privacidad con un enlace para leerlo, el nombre y una identificación oficial. Quien no acepta el aviso, no quiere dar la identificación o no la sube, termina ahí. Y que la IA cruce la identificación con lo que la persona declaró.

**Qué se construyó:**

- **El aviso de privacidad dentro del formulario.** El Word «Aviso de Privacidad AGC.docx» (el de participantes) se pasa a texto con `scripts/subir-aviso-privacidad.ts` (con mammoth: títulos, párrafos y listas) y se guarda en Storage (`zite-uploads/formularios-config/aviso-privacidad.json`), no en el repositorio, porque trae los datos de contacto de la empresa. `getAvisoPrivacidad` (público) lo sirve; el servidor lo recuerda 10 minutos. Se lee en una hoja a pantalla completa con «Volver al cuestionario» (`AvisoPrivacidad.tsx`) desde la bienvenida («Aviso de privacidad», discreto) y desde la pregunta del aviso («Leer el aviso de privacidad», `pregunta.enlaceAviso`); también en `/f/aviso`. Para cambiarlo se vuelve a correr el script con el Word nuevo: `cd server && npx tsx --env-file=../.env scripts/subir-aviso-privacidad.ts <archivo.docx>`.
- **«Antes de empezar» en todo filtro** (`inicio.ts`): la sección `hub_inicio` con el aviso (`hub_aviso`: «He leído y acepto el aviso de privacidad» o «No acepto», que termina con «No aceptó el aviso de privacidad»). Solo si acepta aparecen el nombre (`hub_nombre`) y «¿Estás de acuerdo en dar una foto de tu identificación?» (`hub_id_acepta`; «No» termina con «No quiso dar su identificación»); con «Sí», la foto (`hub_id_foto`, obligatoria: sin ella no sigue).
  - La pone el Hub, como las preguntas del NSE: `conInicio` al crear (por cualquier vía) y al duplicar. Quita el aviso y el nombre que traiga la plantilla (ids `aviso` y `nombre`) y `claves.nombre` pasa a `hub_nombre`. Si queda otra sección llamada «Antes de empezar» (las indicaciones de la plantilla de prueba), se renombra «Indicaciones».
  - Siempre va primero: `inicioPrimero` al escribir con la IA, y `protegerNse` no deja que la IA la quite ni la mueva.
  - En el editor sale fija: sin «⋯», Comentar ni «+ Pregunta», con candado y «va en todos los filtros»; cada pregunta dice «la pone el Hub en todos los filtros».
  - La IA no la escribe (regla en la skill; si el Word la trae, la omite y lo dice en los supuestos; el ejemplo `hogar.json` ya no trae aviso ni nombre). No sale en la estructura, pero sí cuenta en los minutos.
  - **Los filtros que ya existían no cambian** (SCREENER ALONG 2 y los demás): solo los nuevos y las copias. Para ponérsela a uno existente, se duplica.
- **Revisión de la identificación con IA** (`identificacion.ts`): al guardar una respuesta con foto, sin que el participante espere, el servidor achica la foto (sharp, hasta 1600 px, JPEG) y Sonnet 5.5 (esfuerzo bajo) lee si es una identificación oficial, si se alcanza a leer, el tipo, el nombre, la fecha de nacimiento, la ciudad y el estado. El Hub lo compara con lo declarado:
  - el nombre: al menos dos palabras del declarado (o la única) en el de la identificación;
  - la edad, con un año de margen, si el filtro tiene `claves.edad`;
  - el lugar: el estado de la primera pregunta de dirección (si no hay estado, la ciudad).
  - Lo que no cuadra es **alerta en el panel, nunca descarte** (como el NSE): «La foto no parece una identificación oficial», «No se alcanza a leer la identificación», «La identificación dice otro nombre: «…»», «Edad distinta en la identificación: N años», «La identificación es de otro lugar: …». Si la IA falla: «No se pudo revisar la identificación con la IA: revísala a mano». Lo leído queda en `resultado.identificacion`.
  - El uso queda en `formulario_ia_uso` con la acción `identificacion` y el usuario `participante` (no cuenta para el tope por hora).
  - **Costo:** con una identificación inventada, 2 segundos, unos 1,160 tokens de entrada y 100 de salida: unos 0.3 centavos de dólar por persona (unos 3 dólares por cada 1,000).

**Probado en local (2026-10-23):** filtro «Prueba · inicio fijo e identificación» (`wnf1xq`, de la plantilla de tipos, en prueba). En celular, «Aviso de privacidad» en la bienvenida abre el aviso completo; «Antes de empezar» muestra solo el aviso hasta aceptarlo, luego el nombre y la identificación, y «Sí» pide la foto. Con una identificación inventada (datos de prueba) y la edad declarada en 22, quedó la alerta «Edad distinta en la identificación: 35 años» con lo leído (INE, nombre y lugar). En el editor la sección sale fija. 79 pruebas.

**Pendiente (Sergio):**
- Revisión legal del aviso: hoy no menciona las fotos de identificación (dato sensible), su revisión con IA ni cuánto tiempo se guardan. Si se agrega, se vuelve a subir el Word con el script.
- Borrar el filtro de prueba `wnf1xq` (una respuesta de prueba con una identificación inventada; se creó antes del cambio de «Indicaciones» y trae dos secciones «Antes de empezar») y la copia «Prueba fase 3 · café frío con IA (copia)».

### El celular junto al documento (2026-10-24, `aa3dec3`)

Sergio pidió ver cómo queda cada sección mientras revisa el documento, sin irse a la pestaña Celular: con imágenes, matrices y demás es difícil imaginarlo.

**Qué se construyó:**

- En la vista Documento, en pantallas anchas (desde 1280 px), un celular fijo a la derecha (`MuestraCelular.tsx`) muestra la parte donde se hizo clic: la bienvenida, cualquier sección o el final («Al terminar»). Al elegir una pregunta, el celular la lleva a la vista y la marca con un recuadro suave. Se puede contestar (no se guarda nada) y «Atrás» y «Siguiente» pasan a la sección de antes o de después, en el orden del documento.
- Para mostrar una sección sin contestar lo de antes, `pantallaDeMuestra` (en `motor.ts`) la arma con todas sus preguntas (aunque algunas solo salgan si aplica), con todas las opciones de la pregunta de la que salen las suyas y, si se repite, con la primera repetición («Tu aerosol»). Debajo del celular se dice cuando es así, en una línea.
- Las piezas de cada pantalla del participante (bienvenida, cuerpo de la sección, barra de botones, final y marco) salen de `Participante.tsx`, así el celular de al lado se ve igual que el formulario real. La pestaña Celular sigue para probar el camino completo con la lógica y ver si calificaría.
- En pantallas angostas no aparece: ahí está la pestaña Celular.

**Probado en local (2026-10-24):** con «Prueba · inicio fijo e identificación» a 1440×900 y 1280×720: clic en «Empaques» (selector con imágenes), «En tu casa» (matrices), la bienvenida (con «Empezar» pasa a la primera sección) y «Al terminar»; elegir una pregunta la marca y la lleva a la vista; «Siguiente» cambia de sección. A 1100 de ancho no aparece. La pestaña Celular y el formulario público (`/f/wnf1xq`, en celular) siguen igual. 80 pruebas.

### Fase 4 · Word y PDF para el cliente (2026-10-24, `9b8e584`)

Sergio preguntó dónde se crea el Word o el PDF y pidió seguir con las fases que faltan. El modelo salió de los filtros que el equipo hace a mano (MALETA D, SED R y LORO, en OneDrive), que comparten formato: la muestra con los perfiles arriba, «Filtro de reclutamiento» centrado y subrayado, preguntas numeradas en negritas, cada opción con su número y «CONTINUAR» en verde o «TERMINAR» en rojo, y las notas en azul. El «ALONG 2 v4» de Descargas no sirvió: es el que se armó con IA (recuadros de colores, la paleta del Hub).

**Qué se construyó:**

- **El contenido** (`lib/formularios/documento.ts`, puro): `documentoDeFiltro(def, titulo)` arma bloques: portada (título y ficha con país, duración y regla de NSE), muestra (cada perfil con su cuota y quién entra; las alertas abajo), lo que lee al entrar, y cada sección con sus preguntas numeradas de corrido. Cada pregunta trae lo de antes (ayuda, «Solo aparece si…», «Respuesta múltiple, hasta 5»), sus opciones con CONTINUAR, TERMINAR (`termina`) o NO CUENTA ESTE BLOQUE (`descarta`) y lo que deja fuera de un perfil en azul, o su matriz (columnas A, B, C… y TERMINAR en la celda que termina, como en los filtros del equipo), o lo que se espera si es abierta («Celular de 10 dígitos (+52)»), y lo de después («Si contesta menos de 25 o más de 65, TERMINAR», notas para el equipo, preguntas del NSE). La lógica sale de `palabras.ts`, la misma del editor. En las secciones que se repiten, «{opcion}» se escribe **[OPCIÓN]**. Al final, los dos mensajes de despedida.
- **El diseño** (`serverUtils/formularios/documento.ts`), igual en Word y en PDF, después de que Sergio pidió «el header de Sapience y un formato más lindo, con tablas»: el **encabezado oficial** en cada página (la franja gris oscuro `#262626` con el logo en blanco; en el Word es el mismo `header1.xml` y el mismo logo de la plantilla de las guías y de los filtros del equipo, copiados a `serverUtils/formularios/marca/`; en el PDF, una franja igual con `logo_blanco.png`). A4. Portada con «Filtro de reclutamiento», el título y la ficha; la muestra en tabla con encabezado oscuro; cada sección con su franja oscura; **cada pregunta en un recuadro**: el número en un cuadro oscuro, la pregunta en gris claro y debajo sus opciones (con imagen si la tiene), CONTINUAR en verde, TERMINAR en rojo y las notas en azul. **Todo en Montserrat** y jerarquía por tamaño y grosor (los dos, pedidos por Sergio; él fijó las opciones en 8 pt): título 22 pt; franjas de Muestra, secciones y Al terminar 10.5 pt en mayúsculas; pregunta 10 pt en negritas; opciones y ayuda 8 pt (la ayuda en gris oscuro); notas 7.5 pt en azul; etiquetas (CONTINUAR, TERMINAR, la ficha) 7 pt en negritas y un poco abiertas. En el PDF, Montserrat va incrustada (`marca/fuentes/`, licencia SIL OFL, con su `LEEME.md`) porque el servidor no la tiene; el Word la pide por nombre: quien no la tenga instalada (Microsoft 365 la descarga sola) verá otra letra. El Word se arma a mano (XML de Word en un zip con `jszip`, que ya viene con `mammoth` y `exceljs`); el PDF sale del mismo contenido en HTML con `puppeteer`, como los PDF de órdenes de compra (`generatePoPdf`). Las imágenes se traen y se achican con `sharp` (las de afuera, con `descargarImagen`, que no deja abrir la red interna); la que no se puede traer se omite.
- **La descarga:** «Descargar Word» y «Descargar PDF» en el menú «⋯» del filtro (`getFormularioDocumento`). Usa lo guardado: si hay cambios en camino, se guardan antes; si hay algo por corregir, no deja. Cada descarga deja una versión con nombre («Word para el cliente», «PDF para el cliente») en Versiones, una por revisión, para saber qué vio el cliente.

**Probado en local (2026-10-24):** el Word y el PDF de ALONG 2 y de la plantilla de tipos (imágenes en las opciones, matrices, concepto con imagen); el Word está bien formado. Desde el menú del filtro de prueba `wnf1xq`: Word en 0.6 s y PDF en 1.8 s, con el encabezado; dos descargas del Word dejan una sola versión. 81 pruebas.

**Visto bueno de Sergio (2026-10-24):** el diseño, con encabezado, tablas, jerarquía y Montserrat. **Pendiente:** confirmar que el PDF sale en producción (Render tiene Chrome para los de órdenes de compra) y que el Word abre bien en Word.

### Matrices como tabla en el celular (2026-10-24, `6c14519`)

Sergio vio las matrices del participante (una tarjeta por renglón con botones) y pidió que se vean como matrices.

**Qué se construyó** (`campos/Matriz.tsx`):

- Una tabla de verdad: los renglones a la izquierda, las columnas arriba (letra chica, en dos líneas si hace falta) y en cada cruce un **círculo** (una respuesta por renglón) o un **cuadro con palomita** (varias); se toca la celda completa. Renglones alternados en gris muy claro para seguir la línea.
- **Si las columnas no caben**, la tabla se desliza de lado con la columna de los renglones fija, una sombra a la derecha mientras queda por ver y «Desliza para ver más opciones →» arriba. Columnas de 54 px si las etiquetas son cortas y de 84 px si alguna pasa de 14 letras; con 4 columnas cortas cabe completa en un celular de 375.
- Si dejan un renglón vacío, además de «Contesta todas las filas», ese renglón se pone en rojo.
- En las de varias respuestas sale solo «Puedes marcar varias en cada renglón», salvo que la ayuda ya lo diga.
- De paso: la barra de «Atrás / Siguiente» quedaba debajo de la columna fija al bajar; ahora va encima.

**Probado en local (2026-10-24):** en `/f/wnf1xq` («En tu casa», dos matrices de 4 columnas) a 375 (cabe completa) y a 320 (se desliza con los renglones fijos); marcar, desmarcar y renglones en rojo al seguir sin contestar. El celular junto al documento y la pestaña Celular usan el mismo campo.

### Fase 5 · «En vivo» (2026-10-24, `90cadec`)

Sergio preguntó si hoy podía lanzar un formulario. Se podía en «Prueba» (el enlace funciona, se guarda y califica, y se pasa al tablero a mano), pero el participante veía «PRUEBA», todo contaba como prueba y «Borrar pruebas» lo habría borrado. Pidió activar «En vivo» ya, antes del resto de la fase 5.

**Qué se construyó:**

- **«Abrir en vivo»** en la línea de estado cuando el filtro está en prueba, con confirmación: qué cambia (sin «Prueba», lo que entra cuenta como real, «Borrar pruebas» no lo toca, los cambios al filtro los ven al momento, el paso al tablero sigue a mano) y lo que falte del «¿Está listo?», como aviso (no bloquea).
- En vivo, el formulario público ya no lleva la etiqueta (eso ya lo hacía `FormularioPublicoPage` con el estado) y las respuestas se guardan con `es_prueba = false` (`submitFormularioRespuesta` ya lo hacía). `deleteFormularioRespuestas` («Borrar pruebas») solo borra `es_prueba`, y «Borrar filtro» solo aparece sin respuestas reales: las reales no se pueden borrar desde el Hub.
- En vivo, el menú «⋯» solo ofrece «Cerrar». **Con respuestas reales no regresa a borrador ni a prueba** (`setFormularioEstado` lo rechaza en el servidor: lo nuevo quedaría como prueba); cerrado, se reabre en vivo. Sin respuestas reales, «Reabrir en prueba» como antes.
- La línea de estado dice «Lo contestan participantes reales. Lo que cambies en el filtro lo ven al momento.»; en la lista, el estado se lee «EN VIVO» (antes salía el nombre interno).

**Probado en local (2026-10-24):** con el filtro de prueba `wnf1xq`: la confirmación (avisó que falta vincular el tablero), en vivo, el formulario público sin «Prueba», el menú solo con «Cerrar», cerrar y reabrir en prueba (no tenía respuestas reales); quedó en prueba como estaba. No se mandaron respuestas reales (con una, ese filtro ya no se podría borrar).

El resto de la fase 5 está en «Fase 5 · operación», abajo.

### Rediseño del flujo: un solo camino, Diseñar y Reclutar, y publicar cambios en vivo (2026-10-24, `2d4c4d6`)

Sergio pidió ojo de diseñador UX y de usuario: lo sentía confuso en los pasos. Diagnóstico (recorrido de punta a punta): el mismo camino estaba partido en dos indicadores («Borrador › Prueba › En vivo» arriba y «Insumos › Estructura › Preguntas» en medio, que desaparecía al terminar la IA); «Pasar a prueba» y «¿Está listo?» salían antes de tiempo; el enlace estaba escondido en «⋯» y el tablero dentro de Respuestas; las pestañas mezclaban diseñar con reclutar; al abrir un filtro hecho con IA el documento empezaba a media pantalla por los avisos; el celular de al lado no seguía la lectura; «Formularios» y «Filtros» cruzados; la lista no decía en qué iba cada filtro; el editor sin números de pregunta y la lógica en rojo repetida. Sergio aprobó tres bocetos (un solo camino, modo Diseñar, modo Reclutar) y uno más para editar en vivo.

**Qué se construyó:**

- **Un solo camino** (`Recorrido.tsx`): Insumos · Estructura · Preguntas · Probar · Reclutar (sin IA: Preguntas · Probar · Reclutar), en el encabezado del filtro con el título, su estado y el menú «⋯». Lo hecho en verde con palomita, el paso actual en teal; a un paso hecho se va con un clic (Estructura abre «Ver y ajustar la estructura», Probar el celular, Reclutar su modo; Insumos no, porque pedir otra estructura rehace lo escrito). Debajo, `AccionPaso` (en `EstadoFiltro.tsx`) dice qué toca en una línea y pone **un solo botón**: «Pasar a prueba» (en Preguntas, ya no en Insumos), «Abrir en vivo» (en Probar) o «Reabrir». En Insumos y Estructura el botón sigue en su pantalla, junto a lo que se llena. El generador ya no tiene su propio indicador ni el uso de IA de la hora (está en «⋯»).
- **«Por revisar»** (`PorRevisar.tsx`): un chip («Por revisar · 2» o «Listo para participantes») que abre una lista de lado con lo de «¿Está listo?» y, ahí mismo, los supuestos de la IA (con «Ya lo revisé») y los nombres cortos (con «Ponerlos con IA»). Ya no van encima del documento. Antes de probar no cuentan «Contestado en prueba» ni «Vinculado a un tablero».
- **Dos modos**: «Diseñar» (Documento, Flujo, Celular) y «Reclutar · N» (aparece desde prueba; en vivo o cerrado el filtro abre ahí). Reclutar (`PanelRespuestas.tsx`) junta arriba el **enlace** (con Copiar y Abrir) y el **tablero** (vincular, cambiar, «Pasar las que califican»), las **cuotas con barras de avance** por perfil y las respuestas.
- **Documento**: preguntas **numeradas** como en el Word (las de contenido no cuentan); la lógica de cada opción en **etiquetas chicas a la derecha** (Termina, No cuenta, Fuera de perfil, Exclusiva, Pide cuál), con el detalle al pasar el mouse; al elegir la pregunta sale la línea completa con el motivo editable. El **celular sigue la sección que se está leyendo** (la que cruza el 35 % de arriba de la pantalla).
- **Editar en vivo** (`CambiosEnVivo.tsx`): en vivo, lo que se cambia se guarda en `formularios.cambios` (columna nueva, en `add-formularios-tables.ts`, creada con el OK de Sergio) y los participantes siguen con `definicion`. Una franja dice «Cambios sin publicar · N» con «Descartar» y «Publicar cambios»; publicar muestra qué cambia (`cambiosEnPalabras`) y que las respuestas que ya entraron no cambian. `publishFormularioCambios` (con `descartar`) guarda una versión «Antes de publicar cambios», pasa `cambios` a `definicion` y renombra columnas del tablero. Al pasar a prueba o borrador lo pendiente se aplica solo; duplicar copia lo más nuevo.
- **«Filtros» en todo**: la pestaña de Tools, la lista, «Nuevo filtro» y el regreso «← Filtros». La lista dice en qué va cada uno: «Por pedir la estructura», «Estructura por aprobar», «Preguntas por escribir», «Preguntas por revisar», «Probando · 1 respuesta de prueba», «En vivo · 4 de 16 en cuota · cambios sin publicar», «Cerrado · …» (`getFormularios` trae la etapa, la cuota total, las que califican de verdad y si hay cambios sin publicar).

**Probado en local (2026-10-24):** la lista con el paso de cada filtro; un filtro con IA en Preguntas (camino, «Por revisar · 2» con supuestos y nombres, números, etiquetas, celular siguiendo la lectura, ir a Estructura y regresar); uno en Insumos (solo el paso 1, sin botones adelantados); con el de prueba `wnf1xq`: abrir en vivo (abre en Reclutar con enlace, tablero y cuotas), cambiar la bienvenida (franja con 1 cambio, el formulario público seguía con la anterior), publicar (el público cambió), cambiar y descartar (regresó a lo publicado), dejar el texto original publicado, cerrar y reabrir en prueba: quedó como estaba, sin cambios pendientes y con dos versiones «Antes de publicar cambios». En celular (375) el encabezado cabe sin desplazamiento. 81 pruebas.

### Fase 5 · operación (2026-10-24, `0bd0d7d`)

Sergio planteó tres dudas: si Filtros debía vivir en Tools o junto a Reclutamiento; que hoy el filtro «termina» en muchos puntos, cuando en general dejan contestar todo para no sesgar (si saben dónde se corta, lo vuelven a llenar falseando datos), aunque sí hay que registrar por qué alguien entra o no a la muestra, y quizá que la IA clasifique candidatos; y cómo se liga lo que contestan con los tableros, como hoy con Fillout. De ahí salieron: solo pasan al tablero quienes entran a un grupo; duplicados e historial en Filtros con la búsqueda de siempre; y al crear un filtro desde uno anterior, traer a quienes lo contestaron y medir su historial contra el cliente y las fechas del proyecto nuevo.

**Qué se construyó:**

- **Nadie se corta por defecto** (`motor.ts`): `criteriosCumplidos` junta **todos** los motivos de «no califica» (opciones, rangos, `terminaSi`, reglas de matriz) en `resultado.noCalifica`; `terminacion` solo corta con lo marcado `cortar: true`, y siempre con el aviso y la identificación (`inicio.ts`). `califica` = sin motivos, completa y con perfil. La despedida es la misma para todos. En el editor, el menú de cada opción dice «No califica (lo deja fuera)» y aparte «Y cortar el filtro aquí»; los rangos tienen la casilla «Y cortar el filtro ahí»; las etiquetas dicen «No califica» o «No califica · corta» (`palabras.ts`, `comun.tsx`, `Opciones.tsx`, `Ajustes.tsx`, `MapaFlujo.tsx`). El Word sigue poniendo TERMINAR en rojo. La skill (regla 0 de `reglas.md` y `contrato.md`) pide `cortar` solo si el analista lo pide.
- **Al recibir una respuesta** (`alRecibir.ts`, sin hacer esperar al participante, uno tras otro): revisión de la identificación → **historial** → si está **en vivo**, califica y hay tablero, **pasa solo** al tablero si alguno de sus perfiles tiene lugar (si todos llenaron cuota queda «Perfil lleno», de respaldo) → **clasificación con IA**.
- **Historial y duplicados** (`historial.ts`): la búsqueda de duplicados de Reclutamiento (`globalIdentityCache`, 2 de 3 iguales) contra todos los tableros, más los filtros que contestó (por celular), medida contra **el proyecto del filtro**: su cliente («mismo cliente») y su fecha de inicio (los proyectos posteriores no cuentan; «hace menos de 6 meses»). La nota usa las palabras de Fillout (🔴 YA PARTICIPÓ, 🟡 DUPLICADO EXTERNO, 🟠 MISMO PROYECTO, 🔵 ×N EN ESTE FILTRO) y va en `resultado.historial`; al pasar al tablero, en las notas de la fila. En Reclutar, columna **Historial**, el detalle con cada aparición y el botón **«Buscar duplicados»** (`actualizarHistorialFormulario`, vuelve a buscar para todas; la primera búsqueda tarda unos 20 s).
- **Clasificación con IA** (`clasificar.ts`): por perfil, «alto / medio / bajo» con una razón, un resumen y hasta 3 alertas (respuestas que se contradicen, abiertas vagas, marcar todo). Ayuda a ordenar; **nunca decide ni cambia si califica**. Sonnet con el filtro en caché: unos 5 s y medio centavo de dólar por persona (`formulario_ia_uso`, acción `clasificacion`). Columna **IA** y sección «Lo que dice la IA» en el detalle. No clasifica a quien se cortó al principio.
- **Traer a quienes contestaron antes** (`traer.ts`): en «Nuevo filtro» → «Desde un filtro anterior», la casilla «Traer también a quienes lo contestaron (N)». Llegan una vez por persona (la respuesta más reciente de cada celular), con su fecha original y la marca **TRAÍDA**, calificados con las reglas del filtro nuevo (sin pedirles otra vez el aviso ni la identificación: ya los dieron allá) y con su historial medido contra el proyecto nuevo. No se trae a quien no aceptó el aviso o no dio su identificación. **No cuentan en las cuotas ni pasan solos**: se pasan a mano. Si el filtro nuevo pregunta algo que el anterior no, salen «Incompleta».
- **Pestaña Filtros** junto a Reclutamiento en el proyecto (fuera de Tools), y **«Vincular form» del tablero** ofrece también los filtros del Hub del proyecto (dice si ya está vinculado ahí o a qué tablero pasa hoy; `getFormularios` acepta `proyectoCodigo` y devuelve el tablero). Con un filtro, el diálogo explica que solo llegan quienes entran a un perfil con lugar.
- En la lista, «No califica» gana a «Incompleta» cuando hay un motivo.

**Probado en local (2026-10-24):** la pestaña Filtros en «3 MAYO PRUEBA 3»; en `lv4los`, Historial («Mismo proyecto»), IA («Bajo» con alertas), «Buscar duplicados» y el detalle; «Vincular form» desde el tablero «Prueba fase 1 · todos los tipos» (lista los filtros del proyecto; volver a vincular el mismo no cambia nada); «Nuevo filtro» desde `lv4los` trayendo sus 2 respuestas (filtro `yjgpzy0`, «Prueba fase 5 · traer respuestas», en prueba: **queda en la base para borrarse**). El paso automático al tablero solo corre en vivo con respuestas reales: está cubierto por la lógica pero **no se probó con una respuesta real** (habría dejado una respuesta real en un filtro de prueba). 83 pruebas.

**Pendiente:** el tablero no muestra todavía qué filtro del Hub tiene vinculado (sigue diciendo «Vincular form»); «Buscar en la base» entre varios filtros (fase 6).

### Negritas y color en los textos (2026-10-24, `35be0b0`)

Sergio preguntó qué pasaba si quería cambiar de color un texto del filtro: no se podía, todo era texto simple. Pidió negritas y un color para resaltar, que se vean igual en el formulario y en el Word.

**Qué se construyó:**

- **Marcas dentro del texto** (`lib/formularios/formato.ts`): `**así**` es negrita y `==así==` va en el color de resaltar (`COLOR_RESALTADO`, el morado de Word `#7030A0`: no se confunde con el rojo de error ni con el azul de las notas). Así el contrato no cambia. La marca va pegada a las palabras; una suelta («2 ** 3») se lee como texto. `leerFormato` da los tramos, `sinFormato` quita las marcas y `alternarMarca` las pone o quita sobre lo seleccionado.
- **Dónde va:** la pregunta, su ayuda, el texto de contenido, la entrada de la sección, la bienvenida y las dos despedidas. No en opciones, filas, títulos ni nombres cortos.
- **Editor** (`TextoEditable` con `formato`): al corregir uno de esos textos salen los botones **B** (también ⌘B) y **Color**; con el cursor en una palabra la marca entera, y otra vez la quita. En el cuadro se ven las marcas; afuera, ya con formato.
- **Formulario, celular de muestra y propuesta de la IA** (`TextoConFormato.tsx`): negritas y color. En la pregunta, que ya va en negritas, lo marcado en negritas además se **subraya** (igual en el Word).
- **Word y PDF** (`tramosDe` en `lib/formularios/documento.ts`): las mismas negritas, subrayado y color; los títulos de sección (franja oscura) van sin formato.
- **Texto simple** en las columnas del tablero y el Excel (`nombreDePregunta`), la lógica en palabras y el flujo (`sinMarcador`), el detalle de una respuesta (`describir`) y los avisos de la IA. Ponerle formato a una pregunta sin nombre corto no renombra su columna.
- La skill (`contrato.md`) le pide a la IA conservar las marcas al reescribir y no ponerlas por su cuenta.

**Probado en local (2026-10-24):** en el filtro de prueba `yjgpzy0`, «frutas» en color y «este mes» en negritas en una pregunta, y «probar» y «5 minutos» en la bienvenida: el editor, el celular de al lado, el formulario en `/f/yjgpzy0` a 375 y el Word y el PDF salen igual. 84 pruebas.

### Celular y correo por defecto (2026-10-26, `3a538a3`)

Sergio: el correo debería ir siempre, a menos que el analista lo quite. Hoy «Antes de empezar» solo pedía aviso, nombre e identificación; el celular dependía de que el filtro lo preguntara y el correo casi nunca iba.

**Qué se construyó:**

- **«Antes de empezar» trae celular y correo** después del nombre (`inicio.ts`: `contacto_celular`, tipo celular, y `contacto_correo`, tipo correo; solo si acepta el aviso). Sin el prefijo `hub_`: **no son fijas ni cortan**, el analista las corrige, las hace opcionales o las quita como cualquier pregunta. El celular es el del panel (`claves.telefono`).
- Si el filtro ya pide celular o correo (una plantilla o un filtro anterior), ese no se agrega. Los filtros que ya existían no cambian.
- Quitar una pregunta que era el nombre, el celular, la edad o el género del panel ya no deja el filtro con un problema que impide guardar (`quitarPregunta` limpia `claves`).
- La IA ya no los vuelve a preguntar (regla 2 de `reglas.md`, `contrato.md`); al escribir la lógica, el celular del panel sigue siendo el de «Antes de empezar» si no se quitó (`generar.ts`).
- Las traídas de un filtro anterior no salen «Incompletas» por no tener celular o correo nuevos («Antes de empezar» no cuenta para ellas).

**Probado en local (2026-10-26):** un filtro nuevo desde la plantilla ALONG 2 («Prueba celular y correo por defecto», queda para borrarse) trae el correo en «Antes de empezar» como pregunta 3, sin candado y con su menú para quitarla (ALONG 2 ya pedía celular). 84 pruebas.

**Comprobado en producción (2026-10-24):** el paso automático al tablero funciona: en «ALONG 2 - PRUEBA LUIS», en vivo, una respuesta real que calificó apareció en su tablero 7 segundos después.

### Reclutamiento: Filtros adentro y barra del tablero en una línea (2026-10-26, paso 1 del rediseño, `72c5e64`)

Primer paso del rediseño de Reclutamiento que aprobó Sergio (orden: 1) esto, 2) columnas del Hub en el tablero, 3) muestra con IA que crea grupos y eventos, 4) widget del inicio). Medido a 1366 × 650 (una pantalla de 13" con el navegador): antes la primera persona aparecía a 392 px y cabían unas 8; ahora a 284 px y caben unas 12.

**Qué se construyó:**

- **Filtros vive dentro de Reclutamiento**: ya no es pestaña del proyecto. Para que no parezca otro tablero, las partes de Reclutamiento son un **selector** gris (Filtros · Participantes; Muestra se suma en el paso 3), con un punto verde si hay un filtro en vivo y el número de respuestas reales; los tableros (pestañas subrayadas) solo salen en Participantes. En Filtros se ve la lista de filtros; el tablero no se desmonta, así que al regresar sigue con sus filtros y su vista. `?tab=filtros` sigue funcionando (abre Reclutamiento en Filtros). Solo la ve quien tiene acceso a Filtros.
- **Pestañas del proyecto en una línea** (`PestanasProyecto.tsx`): las que no caben se van a «Más ▾»; la abierta siempre se ve; en pantallas angostas van en su propia línea, y si no cabe ni una, queda la abierta como menú.
- **Barra del tablero en una línea**: Buscar, Filtros, Columnas, el formulario vinculado con su sincronización en un solo botón, Compartir, **Exportar ▾** (Excel —eliges grupos y columnas— o CSV), y **«⋯»** con Status con IA (solo si el proyecto tiene la muestra vieja), Buscar en otros proyectos (antes «Verificar duplicado»), Importar Excel y Papelera. «Importar Excel» ya no está dos veces y se quitó el modo compacto. La fila de vistas se queda completa, con el número de participantes al final (`InternalViewsBar` acepta `derecha`).
- Se quitó **«Definir muestra»** (botón y ventana; los datos de los 30 proyectos que la tenían siguen guardados y el análisis «Status» los sigue leyendo).

**Probado en local (2026-10-26):** a 1366 × 650 todo en una línea (pestañas con «Más», barra del tablero) y 12 personas a la vista; Filtros adentro (lista, regresar al tablero), menús Exportar y «⋯»; en celular, las pestañas en su línea con «Más».

### Reclutamiento: Muestra (2026-10-26, paso 3 del rediseño, adelantado, `72c5e64`)

Sergio pidió el orden del selector «Muestra · Filtros · Participantes», con Participantes por defecto al abrir Reclutamiento, y adelantar la Muestra antes de las columnas del Hub.

**Qué se construyó:**

- **Tablas** `muestras` (una por proyecto: `definicion` jsonb con sus actividades, `version`, `tablero_id`, `calendario_id`) y `muestra_versiones` (cada versión con sus cambios en palabras, el motivo y quién), en `add-formularios-tables.ts`, creadas en producción con el OK de Sergio.
- **La lógica** (`lib/reclutamiento/muestra.ts`, pura): técnicas con sus valores de siempre (sesión 8 + 2, minigrupo 5 + 1, tríada 3 + 1, díada 2 + 1, entrevista, visita en casa, compra acompañada 1 + 0, taller 10 + 2, otra), cada actividad con código (S1, T2, E3), perfil, fecha, duración, lugar, personas y reserva, y el grupo y evento que le tocan; nombre del grupo («S1 · mar 4 nov · 6:00 pm · CDMX») y del evento («S1 · Sesión de grupo · Perfil»); lugares por técnica y por perfil; cambios en palabras entre versiones.
- **La pantalla** (`components/reclutamiento/MuestraPanel.tsx`): vacía, ofrece «Proponer con IA» (si hay insumos) o «Empezar a mano»; arriba, la versión, quién la cambió y «Cambios» con el historial; los supuestos de la IA en ámbar con «Ya lo revisé»; «Cuántos de cada perfil» (perfiles por técnica, titulares + reserva); un bloque por técnica con cada actividad editable y su avance (personas en su grupo / cupo, con el estatus al pasar el mouse) y si ya tiene grupo y evento. Lo editado se guarda con «Guardar cambios» (muestra la lista de cambios y pide el motivo, opcional).
- **Crear grupos y eventos**: con los mismos endpoints del tablero (`saveBoardColumn`, `saveCalendarEvent`, `linkGroupToEvent`): cada actividad sin grupo crea su grupo en el tablero elegido; las que tienen fecha, su evento en el calendario del proyecto (si no hay, crea «Calendario de sesiones»), ya ligado (el tablero muestra el horario en el grupo). **No manda invitaciones** (el evento queda sin estatus de invitación). Al guardar cambios, los grupos se renombran y los eventos se ponen al día. Quitar una actividad no toca su grupo ni su evento (se avisa; nadie cambia de grupo).
- **La IA** (`serverUtils/muestra/muestra.ts`, Sonnet con los insumos del filtro del proyecto que más tenga): una actividad por cada sesión o entrevista (si junta entrevistas, el Hub las separa), sin inventar fechas ni una muestra si los insumos no la dicen. Al proponer la primera estructura de un filtro, también propone la muestra si el proyecto no tiene (versión 1, sin crear grupos).
- **El selector** de Reclutamiento: Muestra (con lugares cubiertos, «0/10») · Filtros · Participantes; `?tab=muestra` abre ahí.

**Probado en local (2026-10-26)** en «3 MAYO PRUEBA 3»: la IA con insumos vacíos inventaba una actividad (corregido: ahora lee el filtro con más insumos y no inventa) y juntaba 8 entrevistas en una (corregido: se separan); propuesta de 16 entrevistas con supuestos; guardar (versión 1); crear 3 grupos en «FILTRO X» y el evento de S1 en «Calendario 1», ligado y sin invitación; el horario sale en el grupo del tablero; cambiar el lugar de S1 (versión 2) renombró el grupo y movió el evento. **Quedan en la base de prueba** esa muestra, los grupos S1, E1 y E2 de «FILTRO X» y el evento de S1. 85 pruebas.

### Reclutamiento: columnas del Hub en el tablero y widget del inicio (2026-10-26, pasos 2 y 4, `225b46f`)

Con Sergio: el equipo de reclutamiento revisa en un solo lugar (el tablero), por grupos de personas y con todo a la vista. Esto reemplaza el «solo pasan al tablero los que entran a un perfil con lugar» de la fase 5.

**Qué se construyó:**

- **Todas las respuestas llegan al tablero** (`alRecibir.ts` → `pasarAlTablero`): en vivo, cada respuesta pasa sola, califique o no, menos quien no aceptó el aviso o no dio su identificación (sin su consentimiento no se guarda). Antes de pasar, la IA la clasifica. En prueba, «Pasar al tablero (N)» pasa todas a mano (ya no solo las que califican).
- **Columnas del Hub** (`tableroHub.ts`, `actualizarTablero`), columnas normales del tablero que se filtran, ordenan y guardan en vistas: **Califica** (Candidato, Casi o No entra: `bandejaDe` en `motor.ts`; antes «Resultado»), **Perfil**, **Por qué no califica**, **IA** (Alto, Medio o Bajo, con ⚠ si vio algo raro) y **Sugerido** («★ Perfil»). En los tableros vinculados antes, IA y Sugerido se acomodan junto a las demás del Hub.
- **Se mantienen al día** al llegar cada respuesta, al publicar cambios del filtro, al guardar la muestra (las cuotas salen de ahí) y con «Buscar duplicados»: califican con las reglas de hoy (sin tocar a quien se cortó en «Antes de empezar»). **Lo que el equipo cambia a mano no se pisa**: de cada celda se guarda lo último que escribió el Hub (`resultado.tablero.escrito`) y, si la celda ya no dice eso, no se vuelve a tocar.
- **Sugeridos** (`sugerir`): los mejores candidatos (IA alto primero, sin «ya participó» ni «mismo proyecto», los que contestaron antes) hasta cubrir lo que le falta a cada perfil: su cuota (de la muestra por nombre del perfil, si la hay; si no, la del filtro) menos los que ya están en un grupo. Quien cae en varios perfiles se sugiere para uno solo: el que más gente le falta y, si empatan, donde la IA lo ve mejor. Cuenta una vez.
- **El historial** ya no cuenta la propia fila de la persona en el tablero (ahora todas llegan).
- **El botón del formulario vinculado** del tablero dice «Filtro: …» cuando el tablero lo alimenta un filtro del Hub.
- **Widget del inicio** (`getResumenReclutamiento.ts`, para quien ve Filtros; los demás siguen viendo el de antes): arriba, lugares cubiertos de la muestra («0 / 10»); **Filtro**: el que está en vivo, con respuestas (+hoy), candidatos (y cuántos casi) y sugeridos (y cuántos sin contactar); **Participantes**: lugares cubiertos, por técnica, y la actividad más urgente (la próxima con cupo pendiente: cuándo, cuántos van y cuántos faltan de qué perfil).

**Probado en local (2026-10-26):** en el tablero de `lv4los` aparecieron las 5 columnas (la vieja «Resultado» renombrada a «Califica») con sus valores; cambiar a mano una calificación y recalcular la respetó; en «ALONG 2 - PRUEBA LUIS» (en vivo) la respuesta quedó Candidato, IA «Medio ⚠» y sugerida para su perfil, y el widget del inicio dice «Sugeridos 1 · 1 sin contactar». **No se probó con una respuesta real nueva** el paso de todas al tablero (la lógica es la misma que se probó). 86 pruebas.

**Pendiente:** mover a alguien a un grupo no recalcula los sugeridos al momento (se recalculan con la siguiente respuesta, al publicar, al guardar la muestra o con «Buscar duplicados»); la ficha de la persona desde el tablero.

### Formulario neutro en sharpli.mx (2026-10-26, `99571cd`)

Pedido de Sergio: que el enlace de los participantes sea de Sharpli y no de Sapience, sin riesgo de que desde ahí se vea información de clientes. Sergio apuntó `sharpli.mx` (GoDaddy) al sitio del Hub en Render; es el mismo sitio, pero en ese dominio solo vive el formulario.

**Qué se construyó:**

- **En sharpli.mx solo se carga el formulario** (`main.tsx` → `SoloFormularios.tsx`, dominios en `lib/formularios/dominio.ts`): `/f/:codigo` y `/f/aviso`; cualquier otra dirección dice «Este enlace no existe». El código del Hub (inicio de sesión, pantallas, menús) ni se descarga.
- **El servidor solo le contesta lo del formulario** (`FORMULARIO_ORIGINS` y `FORMULARIO_ENDPOINTS` en `server/index.ts`): desde sharpli.mx el navegador puede llamar el formulario, su envío, el aviso, el código postal, la dirección y la foto; todo lo demás se rechaza, y de todos modos pide inicio de sesión. Va aparte de `ZITE_APP_URL` porque esa variable también arma enlaces de vistas compartidas y correos de ODC.
- **Neutro:** sin logo de Sapience (la barra oscura se volvió una línea de avance), pestaña «Cuestionario» sin ícono, e `index.html` sin título ni ícono (las vistas previas de WhatsApp los leen sin correr nada; el Hub los pone en `marcaDelHub.ts`).
- **El enlace de Filtros** ya da `https://sharpli.mx/f/…` (en la Mac, el local). Los enlaces que ya se mandaron con el dominio del Hub siguen funcionando.

**Probado en local (2026-10-26):** en `sharpli.localhost` el formulario y el aviso abren sin el código del Hub ni la palabra Sapience (revisado también en el build), `/login` dice «Este enlace no existe»; el Hub normal sigue igual; el servidor acepta a sharpli.mx solo para los servicios del formulario.

**Queda a la vista (sin datos):** la dirección del servidor (`hub-sapience-api…`) y los nombres de los servicios en el código; las imágenes de las preguntas viven en una carpeta pública (quien tenga su dirección las ve). Captcha, pendiente.

### Muestra: insumos a la vista y cambios pedidos a la IA (2026-10-26, `ed0905b`)

Pedido de Sergio: ver qué insumos va a leer la IA para la muestra, poder sumarle archivos, imágenes o texto (siempre arrastrando o eligiendo), y corregir lo que propone con comentarios.

**Qué se construyó:**

- **«Lo que leerá la IA»** (`InsumosMuestra.tsx`): en la muestra vacía, a la vista arriba de «Proponer con IA»; con muestra, en el botón «Insumos · N» del encabezado. Archivos e imágenes (arrastrar y soltar en cualquier parte del recuadro, elegir o pegar una captura), texto y las reuniones de Notetaker del proyecto con su casilla. Acepta PDF, PowerPoint, Word, **Excel** (se lee como texto, una fila por renglón) e **imágenes** (se reducen a 1568 px en JPEG y la IA las ve).
- **De dónde salen** (`serverUtils/muestra/insumos.ts`, tabla `muestra_insumos`, creada en producción con el OK de Sergio): mientras nadie los toca son los del filtro del proyecto que más tiene («Tomados del filtro …»); al primer cambio se copian a la muestra (los PDF e imágenes, a su propia carpeta) y ya no dependen del filtro. Quitar un archivo nunca borra el del filtro.
- **Pedirle un cambio a la IA** (`comentarMuestra`): un cuadro debajo de los supuestos, con la muestra que se está editando (guardada o no) y los mismos insumos. La IA devuelve la muestra completa; las actividades que se quedan conservan su código, grupo y evento (`deLaIA` en `lib/reclutamiento/muestra.ts`), las nuevas toman el siguiente código libre y las que no regresan se quitan. Se ve qué cambió, con «Deshacer», y nada se guarda hasta «Guardar cambios».

**Probado en local (2026-10-26)** en «3 MAYO PRUEBA 3»: «S1 es en línea y agrega una tríada del mismo perfil» cambió el lugar de S1 (con su grupo y evento) y agregó T1; una imagen inventada («2 sesiones en Guadalajara, 18 nov 6 pm») soltada en los insumos se leyó y agregó S2 y S3; deshacer y quitar la imagen funcionan; el PDF del filtro quedó intacto y su copia en la carpeta de la muestra. 87 pruebas.

### Perfiles y cuotas en la Muestra; el filtro los toma con los mismos insumos (2026-10-26, `7f6eced`)

Pedido de Sergio: al hacer la muestra de ALONG 2 y luego entrar a Filtros, se volvían a pedir los insumos y los perfiles se definían en dos lados (la IA de la muestra hasta hizo 40 perfiles, uno por entrevista). Ahora la Muestra dice **qué gente se necesita y cuánta**; el filtro, **cómo encontrarla**.

**Qué se construyó:**

- **Perfiles y cuotas en la Muestra** (`PerfilMuestra` en `lib/reclutamiento/muestra.ts`): nombre, quién es, reparto (lo que se reparte dentro del perfil: marcas, ciudades, hombres y mujeres) y cuota. Tabla editable con lo que suman sus actividades («faltan 2», «sobran 3»); cada actividad elige su perfil de la lista. Las muestras de antes sacan sus perfiles de lo escrito en sus actividades (id fijo, cuota = lo que suman).
- **La IA de la Muestra** propone primero los perfiles (agrupados, nunca uno por persona; lo que solo reparte va en «reparto») y luego las actividades; al pedirle cambios conserva el id de cada perfil (`muestraDeLaIA`).
- **El filtro toma los perfiles y los insumos**: al crearlo, el paso de insumos enseña «De la Muestra · se usa sola» (perfiles con cuota e insumos) y no pide subirlos otra vez (`insumosParaFiltro`, sin repetir lo que el filtro ya tiene). La estructura usa exactamente los perfiles de la Muestra (`frentesDeLaMuestra`; los de más se dejan fuera con un supuesto) y cada perfil del filtro queda ligado (`perfilMuestra`). En el filtro, su nombre y cuota se ven «de la Muestra» y no se editan ahí.
- **Cuotas al día solas**: al guardar la muestra, los filtros del proyecto toman nombre y cuota de sus perfiles (`perfilesALosFiltros`: el screener, su copia de trabajo si está en vivo y la estructura del generador; reconoce por liga, por nombre o por el nombre de antes) y los sugeridos del tablero se recalculan con esas cuotas. Agregar o quitar perfiles del filtro sigue siendo con sus preguntas («Comentar» los perfiles).
- **Si el filtro va primero**, la muestra que propone la IA usa los perfiles y cuotas de esa estructura (`proponerMuestraSiNoHay` con perfiles fijos), y quedan ligados al armar la lógica.

**Probado en local (2026-10-26)** en «3 MAYO PRUEBA 3»: «Agrega el perfil Consumidores de la competencia con 4 entrevistas» creó el perfil (cuota 4, reparto «2 hombres · 2 mujeres») y E3–E6; al guardar, los dos filtros de prueba con perfiles de esos nombres quedaron ligados con cuota 10 y 4 (los demás, igual); un filtro nuevo enseñó lo de la Muestra sin subir nada y su estructura salió con exactamente esos dos perfiles y cuotas (la IA avisó que la propuesta decía 8 y 8). 89 pruebas.

**Pendiente:** en ALONG 2 la muestra tiene 40 perfiles (uno por entrevista): pedirle a la IA en Muestra que los agrupe por categoría con las marcas en «reparto».

### Las preguntas escritas quedaban al revés (arreglo, 2026-10-26, `5ed4fa7`)

En la prueba en vivo de ALONG 2, al escribir las preguntas el filtro quedó al revés y «desaparecieron» secciones. Causa: `ponerSeccion` (lib/formularios/generador.ts) acomoda cada sección escrita antes de la primera que en la estructura va después; «Antes de empezar» no está en la estructura y contaba como «al final», así que cada sección caía justo después de ella (en orden inverso al de llegada). Con ese orden hay preguntas que usan otras que van después, el Hub no deja guardar un filtro así y solo se guardó lo primero; al ajustar la estructura, la comparación contra lo que había en pantalla (las mismas secciones, en desorden) decía que nada cambiaba y no salía el botón para escribir. Venía desde que «Antes de empezar» es fija (`301e804`). Arreglo: «Antes de empezar» no cuenta al acomodar; prueba nueva (90). El filtro «SCREENER V1» de ALONG 2 se recuperó con sus 12 secciones ya escritas, en orden y sin volver a gastar IA (versión anterior guardada en sus versiones); al abrirlo, la IA arma la lógica.

### Crear la imagen de una opción con IA (2026-10-26, `172840e`)

Pedido de Sergio: en los selectores con imágenes, poder crear la imagen de una opción con IA a partir de una descripción breve.

**Qué se construyó:** en el menú «⋯» de cada opción de una pregunta con imágenes, «Crear imagen con IA…» abre un campo con el texto de la opción para ajustarlo («frasco de vidrio con tapa de rosca») y «Crear». El servidor la hace con OpenAI (`imagenIA.ts`, modelo `gpt-image-2`, cambiable con `FORMULARIOS_MODELO_IMAGEN`; la cuenta de Anthropic no hace imágenes) y la regresa al editor, que la achica y la sube como cualquier imagen (`crearImagenFormulario`). Siempre genérica: un objeto sobre fondo blanco, sin texto, sin logotipos ni marcas reales; para un logo o un empaque real se sube la imagen. Cuenta para el tope de uso de la IA (acción `imagen`). Tarda unos 10 segundos.

**Probado en local (2026-10-26):** en «Prueba fase 1 · todos los tipos», la opción «Frasco» con «frasco de vidrio con tapa de rosca»: imagen genérica de un frasco con tapa, guardada en la carpeta de imágenes del Hub (39 KB), registrada en el uso.

### La imagen de la opción en los bloques que se repiten (2026-10-26, `5888dfd`)

Pedido de Sergio (prueba de ALONG 2): en los bloques que se repiten por cada opción marcada («Tu aerosol», «Tu difusor»), que la imagen de esa opción salga junto al título, como referencia de qué se pregunta. `CuerpoPantalla` (Participante.tsx) la toma de la opción del bloque (`pantalla.instancia.imagen`): igual en el formulario, en la vista Celular y en el celular junto al documento. Sin imagen, el título se ve como antes.

**Probado en local (2026-10-26):** en «Prueba celular y correo por defecto», «Aerosol (lata que rocías)» con una imagen hecha con IA: el bloque «Tu aerosol» la muestra junto al título.

### «Cambios sin publicar» dice cuáles y qué corregir (2026-10-26, `fbad683`)

En la prueba de ALONG 2, el recuadro de un filtro en vivo decía «Cambios sin publicar · 19 — Corrige lo marcado en el filtro para poder publicarlos» sin decir cuáles ni qué; lo marcado estaba en el aviso rojo «Sin guardar» de arriba a la derecha, que no se veía. Ahora el recuadro (`CambiosEnVivo.tsx`) trae «Ver cuáles» con la lista de cambios y, si algo quedó mal armado, la lista de lo que hay que corregir ahí mismo (cada cosa lleva a su pregunta) con «Deshacer el último cambio» (`ListaPorCorregir`, la misma del aviso de arriba). Probado dibujándolo con datos inventados (sin tocar la base).

### El participante elige la lada del celular (2026-10-26, `37dc415`)

Sergio pidió el código de país para que se pudiera elegir, y salía fijo. Ahora la bandera con la lada es un selector (`campos/Telefono.tsx`): por omisión la del país del filtro, y se puede elegir otra de la lista (`LADAS` en `paises.ts`: los países del Hub más Estados Unidos y España); el ejemplo y cuántos dígitos se piden cambian con ella. Con la lada del filtro se guardan solo los dígitos, como siempre (el tablero, el panel y los duplicados no cambian); con otra, «+57 3123456789» (`guardarTelefono` / `leerTelefono`), y se valida con los dígitos de esa lada. En el documento la pregunta dice «+52 (puede elegir otra lada)». Probado en local: en la vista de celular del editor, elegir Colombia cambia a 🇨🇴 +57 con ejemplo «312 345 6789»; 91 pruebas.

### Hasta cuántas fotos por pregunta (2026-10-26, `d7b030f`)

Pedido de Sergio: más de 3 fotos por pregunta, hasta 10, y que en cada pregunta se diga cuántas (también con la IA). Cada pregunta de foto lleva `maxFotos` (1 a 10; sin él, 3: `maxFotosDe` en `tipos.ts`). El participante ve «Puedes subir hasta N fotos» y puede elegir varias a la vez; el servidor no guarda más de las que pide la pregunta (`submitFormularioRespuesta`). En el editor, la pregunta dice «(hasta N)» y su menú trae «Cuántas fotos puede subir…»; la IA lo pone cuando se le pide (la skill lo conoce en `contrato.md`) y su resumen lo dice («acepta hasta 6 fotos (antes 3)»). El Word dice «(hasta N)». `revisar.ts` no deja más de 10 ni el ajuste en otra pregunta.

**Probado en local (2026-10-26):** en «Prueba fase 1 · todos los tipos», el botón IA con «Que pueda subir hasta 6 fotos» propuso y aplicó «hasta 6»; desde el menú, «hasta 10». 92 pruebas.

### Las fotos se ven en el tablero (2026-10-26, `7c0bd97`)

Sergio: en el tablero las fotos decían «1 foto». Ahora cada pregunta de foto va al tablero como columna «Archivo» (como las fotos de Fillout): la celda guarda la referencia de la foto (`hubfoto:<ruta>`, una lista en JSON si son varias; `lib/formularios/fotoTablero.ts`) y al abrirla el tablero pide un enlace temporal de 10 minutos (`firmarFotosFormulario`, solo con sesión del Hub; `useUrlParaVer` en `components/formularios/urlFoto.ts`, usado por el visor de archivos de `DynamicColumns.tsx`). Las fotos siguen en la carpeta privada: en un enlace compartido del tablero no se ven («Esta foto solo se ve dentro del Hub»). Las columnas que ya existían como texto pasan solas a «Archivo» y las celdas «1 foto» toman su referencia la próxima vez que el Hub pone al día el tablero (al llegar una respuesta, al publicar cambios, al guardar la muestra o con «Buscar duplicados»). Incluye la foto de la identificación de «Antes de empezar». El Excel sigue diciendo «N fotos».

**Probado en local (2026-10-26):** en «ALONG 2 - PRUEBA LUIS», «Buscar duplicados» pasó sus dos columnas de foto a «Archivo» con la referencia, y en el tablero «🖼 Ver imagen» abrió la foto con enlace temporal.

### El correo llena el «Email» del tablero (2026-10-26, `4d5b290`)

Sergio: en el tablero de ALONG 2 no salía el correo. El filtro sí lo pide («Correo electrónico» en «Antes de empezar») y la respuesta llegaba a su columna «Correo», pero el «Email» propio del tablero (el de la fila, como en Fillout, y el que usa la búsqueda de duplicados) quedaba vacío. Ahora `pasarAlReclutamiento` lo llena con la primera pregunta de correo del filtro (`correoDeRespuesta`), y `actualizarTablero` llena el de las filas que quedaron vacías (sin pisar uno escrito a mano). En ALONG 2 se pusieron al día las 5 filas (2026-10-26). La columna «Correo» sigue (se puede ocultar con «Columnas»).

### «Crear grupos y eventos…» pregunta qué y dónde (2026-10-26, `5683932`)

Pedido de Sergio: que siempre pregunte en qué tablero y en qué calendario, y poder crear solo grupos o solo eventos. El botón abre una ventana: casillas para los grupos (cuántos faltan) y los eventos (cuántas actividades con fecha esperan el suyo), con la lista de tableros de Reclutamiento y de calendarios del proyecto (más «Uno nuevo: Calendario de sesiones»). Una vez que la muestra tiene grupos o eventos, su tablero o calendario queda fijo y la ventana lo dice (el avance y los cambios de fecha se leen de ahí). Si se crean eventos sin grupo, al crear después el grupo se liga a su evento. No se manda ninguna invitación.

**Probado en local (2026-10-26):** en «3 MAYO PRUEBA 3», 4 grupos en «FILTRO X» (fijo) y 0 eventos; en ALONG 2, la ventana pide elegir tablero para 40 grupos (se canceló, sin crear nada).

### La dirección completa en una columna del tablero (2026-10-26, `784f60b`)

Sergio: la dirección llegaba al tablero partida en 6 columnas («Dirección · Calle», «· Colonia»…) y el pin de Google Maps del tablero (sale en columnas cuyo nombre dice «dirección») buscaba solo un pedazo. Ahora el tablero lleva una sola columna con la dirección completa como la busca Google («calle número, colonia, CP municipio, estado, país»; `direccionCompleta` en `tabla.ts`); las 6 partes siguen solo en el Excel (`soloExcel`). En los tableros ya ligados, la columna nueva se crea y se llena en las filas que ya estaban al poner al día el tablero (`rellenar`). En ALONG 2 se creó y se llenó (8 filas, 2026-10-26) y, a pedido de Sergio, sus 6 columnas partidas se mandaron a la papelera del tablero (con sus 48 celdas; el dato sigue en cada respuesta y en el Excel).

### Grupos y eventos con para quién es, y un nombre externo sin marcas (2026-10-26, `b34ad7a`)

Sergio: los grupos del tablero y los eventos del calendario van numerados y con el detalle de cada actividad (presencial u online, género, edad, perfil…), y para las vistas externas un nombre «críptico» con género, edad, NSE y modalidad, sin las marcas que se buscan. En la Muestra, cada perfil lleva **Género** (Mujeres, Hombres, Mixto), **Edad** y **NSE**, y cada actividad un recuadro **Modalidad y para quién**: Presencial u Online (sin elegir, online si el lugar dice «En línea») y género, edad y NSE solo si esa actividad es distinta de su perfil (S1 mujeres, S2 hombres). El recuadro enseña cómo se llamarán su grupo y su evento (`detallesDe`, `nombreDeGrupo`, `nombreDeEvento`, `nombreExterno` en `lib/reclutamiento/muestra.ts`):

- Grupo: «V1 · Visita en casa · Presencial · Aerosoles · Mixto 25–55 años · NSE C+ · CDMX». Evento: lo mismo sin el lugar (el evento lo lleva aparte). La fecha ya no va en el nombre del grupo: la cabecera del grupo la toma de su evento.
- Externo: el perfil se cambia por su letra («Perfil A», la de la cuadrita junto a su nombre en la tabla de perfiles): «V1 · Visita en casa · Presencial · Perfil A · Mixto 25–55 años · NSE C+ · CDMX». Se guarda como el «Nombre público» del grupo (`publicName` en `options_json`), que el tablero ya usaba en las vistas externas y deja cambiar a mano.

Al crear grupos se ponen los dos nombres; al guardar la muestra, el servidor renombra los grupos que ya existen cuando cambia lo que los nombra (`nombresAlTablero` en `serverUtils/muestra/muestra.ts`, sin tocar su color ni su evento ligado) y la pantalla, los eventos. La IA llena género, edad y NSE de cada perfil (solo si los insumos lo dicen) y la modalidad de cada actividad.

**Probado en local (2026-10-26):** en «3 MAYO PRUEBA 3» (versión 4), sus 3 grupos y el evento de S1 tomaron el nombre nuevo y el externo, con el evento ligado intacto. 94 pruebas. ALONG 2 no tiene grupos (se quitaron para rehacerlos): sus perfiles aún no tienen género, edad ni NSE.

### Preguntas de siempre: hijos, ingresos, autos y último viaje (2026-10-26, `12b7d2c`)

Sergio: en todos los filtros, al inicio, si tiene hijos, cuántos, de qué edad y si van a escuela pública o privada; y después del NSE, los ingresos del hogar, el último viaje y los modelos y años de sus autos, como en ALONG 2. Las pone el Hub (`conEstandar` en `lib/formularios/estandar.ts`), como el celular y el correo de «Antes de empezar»: son preguntas normales, el analista las corrige o las quita.

- **Al final de la primera sección después de «Antes de empezar»** («Sobre ti»; no una que se repite, sale solo a veces o es de puras indicaciones): «¿Tienes hijos?» (Sí / No) y, solo con Sí, cuántos (número, de 1 a 15), el género y la edad de cada uno (texto, «Por ejemplo: niña de 8 años, niño de 5 años») y si van a escuela pública o privada (Pública, Privada, Unos en pública y otros en privada, No van a la escuela). Ids `familia_hijos…`.
- **Justo después de la última pregunta del NSE**, en su misma sección: ingresos del hogar con los rangos de ALONG 2 (solo en México: van en pesos; el de 80 a 120 mil arranca en 81 mil para no encimarse con el anterior), qué modelos y años de autos tienen (solo si en el NSE dijo que tiene alguno) y su último viaje de placer. Ids `hogar_ingresos`, `hogar_autos`, `hogar_viaje`.
- **Lo que el filtro ya pregunta no se repite:** si alguna pregunta (fuera del NSE) habla de hijos, ingresos, viajes o modelos de autos, esa parte no se agrega. Así una plantilla, un filtro anterior o un Word que ya las traía no queda con dos.
- **Cuándo:** al crear un filtro desde una plantilla o un filtro anterior, al duplicar, y en los que escribe la IA justo antes de armar la lógica (ya con todas las secciones puestas, así la lógica las ve). Cuentan en los minutos de la estructura (alrededor de un minuto más). La skill le dice a la IA que no las escriba, salvo que el estudio necesite más detalle para filtrar (la edad exacta de los hijos para un perfil de mamás); entonces escribe la suya y el Hub no agrega la de él.
- Los filtros que ya existían no cambian solos.

**Puesto a mano en «SCALE - 02 LOLLIPOPS» (FILTRO V1, en prueba, sin respuestas), a pedido de Sergio:** con `conEstandar` y la revisión del editor, revisión 27 → 28, con una versión guardada antes («Antes de agregar hijos, ingresos, autos y último viaje»). En el editor se leen bien: los hijos al final de «Sobre ti» con su «Solo aparece si contestó Sí» y los del hogar después de «NSE · Cuartos». 95 pruebas.

## Decisiones pendientes (las toma Sergio)

| Decisión | Recomendación | Frena |
|---|---|---|
| Modelo de Word | **Resuelto (2026-10-24):** el formato de los filtros del equipo (MALETA D, SED R, LORO); el «ALONG 2 v4» no sirve de modelo porque es el que se armó con IA, con recuadros de colores | — |
| Dominio de Sharpli | **Resuelto (2026-10-26):** `sharpli.mx`, apuntado por Sergio en GoDaddy y agregado en Render | — |
| Aviso de privacidad | Ya va el de AGC dentro del formulario; falta que legal agregue las fotos de identificación, su revisión con IA y el plazo | — |
| Cómo reconocer a la misma persona | **Resuelto (2026-10-24):** la misma búsqueda de los tableros (2 de 3 iguales entre nombre, correo y celular) y, entre filtros, el celular | — |
| Quién entra a la base | **Resuelto (2026-10-24):** todo el que contesta queda en Filtros; al tablero pasa en automático quien entra a un perfil con lugar; los demás, a mano | — |
| Buscar gente en varios filtros anteriores | «Buscar en la base» con los atributos comunes (edad, NSE, ciudad, marcas…) y la biblioteca | Fase 6 |
| Reclutamiento por técnica | Bocetos (2026-10-26), con el principio «el Hub ordena y sugiere, la persona decide»: **muestra que cambia** (arranca de la propuesta y el kick-off, cada cambio con quién y por qué, nunca mueve ni borra gente: quien queda sin sesión regresa a «Por asignar»; opcional); **tres bandejas en Filtros** (Candidatos sin motivos, Casi con un motivo y rescatables, No entran con dos o más o lo que no se negocia: aviso, identificación, giro), con los **sugeridos marcados** por perfil hasta lo que falta y «Pasar N al tablero» con un clic; **paso automático como opción apagada** (manda a los primeros, no a los mejores); tablero agrupado por técnica y sesión con «Por asignar», titular/reserva y 6 estatus; ficha de la persona igual en Filtros y el tablero. Orden propuesto: bandejas y sugeridos → ficha → muestra → tablero. **Cambio de Sergio (2026-10-26):** los coordinadores no deben revisar en dos lugares ni abrir a cada persona: **todas las respuestas caen al tablero** (como con Fillout) y la calificación va **en columnas del Hub** (Califica: Candidato/Casi/No entra · Perfil · Motivo · IA · Sugerido), sin vistas rápidas arriba (cortan la lectura vertical del tablero, dijo Sergio): son **columnas normales del tablero**, que se filtran, ordenan y guardan en vistas como cualquier otra, y se trabajan con las acciones sobre varias filas; quien cae en **varios perfiles** los lleva todos en «Perfil» (el filtro de la columna lo encuentra por cualquiera), la IA opina por cada uno y el Hub lo **sugiere para uno solo**: el que más falta le hace, y si empatan, donde mejor encaja; así **cuenta una sola vez** en las cuotas (hoy cuenta en cada perfil: en «ALONG 2 - PRUEBA LUIS» una respuesta salía como «2 de 40»); al moverlo a una sesión, cuenta en el perfil de esa sesión; **la muestra sabe quién va a cada actividad por los grupos del tablero**: cada actividad (S1, T1, E1…) es un grupo del tablero (con su id, no por el nombre; los grupos ya se ligan a su evento del calendario con `linkGroupToEvent`), crear una actividad crea su grupo y se pueden ligar los grupos que ya existen; mover a alguien a ese grupo lo asigna; la muestra lee el tablero, no guarda su propia lista de personas; si alguien va a dos actividades, se duplica su fila (`duplicateRows`) y cuenta en las dos; **flujo simple que pidió Sergio (2026-10-26):** se define la muestra y desde ahí se crean de un jalón los grupos del tablero y sus eventos en el calendario, ya ligados (el tablero muestra el horario en cada grupo con `getLinkedEventsInfo`); sin mandar invitaciones solas; cambiar la fecha de una actividad actualiza su evento; quitarla regresa a su gente y deja el evento para cancelar; **dónde vive (propuesta):** en Reclutamiento, como primera pestaña («Muestra») antes de los tableros: es del proyecto, no de un filtro (puede haber varios filtros, o gente que no llega por filtro), y ahí trabajan quienes reclutan; **de dónde sale:** la propone la IA con los mismos insumos del filtro (propuesta, notas, kick-off), en el mismo paso de la estructura, como borrador con sus supuestos; el analista la revisa y la aprueba, y solo entonces se crean grupos y eventos (las actividades sin fecha esperan); sin IA, se llena a mano; los perfiles son los del filtro y sus cuotas se suman de la muestra; **propuesta de arquitectura (2026-10-26):** una sola pestaña Reclutamiento con tres partes en el orden del trabajo, Muestra · Filtros · Participantes (los tableros), y Filtros regresa adentro (hoy es pestaña aparte); en el inicio del proyecto, el widget de Reclutamiento con dos bloques, Filtro (estado, respuestas y candidatos nuevos) y Participantes (lugares cubiertos contra la muestra y la próxima actividad con cupo), en vez de conteos por tablero y grupo; bocetos de las dos cosas (2026-10-26): arriba de Reclutamiento, tres tarjetas en fila con su estado (Muestra: técnicas, lugares y versión; Filtros: en vivo, respuestas, nuevas hoy; Participantes: cubiertos y tableros); en Participantes, las pestañas de tableros y los grupos con su actividad, horario del evento, perfil y avance; el widget con Filtro (respuestas, candidatos, sugeridos sin revisar) y Participantes (cubiertos, por técnica y la actividad más urgente); orden propuesto: 1) Reclutamiento en tres partes con Filtros adentro, 2) columnas del Hub en el tablero, 3) muestra con IA que crea grupos y eventos, 4) widget; **espacio en pantallas de 13" (2026-10-26):** medido a 1366 × 650 la primera persona aparece a 392 px (60 % del alto se va en encabezados, pestañas, botones en dos líneas y vistas) y caben unas 8; propuesta: dos barras de 36 px (proyecto con sus pestañas en una línea y «Más ▾»; Muestra y Filtros como pestañas chicas con su número, los tableros y a la derecha buscar, filtros, vista, «⋯» con lo demás y pantalla completa), unas 15 personas; (la idea de pantalla completa se descartó: Sergio prefiere rediseñar en lugar de sumar funciones); **rediseño de los botones del tablero** con datos de uso: vistas guardadas (447 en 79 proyectos, 227 en 3 meses) y Compartir (376 enlaces, 193 en 3 meses) se usan mucho; crear tablero desde Excel, 3 de 334 tableros, y el botón estaba dos veces; propuesta en una sola línea: Buscar, Filtros, la fila de vistas se queda completa a la vista (Sergio: «eso no puede cambiar»), Columnas, el filtro vinculado con su estado de sincronización en un solo botón, Compartir, Exportar ▾ (Excel, CSV, por grupos) y «⋯» (Status con IA, buscar en otros proyectos —antes «Verificar duplicado»—, Importar Excel, Papelera); se quita el modo compacto, que ya no hace falta; unas 13 personas a la vista; Sergio aprobó lo demás; las tarjetas grandes de Muestra, Filtros y Participantes se descartan por espacio; se quitó «Definir muestra» (botón y ventana; los datos de los 30 proyectos que la tenían siguen guardados y el análisis «Status» los sigue leyendo, pero ese botón solo sale si el proyecto tiene esa muestra vieja); lo que el equipo cambie a mano no se pisa; Filtros queda para diseñar y como resumen. Boceto del tablero con esas columnas: espera su visto bueno | Rediseño de Reclutamiento |
| Países del NSE para arrancar | México ya está (AMAI 2022, confirmada); falta el siguiente con estudio en puerta | — |
| Columnas al tablero | Todas, con una vista de solo las clave | — |
| Imágenes de conceptos confidenciales | Caso por caso | — |
| Pagos, agendar citas y registros de otra base | Fuera hasta que se pidan | — |
| A quién se abre en la fase 6 | Primero a quien tiene Swipe | — |

## Bitácora

- **2026-10-21/22 · versión inicial:** formularios en Tools, página pública, motor, panel, Excel, vínculo con Reclutamiento (todas las columnas desde que se vincula) y el screener de ALONG 2 como plantilla. Se diseñó el feature completo (documento de diseño) y se escribió esta guía.
- **2026-10-22 · fase 1 (base del screener):** contrato versión 2 con todos los tipos de la fase 1, una o varias dicho por el tipo, país y NSE por país como alerta, revisión de definiciones, formulario en neutros, panel con NSE distinto y plantilla de prueba con todos los tipos. Con el cuestionario oficial que pasó Sergio se cargó la AMAI 2022 (cortes nuevos, redacción oficial) como regla vigente de México; 36 pruebas. Probado en local de punta a punta. Subido a `main` con el OK de Sergio (`3d5bbfd`).
- **2026-10-22 · fase 2 (editor):** el filtro abre como documento, con la lógica en palabras y el mapa del flujo al lado, y tiene la vista Celular para contestarlo sin guardar. Se corrige a mano: textos, opciones, imágenes arrastradas o pegadas (a una carpeta pública y achicadas), tipos, «mostrar solo si», qué termina o descarta, y nombre y cuota de los frentes. Tiene deshacer, versiones, aviso de otra ventana o persona sin pisar cambios, y los minutos contra el tope de 10. El panel quedó con «Ver» y en tarjetas en pantallas angostas. En la base, la tabla `formulario_versiones` y las columnas `revision` y `editando` (con el OK de Sergio). 50 pruebas. Probado en local y subido a `main` con el OK de Sergio (`40d801f`).
- **2026-10-22 · fase 3 (generador con IA):** cuatro puntos de partida (insumos, Word, filtro anterior, plantilla); insumos con PDF, PowerPoint, Word, notas y reuniones de Notetaker; estructura con frentes, embudo, minutos y supuestos, que se ajusta con un comentario; preguntas escritas de tres en tres que aparecen en el documento al llegar; lógica final de frentes, alertas y textos; botón IA en cada pregunta y Comentar en cada sección y en los frentes, con la propuesta antes de aplicarla; cambiar la estructura de lo escrito conservando lo que no cambia; tope de uso por hora. Reglas en una skill con ALONG 2, DOPAMINA y LORO sin marcas. En la base, `formularios.generador` y `formulario_ia_uso` (con el OK de Sergio). 63 pruebas. Probado en local de punta a punta y subido a `main` con el OK de Sergio (`f450a2f`).
- **2026-10-22 · arrastrar y soltar:** a pedido de Sergio, los insumos del generador (Word, PDF, PowerPoint) se arrastran y sueltan en un recuadro (o en cualquier parte del paso), y la foto del participante también se puede soltar sobre su recuadro en computadora.
- **2026-10-22 · errores de la IA en palabras:** en el primer uso en producción la cuenta de Anthropic se quedó sin saldo y el generador solo decía «Error interno». Ahora dice el motivo (sin saldo, llave, saturada, sin conexión), las llamadas que no llegan a la IA no cuentan para el tope, y al primer error de una sección deja de pedir las demás y ofrece «Reintentar lo que falta». 64 pruebas.
- **2026-10-23 · ajustes tras el primer uso (tanda 1):** «perfiles» en vez de «frentes» en todo lo que se ve; nombre corto por pregunta (columna del tablero, Excel y panel), escrito por la IA y con «Ponerlos con IA» para lo que ya existe; las columnas del tablero se renombran solas sin pisar las que cambió el equipo; tiempo por perfil; estados Borrador › Prueba › En vivo con su explicación y la lista «¿Está listo?». 70 pruebas. Probado en local y subido a `main` con el OK de Sergio (`a69aa21`).
- **2026-10-23 · flujo como diagrama y menos botones (tanda 2):** con los bocetos aprobados por Sergio: el Flujo es un diagrama de proceso con ramas, salidas en rojo y bloques que se repiten; las herramientas de cada pregunta solo aparecen al elegirla; encabezado con los pasos del estado, una línea de estado y un solo menú «⋯». 71 pruebas. Probado en local y subido a `main` con el OK de Sergio (`e823da6`).
- **2026-10-23 · celular, correo y dirección más finos:** lada y largo del celular por país, sugerencia del correo mal escrito, «Busca tu dirección» con Google y dirección por código postal lista para cuando haya catálogo (tabla `codigos_postales` creada, vacía). 75 pruebas. Probado en local con respuestas simuladas.
- **2026-10-23 · preguntas con imágenes:** se guardan aunque falten imágenes (pendiente en «¿Está listo?»), se puede pegar el enlace de una imagen (el Hub guarda su copia) y la IA ya puede cambiar a selector con imágenes. 76 pruebas. Probado en local y subido a `main` con el OK de Sergio (`0dd8ff3`).
- **2026-10-23 · conexión cortada:** el primer filtro con insumos de Sergio en producción se quedó esperando: Render reinició el servidor (por una subida) a media propuesta de estructura y la pantalla no se enteró. Ahora, si una llamada larga (las de la IA) se corta sin terminar, `callStreaming` en `zite-endpoints-sdk.ts` avisa «Se cortó la conexión con el servidor antes de terminar. Vuelve a intentarlo.» (sirve para todo el Hub). Probado simulando el corte en el navegador. Lección: subir cambios mientras alguien usa la IA le corta la llamada.
- **2026-10-23 · Detener, borrar y duplicar:** «Detener» mientras la IA trabaja (estructura por cualquier vía, escritura de secciones y lógica, botón IA de una pregunta, comentarios y nombres cortos): el navegador cierra la conexión, el servidor se entera (`StreamWriter.signal`, con `stream.onAbort` en `server/index.ts`) y corta la llamada a Anthropic, así deja de gastar; lo ya escrito se queda y la escritura se retoma con «Seguir escribiendo». Cada filtro de la lista tiene «⋯» con Duplicar y Borrar (borrar solo si no tiene respuestas reales, con confirmación); dentro del filtro, «Duplicar» en el menú «⋯». Duplicar copia el screener y lo de la IA (estructura, supuestos e insumos, con sus PDF copiados a la carpeta de la copia) como borrador nuevo del mismo proyecto, con enlace propio, sin respuestas ni tablero; se abre sola. Probado en local: duplicar el filtro del café (con su PDF) y detener un ajuste de estructura a los 7 segundos (la llamada quedó cerrada sin respuesta). 76 pruebas. Subido a `main` con el OK de Sergio (`edcab41`).
- **2026-10-23 · revisar la estructura sin subir y bajar:** a pedido de Sergio, la estructura (la propuesta después de leer los insumos, o la de un filtro escrito) tiene vista **Lista | Flujo**. El Flujo es el mismo diagrama del editor pero armado desde la estructura (`filasFlujoDeEstructura`: lo que aparece si aplica, en ramas según de qué depende —el nuevo campo `segun` de la estructura—; dónde termina, de la lógica en una línea). Cada sección y los perfiles tienen «Comentar»: el comentario se guarda en la pantalla (en el flujo, la caja se marca en ámbar; un clic en una caja lleva a su comentario) y abajo, en una barra fija, «Pedir los N cambios» los manda todos juntos a la IA en un solo ajuste (cada uno tarda minutos), con el comentario general si lo hay. Aprobar se desactiva mientras haya comentarios sin mandar. Probado en local con la copia del café (flujo, comentar desde el flujo, marca en ámbar, quitar; en celular sin desplazamiento a lo ancho). 77 pruebas. Subido a `main` con el OK de Sergio (`77c86c5`).
- **2026-10-23 · aviso, «Antes de empezar» e identificación:** el aviso de privacidad de AGC (de su Word, guardado en Storage) se lee dentro del formulario; todo filtro nuevo o duplicado arranca con «Antes de empezar» (aviso, nombre e identificación; quien no acepta o no da la foto termina), fija en el editor y fuera del alcance de la IA; y la foto de la identificación la lee la IA al recibir la respuesta y lo que no cuadra con el nombre, la edad o el lugar sale como alerta (unos 0.3 centavos de dólar por persona). 79 pruebas. Probado en local y subido a `main` con el OK de Sergio (`301e804`).
- **2026-10-24 · el celular junto al documento:** a pedido de Sergio, en pantallas anchas la vista Documento lleva al lado un celular con la parte donde se hizo clic (bienvenida, sección o final), con todas sus preguntas aunque dependan de respuestas anteriores, y marca la pregunta elegida. 80 pruebas. Probado en local y subido a `main` con el OK de Sergio (`aa3dec3`).
- **2026-10-24 · fase 4: Word y PDF para el cliente:** con el encabezado de Sapience, la muestra en tabla, una franja por sección y cada pregunta en un recuadro (CONTINUAR / TERMINAR, notas en azul), desde el menú «⋯» del filtro; cada descarga queda en Versiones. Todo en Montserrat, opciones en 8 pt. 81 pruebas. Probado en local y subido a `main` con el OK de Sergio (`9b8e584`).
- **2026-10-24 · matrices como tabla:** en el celular del participante la matriz se ve como tabla (círculos o cuadros en cada cruce), se desliza de lado con los renglones fijos si no cabe y marca en rojo el renglón que falta. Probado en local y subido a `main` con el OK de Sergio (`6c14519`).
- **2026-10-24 · «En vivo»:** «Abrir en vivo» con confirmación; el formulario ya no dice «Prueba», lo que entra cuenta como real y «Borrar pruebas» no lo toca; con respuestas reales solo se cierra o se reabre en vivo. Probado en local y subido a `main` con el OK de Sergio (`90cadec`).
- **2026-10-24 · rediseño del flujo:** con los bocetos aprobados por Sergio: un solo camino de 5 pasos con un botón por paso, «Por revisar» en un chip, modos Diseñar y Reclutar (enlace, tablero y cuotas con barras), preguntas numeradas y lógica en etiquetas, el celular sigue la lectura, «Filtros» en todo y la lista con el paso de cada filtro; en vivo se edita una copia y se publica con «Publicar cambios» (columna `formularios.cambios`, creada con su OK). 81 pruebas. Probado en local y subido a `main` con el OK de Sergio (`2d4c4d6`).
- **2026-10-24 · fase 5 (operación):** nadie se corta por defecto (se registran todos los motivos; «cortar» a petición, y siempre el aviso y la identificación); al recibir una respuesta, historial y duplicados con la búsqueda de los tableros, paso solo al tablero en vivo para quien entra a un perfil con lugar (con su historial en notas) y clasificación con IA (medio centavo de dólar por persona); traer a quienes contestaron un filtro anterior; pestaña Filtros junto a Reclutamiento y filtros del Hub en «Vincular form». 83 pruebas. Probado en local y subido a `main` con el OK de Sergio (`0bd0d7d`).
- **2026-10-24 · negritas y color:** a pedido de Sergio, los textos que lee el participante (pregunta, ayuda, contenido, entrada de sección, bienvenida y despedidas) llevan negritas y un color para resaltar, con botones en el editor; se ven igual en el formulario, el celular y el Word/PDF, y salen sin formato en el tablero, el Excel y el flujo. 84 pruebas. Probado en local y subido a `main` con el OK de Sergio (`35be0b0`).
- **2026-10-26 · celular y correo por defecto:** «Antes de empezar» los pide después del nombre (si el filtro no los pide ya), como preguntas que el analista puede corregir o quitar; la IA ya no los repite. 84 pruebas. Probado en local y subido a `main` con el OK de Sergio (`3a538a3`).
- **2026-10-26 · Reclutamiento, paso 1:** Filtros adentro de Reclutamiento, pestañas del proyecto en una línea con «Más», barra del tablero en una línea (Exportar y «⋯» como menús) y sin «Definir muestra»; de 8 a 12 personas a la vista en una pantalla de 13". Probado en local y subido a `main` con el OK de Sergio (`72c5e64`).
- **2026-10-26 · Muestra:** Reclutamiento con Muestra · Filtros · Participantes; la muestra del proyecto con versiones, propuesta de la IA, y grupos y eventos creados y puestos al día desde ahí (sin invitaciones). Tablas `muestras` y `muestra_versiones` creadas con su OK. 85 pruebas. Probado en local y subido a `main` con el OK de Sergio (`72c5e64`).
- **2026-10-26 · columnas del Hub y widget:** todas las respuestas llegan al tablero y ahí se califican (Califica, Perfil, Por qué no califica, IA, Sugerido), al día sin pisar lo que cambia el equipo; sugeridos por perfil contra la muestra; el widget del inicio con Filtro y Participantes. 86 pruebas. Probado en local y subido a `main` con el OK de Sergio (`225b46f`).
