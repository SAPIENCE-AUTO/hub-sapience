# Buscar gente (el buscador del reservorio) — guía

Guía viva del **buscador de gente**: la pantalla «Buscar gente» (Operación) donde el equipo de reclutamiento pregunta «¿en qué filtros hay consumidores de Corona?» o «¿rechazadores de Levité?» y ve en qué tableros
se preguntó, **cómo se preguntó** y qué contestó la gente. Quien trabaje en esto: léela entera y actualiza la «Bitácora» al terminar.

## Qué se pidió

Sergio (2026-11-11), de parte del equipo de reclutamiento: «un tool donde puedan preguntar “en qué proyectos o filtros podemos encontrar consumidores de corona” o “rechazadores de levité” y que les dé en qué filtros
(formularios) están, para poder vincularlos». Y, después de ver una primera propuesta: un módulo **independiente, agnóstico a cada tablero** (un reservorio de información, no una herramienta de un proyecto); que cada
sugerencia diga **por qué** está ahí (cómo se preguntó: ranking de marcas, frecuencia de consumo, última compra…); **búsquedas guardadas** («corona lovers», «victoria lovers») que se consultan y se actualizan para buscar
en filtros nuevos; y **detalles opcionales** al pedir una («que la consuman x veces por semana», «que sea su marca favorita»).

## Cómo están guardadas las preguntas (medido el 2026-11-11, solo lectura)

- En los tableros viejos (Fillout) **todo es texto**: de unas 23 mil columnas de los 347 tableros de reclutamiento, casi todas son `Texto` y solo 177 traen opciones. El nombre de la columna **es la pregunta**.
- Una pregunta «de matriz» es **una columna por marca**: «Takis (Priorización marcas)», «Levité (Priorización marcas)». La respuesta es la opción de la escala: «Es mi top / favorita», «Es de mis opciones principales»,
  «La consumo a veces», «No me gusta / no la compro», «La dejé de consumir hace 6 meses o más». Es decir: **«consumidores» y «rechazadores» son literalmente una opción de respuesta**, y la marca está en el nombre de la columna.
- Un ranking o una selección múltiple es **una lista en un solo texto**, separada por coma o por salto de línea («Corona Cero, Modelo Cero, Heineken 0.0»), y a veces escrita a mano («1 corona A\n2 dos X b»). El orden importa:
  la primera es la favorita.
- Las respuestas están en `recruitment_rows.cell_data` (texto JSON: id de la columna → `{ textValue }`). Leerlas es rápido por tablero (unos 0.9 s por tablero); leer `cell_values` por columna es lentísimo (no se usa).
- Los filtros del Hub (pocos todavía) también terminan como columnas de tablero cuando se vinculan (`asegurarColumnas`), así que el catálogo los cubre por su tablero.

## Cómo funciona

1. **Catálogo** (`src/serverUtils/busqueda/catalogo.ts`, botón «Actualizar» o `actualizarCatalogoBusqueda`, que transmite el avance): de cada tablero de reclutamiento vivo con filas, una consulta en la base (no trae filas de personas)
   devuelve de cada pregunta cuántas filas respondieron y las respuestas que se repiten. Si la pregunta tiene pocos textos distintos y cada uno se repite (opciones), se guardan los **textos enteros** («valores»);
   si cada quien escribió lo suyo, el texto se parte en **piezas** por coma, punto y coma, salto de línea o barra («lista»), con en cuántas filas sale cada pieza y cuántas veces es la **primera**. La regla está en `modoDeColumna`
   (`src/lib/busqueda/texto.ts`) y en la consulta (deben coincidir). Solo lee los tableros; solo escribe las tablas del buscador. Lee de nuevo únicamente lo que cambió (por `updated_at` de filas y columnas) y quita lo que ya no existe.
