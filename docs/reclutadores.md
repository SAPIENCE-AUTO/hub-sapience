# Estadística por reclutador — guía

Guía viva de la vista **Indicadores → Por reclutador** (solo Sergio, igual que el resto de Indicadores: `exigirAccesoIndicadores`). Quien la toque:

1. Lee esta guía y las definiciones antes de cambiar una cifra: las usa la pantalla y el servidor, y deben seguir siendo las mismas.
2. Si cambia lo que se guarda en el cálculo (`DatosReclutadores`), conserva los campos que lee la versión anterior de la pantalla, o guarda el cálculo nuevo antes de publicar.
3. Al terminar, actualiza la «Bitácora».

## Qué resuelve

La pregunta **NR** («nombre de quien te invitó») está en casi todos los filtros y tableros de reclutamiento (columna `NR`, `Reclutador` o `Nombre Reclutador`). Con ella se mide, por reclutador, cuántas de sus respuestas son de gente **nueva** y cuántas de gente que **ya había llenado otro filtro**. El nombre lo escribe cada participante («manuel», «manel», «manu»), así que la misma pantalla sirve para **juntar** esas formas bajo un reclutador y ver cómo cambian los números al momento.

## Definiciones (no cambiar sin avisar)

- **Respuesta:** una vez que alguien llenó un filtro. Las copias de la misma respuesta en varios tableros (el mismo Fillout vinculado a varios) cuentan **una vez** (`src/lib/respuestaFillout.ts`: el id de respuesta es lo que va después de la última barra de `source_form`). Una fila sin ese id (capturada a mano, de Excel) es una respuesta aparte.
- **Persona:** la identidad de `getGlobalIdentityData` (2 de 3 datos iguales entre correo, teléfono y nombre).
- **Nueva:** la persona no tenía respuestas en un proyecto anterior. **Repetida:** ya tenía una; se cuenta en cuántos proyectos anteriores distintos (1, 2, 3 o 4 o más). El orden es el de la fecha de inicio del proyecto (la misma regla de `Indicadores → Reclutamiento`); las respuestas del mismo proyecto que la primera cuentan como nuevas (pasos del mismo reclutamiento). Un proyecto que aún no empieza no cuenta; uno sin fecha se anota en `sinFecha`.
- **Contacto compartido:** una «persona» con 5 o más respuestas y 3 o más nombres distintos (`MIN_RESPUESTAS_COMPARTIDO`, `MIN_NOMBRES_COMPARTIDO` en `serverUtils/indicadores/reclutadores.ts`) es casi seguro un correo o teléfono que usa quien recluta en campo para llenar por varios participantes. Sus respuestas no cuentan como nuevas ni repetidas (si no, 1 nueva y 79 repetidas); salen en su propia columna. En 12 meses son cerca del 13 % de las respuestas con nombre.
- **Periodos:** `12m`, `6m`, `anio`, `todo`, contra la fecha de inicio del proyecto de cada respuesta.
- El nombre de la respuesta es el de su copia más antigua que lo trae. «Sin nombre»: vacío, una letra, «nadie», «no sé», un canal («instagram»): `esSinNombre` en `src/lib/indicadores/reclutadores.ts`.

## Cómo funciona

- **Contar** (`calcularReclutadoresEstadistica`, transmite el avance por SSE; tarda de 1 a 2 minutos y no se puede lanzar dos a la vez):
  1. `leerNombresReclutador`: busca en los tableros vivos las columnas `nr`, `reclutador`, `nombre reclutador` o `quién lo invitó` y lee el nombre de **`recruitment_rows.cell_data`** (`cell_data::jsonb -> <id de columna> ->> 'textValue'`), tablero por tablero y de a 3. **No** se lee de `cell_values`: ahí falta el nombre en la mitad de las filas (importaciones viejas) y consultarlo por columna tarda minutos (el índice `(board_id, row_id, column_id)` no se puede saltar `row_id`). Donde las dos fuentes existen, coinciden.
  2. `calcularReclutadores` (puro): cuenta sobre `getGlobalIdentityData` y guarda, por **forma de escribir el nombre** (ya sin mayúsculas, acentos ni signos: `normalizarNombre`), los conteos de cada periodo: `[total, nuevas, repetidas con 1, 2, 3 y 4+ proyectos antes, contacto compartido]`.
  3. Se guarda en `indicadores_calculos` (área `reclutadores`), que ya existe (la creó `add-indicadores-tables.ts`).