2. **Privacidad por diseño (reforzada tras auditar el primer catálogo real, 2026-11-11):**
   - No se leen las columnas que son datos de una persona o nombres de personas: nombre, teléfono, correo, dirección, identificación, aviso de privacidad…, y también «NR», «Reclutador», «Quién te invitó» y las que dicen «escribe tu dirección» (`esColumnaPersonal`: por el
     **comienzo** del nombre de la columna, sin los «¿» del principio, más unas frases). Tampoco las que no son preguntas (archivos, ligas, fechas, personas, botones: `TIPOS_DE_PREGUNTA`).
   - Aunque una columna tenga un nombre inocente, a veces trae datos de una persona: una importación desalineada puso correos en «Ocupación», alguien escribió su teléfono donde iba el nombre de quien lo invitó, y hay columnas con identificadores de Monday de once dígitos.
     Por eso una **respuesta** que parece un correo, un teléfono o un número largo (7 o más dígitos en una pieza), una liga o un usuario de red, o una clave tipo CURP o RFC **no se guarda** (`esPiezaPersonal`; en una lista se revisa pieza por pieza, así que «355 ml, 600 ml, 1 l» sí pasa).
   - Y una respuesta que dieron menos de `MIN_FILAS_POR_PIEZA` (3) filas no se guarda, así que nada identifica a una sola persona. Se guardan hasta 100 respuestas por pregunta.
   - La auditoría del primer catálogo real (solo lectura, con las respuestas enmascaradas) encontró 4 correos, 7 teléfonos en la columna «NR», identificadores de Monday y unas 280 preguntas de nombres de reclutadores o de direcciones: se limpiaron y se volvió a leer todo con
     las reglas nuevas. Después de cualquier cambio a estas reglas hay que releer todo (`actualizarCatalogo({ forzar: true })`) y volver a auditar.
3. **Búsqueda** (`src/serverUtils/busqueda/buscar.ts` + `src/lib/busqueda/agrupar.ts`): el término se normaliza (sin acentos ni mayúsculas) y se busca en el **nombre de las preguntas** (grupo «columna») y en **lo que respondieron**
   (grupo «respuesta»). Lo hallado se junta por «cómo se preguntó»: el nombre de la pregunta con el término tapado («levité (priorización marcas)» → ««…» (priorización marcas)»), así que la misma pregunta de muchos tableros es un grupo.
   En un grupo «columna» la persona marca qué respuestas le sirven («No me gusta / no la compro») y ve cuántas filas cumplen en cada tablero; en un grupo «respuesta» ve cuántas filas lo mencionan, y puede pedir solo las que lo ponen primero
   (la favorita). Responde al instante (solo lee el catálogo).
4. **Se cuentan filas de los tableros, no personas distintas** (una persona puede estar más de una vez en un tablero). Contar personas distintas se hace en vivo, solo sobre los tableros candidatos (pendiente).

## Medido con la base real (ensayo del 2026-11-11, sin escribir nada en producción)

Se leyó TODA la base con el código real (cada tablero en una transacción de solo lectura) y el catálogo se guardó en una base en memoria, donde se corrieron las búsquedas de verdad:

- 327 tableros de reclutamiento con filas (103,255 filas); el catálogo salió en **275 s** (0.84 s por tablero; el más lento, 3.7 s; ninguno falló) con **18,813 preguntas y 125,500 respuestas**, unos **24 MB** en las tablas. Las búsquedas tardaron de 16 a 45 ms.
- Las preguntas que ya existen para una marca son justo las dimensiones que pidió Sergio: para una marca de cerveza hay «Consumo» (cuántos años la consume), «Relación» (de «me gusta el producto y me encanta su publicidad» a «no me gusta ni el producto, ni su publicidad»), «Frecuencia»
  (de «una vez a la semana» a «no consumo …») y «Comercial» (qué anuncio recuerda); para botanas y yogur hay matrices de «Priorización marcas» con «Es mi top / favorita» y «No me gusta / no la compro»; para agua saborizada, listas de «Marca favorita» y «Marcas preferentes».