- **Juntar** (`saveReclutadorAsignacion`, `saveReclutador`, `deleteReclutador`): dos tablas, creadas por `server/scripts/add-reclutadores-tables.ts` (el SQL está en `SQL_TABLAS_RECLUTADORES`, también lo usan las pruebas): `reclutadores(id, nombre)` y `reclutador_alias(clave → reclutador_id | ignorar)`. Una asignación vale hacia atrás y hacia adelante: es una suma sobre lo ya contado por forma de escribir el nombre, así que **no hace falta volver a contar** al juntar (`repartir` en `src/lib/indicadores/reclutadores.ts`, en el navegador).
- **Sugerir** (`sugerirGrupos`, `podrianSerLaMisma`, en el navegador): las formas más usadas dan nombre a un grupo y se les suman las parecidas (prefijo: «manu» con «manuel»; una letra de diferencia desde 5 letras, o desde 3 si el apellido es idéntico; una inicial con el mismo apellido: «j salgado» con «julia salgado»). Una forma que cabe en dos grupos viene **marcada como dudosa** y sin marcar. Solo sugiere: la confirmación es de quien juntó (por ejemplo, no junta «jsalgado» con «julia salgado»).
- **Pantalla** (`src/components/indicadores/PorReclutador.tsx` y las tablas, el cuadro de sugerencias y la barra): tres cifras arriba (con reclutador, sin asignar, sin nombre o «no es reclutador»), la tabla de **Reclutadores** (cada uno se abre para ver y separar sus formas) y la de **Sin asignar** (se marcan varias y se juntan desde la barra de abajo, o con «¿Es X? Juntar», «Es un reclutador», «No es reclutador»). Todo se recalcula en el navegador al instante.

## Antes de publicar

Orden: `add-reclutadores-tables.ts` en la base real (DDL: solo con el sí de Sergio) → `git push origin main` → «Actualizar» en la pantalla (o guardar el primer cálculo desde `server/` antes del push). Si las tablas no existen, la pantalla abre, muestra el cálculo y avisa que no se pueden juntar nombres; no se cae.

## Pruebas

`node server/node_modules/.bin/tsx server/scripts/test-reclutadores.ts` (29): normalización, parecidos y sugerencias, sumas por reclutador, conteo sobre casos inventados donde se conoce cada número (copias, mismo proyecto, contacto compartido, sin fecha, proyecto futuro, periodos), lectura de las columnas del reclutador, acceso solo para Sergio, juntar/renombrar/borrar y calcular de punta a punta contra PGlite con el esquema real.

## Bitácora

- **2026-11-09:** primera versión (la pidió Sergio: «ir viendo los datos al mismo tiempo» que agrupa). Medido ese día con datos reales (solo lectura): 91,580 respuestas con nombre (97 % de las filas de tableros con la columna) escritas de 3,717 formas (2,417 sin mayúsculas ni acentos); unos 30 reclutadores cubren el 94 %. Últimos 12 meses: unas 4 de cada 10 respuestas son de gente nueva y 6 de cada 10 de gente que ya había llenado un filtro antes.
- **Pendiente:** segunda versión con cuántos de los que trajo cada reclutador eran «no elegibles» y cuántos entraron (calidad y asertividad); que el NR sea una lista de opciones en los filtros nuevos (sale del catálogo `reclutadores`); filtrar por proyecto o cliente.