- Límites que se vieron: la misma pregunta escrita distinto en cada tablero queda en grupos distintos («Top 5 marcas CERVEZA», «Top 5 Cervezas», «Marcas Cerveza»); una marca poco preguntada sale en pocos tableros (la de agua saborizada, en tres); y con palabras muy comunes se muestran los 40 grupos con más filas.

## Dónde vive

- Base (aditiva, `server/scripts/add-busqueda-tables.ts`, **no se ejecuta sola: pide el sí de Sergio antes de correrla en producción**): `busqueda_tableros`, `busqueda_columnas`, `busqueda_piezas`, `busquedas_guardadas` (SQL en `src/serverUtils/busqueda/almacen.ts`).
- Endpoints: `getCatalogoBusqueda` (cuántos tableros, preguntas y respuestas hay y de cuándo), `buscarGente`, `actualizarCatalogoBusqueda` (streaming, una sola actualización a la vez). Acceso: toda la organización, igual que Filtros (`exigirAccesoFormularios`).
- Pantalla: `src/pages/BuscarGentePage.tsx` y `src/components/buscador/GrupoResultado.tsx`, en `/operacion/buscar-gente` (menú Operación → «Buscar gente»).

## Pruebas

`node server/node_modules/.bin/tsx server/scripts/test-busqueda.ts` (26): el texto (normalizar, partir listas, tapar el término, columnas y respuestas personales, modo de columna), el agrupado, y contra PGlite con el esquema real y tableros inventados: matriz de marcas, ranking
en lista con el conteo exacto de «primera», opciones con coma que no se parten, columnas personales que no entran (nombre, teléfono, dirección, reclutadores), un correo repetido y un identificador de once dígitos que no se guardan aunque la columna tenga nombre inocente, filas y columnas borradas, respuestas con pocas filas, tableros que no son de reclutamiento o sin filas, un tablero con datos rotos que
no detiene a los demás, búsqueda sin acentos, comodines, y actualizar solo lo que cambió.

## Pendiente (en este orden)

1. Crear las tablas en producción (con el sí de Sergio) y correr la primera lectura de los tableros.
2. **Búsquedas guardadas** («corona lovers»): nombre, criterios, de dónde sale cada resultado, foto del último resultado y «Actualizar» (que lee los tableros nuevos y dice qué se agregó). La tabla `busquedas_guardadas` ya viene en el script.
3. **Detalles opcionales** («que la consuman x veces por semana», «que sea su marca favorita»): cumplir dos criterios dentro del MISMO tablero necesita respuestas por persona, no solo conteos por respuesta; se cuenta en vivo solo sobre los tableros candidatos que marca el catálogo,
   y los tableros que no preguntaron eso salen aparte como «no se puede comprobar».
4. **IA al armar el catálogo (no al buscar):** etiquetar una vez cada pregunta y cada opción (marca o categoría; tipo de pregunta: conocimiento, consumo, frecuencia, última compra, favorita, ranking, rechazo; relación de la opción: favorita, principal, ocasional,
   rechaza, dejó de consumir) para explicar mejor el porqué y juntar preguntas escritas distinto. Cuesta dinero y toca la cuenta de Anthropic: pedir el sí de Sergio antes de la primera corrida. Buscar sigue funcionando sin IA.
5. «Vincular»: llevar a las personas de los tableros elegidos a un proyecto (traer solo a quienes cumplen, con la elegibilidad por cliente y el consentimiento). Es un paso aparte: el buscador no depende de ningún proyecto.

## Bitácora

- **2026-11-11:** primera versión (catálogo, búsqueda, pantalla) construida con pruebas (26), ensayada contra la base real sin escribir nada (ver arriba) y probada en el navegador con resultados inventados. Con el sí de Sergio se crearon las tablas en producción y se leyeron los tableros por primera vez; la auditoría de privacidad encontró datos personales sueltos y se reforzaron las reglas (ver «Cómo funciona»).
