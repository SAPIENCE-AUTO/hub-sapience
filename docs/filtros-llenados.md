# Filtros llenados por persona — guía

Guía viva de **«cuántos filtros ha llenado» cada participante**: el número que ve el equipo en el tablero de Reclutamiento y en la ventana de historial, con una marca de qué tan seguro es. Quien trabaje en esto: léela entera y actualiza la «Bitácora» al terminar.

## Qué se pidió

Sergio (2026-11-10, viendo «Por reclutador»): «que a mi equipo le aparezca cuántas veces ha llenado un filtro un participante… con precisión… debería contar solo filtros llenados, sin importar cuántas veces se vinculó ese filtro a un tablero». Después preguntó qué tan confiable puede ser; la respuesta (medida con datos reales) es la sección «Qué tan confiable es».

## Definiciones (no cambiar sin avisar)

- **Filtro llenado = una respuesta.** El id de la respuesta es lo que va después de la última barra de `source_form` (`respuestaDe` en `src/lib/respuestaFillout.ts`). Si el mismo filtro está vinculado a varios tableros, su respuesta se copia a cada uno y esas filas cuentan **una sola vez**. Contar filas sale 45 % más alto (medido el 2026-11-10: 88,580 filas con id contra 61,165 respuestas distintas). Dos respuestas distintas del mismo filtro son dos veces que lo llenó.
- **Una traída cuenta como su respuesta original** (2026-11-11): quien se trae de un filtro anterior al de ahora tiene otra respuesta con id propio, pero es la misma vez que llenó el filtro. `respuestaDe`, `respuestasEnTablero`, `contarFiltrosLlenados` y `filtrosLlenadosDe` reciben el mapa de traídas (`mapaDeTraidas`, `src/serverUtils/formularios/traidasMapa.ts`): la traída se junta con su original, sale como «copiada en un tablero más» y el filtro que se muestra es el de la original. Antes sumaba un filtro llenado de más (y la copia de su misma respuesta salía como «registrado en otro estudio»). Si la persona participó con la original, su alerta de elegibilidad sigue igual. Los endpoints `getBoardDuplicateBadges` y `searchParticipantHistory` piden el mapa con un minuto de vigencia (`mapaDeTraidasReciente`: consulta todas las respuestas de filtros y se piden cada vez que se abre un tablero).
- **Filas sin id de respuesta** (capturadas a mano, importadas de Excel; el 14.5 % de las filas): no se pueden reconocer como un filtro llenado, **no cuentan** y se avisa cuántas son («+N filas sin filtro»). Quien solo tiene filas así tiene 0 y se ve «—».
- **Persona:** el grupo de identidad global en modo **estricto** (`getGlobalIdentityData`: 2 de 3 datos iguales entre correo, teléfono y nombre), el mismo de los íconos de elegibilidad. No usar el cierre lenient para contar: encadenaba identidades y llegó a mostrar un ×26 falso.
- **Contacto compartido:** 5 o más respuestas y 3 o más nombres distintos (`esContactoCompartido`; ahí se cuenta cada fila sin id como una respuesta). **No lleva número** (`filtrosLlenados: null`): se ve un ícono de personas y, en el historial, la lista de lo que llenó con ese contacto. Es la misma definición de «Por reclutador»: vive una sola vez en `src/lib/filtrosLlenados.ts` (`serverUtils/indicadores/reclutadores.ts` la reexporta).
- **Confianza** (`contarFiltrosLlenados`), por lo que varían los datos de las filas de la persona (teléfono, correo y nombre ya normalizados, con la misma regla de llaves que la agrupación de personas: `llavesDeLaFila` en `src/lib/filtrosLlenados.ts`): **segura** = todos coinciden; **probable** = algún dato tiene 2 valores (otro teléfono, otro correo o el nombre escrito distinto); **revisar** = algún dato tiene 3 o más (pudieron juntarse dos personas, o una cambió mucho de datos). Un nombre placeholder o muy corto no cuenta como variación.

## Dónde se ve

- **Tablero** (`RecruitmentPage.tsx`, `FiltrosLlenadosChip`): en la columna fija que antes se llamaba «Otros formularios» y ahora «Filtros llenados» (la llave interna sigue siendo `_dupHistory`, para no romper columnas ocultas guardadas): el número (de 5 en adelante, resaltado), un asterisco ámbar si hay que revisar, «—» si no tiene filtros registrados y un ícono de personas si es contacto compartido; junto a él siguen el reloj (participó hace más de 6 meses) y la copia azul (registrado en otro estudio sin participar). Al pasar el cursor, el texto explica el número, la confianza y las filas sin filtro. Al darle clic abre el historial. La columna ordena por el número (sin número, al final). Su filtro de columna sigue siendo el de siempre (Sí/No de «participó hace tiempo o solo registrado»): no se cambió para no romper filtros guardados.
- **Ventana de historial** (`DuplicateHistoryModal`, `FiltrosLlenadosResumen`): «Ha llenado N filtros», la etiqueta Seguro / Probable / Revisar y la lista, del más reciente al más antiguo, con proyecto, filtro, fecha del proyecto y los datos que usó esa vez (nombre, correo, teléfono); lo que se aparta del dato más usado va en ámbar. Con «Revisar» la lista abre sola. Una respuesta copiada en otros tableros sale una vez y dice «copiada en N tableros más».
- **Servidor:** `getBoardDuplicateBadges` agrega a cada fila `filtrosLlenados`, `filasSinFiltro`, `compartido` y `confianza` (opcionales, un servidor viejo no los manda y la pantalla lo tolera) y `searchParticipantHistory`, solo en modo semilla (la persona completa), agrega esos mismos más `llenados`. La búsqueda por texto no los trae.

## Qué tan confiable es

Medido el 2026-11-10 con datos reales (solo lectura; scripts de una sola vez, no quedan en el repo):

| Qué tanto coinciden los datos de la persona | Personas con 2 o más filtros | Qué tan seguro es el número |
|---|---|---|
| Todos coinciden | 56 % | Seguro |
| Algún dato cambia (2 valores) | 38 % | Probable |
| Algún dato trae 3 o más valores | 6 % (17 % de quienes llenaron 5 o más) | Revisar |

A mayor número, menos seguro. Por abajo (el número real sería mayor): 483 personas (1.8 %) parecen partidas en dos grupos (mismo teléfono o correo y nombre parecido, otros datos distintos); 317 respuestas (0.5 %) solo existen en filas borradas; el 14.5 % de las filas no trae id de respuesta; y no se puede saber de quien usó otro correo, otro teléfono y escribió distinto su nombre. Es un **mínimo** salvo en los «revisar», donde puede ser de más. De 33,635 personas: 468 son contacto compartido y 6,472 solo tienen filas sin id.

## Pruebas

Lo de las traídas lo prueba `server/scripts/test-traidas-cuentan-como-original.ts` (15, ver `docs/reclutadores.md`).

`node server/node_modules/.bin/tsx server/scripts/test-filtros-llenados.ts` (24): la cuenta sola (copias en varios tableros, respuestas distintas, filas sin id, contacto compartido y sus umbrales, la confianza, el nombre del filtro, la lista) y contra PGlite con el esquema real el tablero y el historial (X con una respuesta copiada, Y con una fila a mano, el compartido, W con tres teléfonos, quien llenó una vez, quien solo tiene una fila a mano; el mismo número en el tablero y en el historial). 4 de ellas fallan si se cuentan filas en vez de respuestas.

## Ideas y pendientes

- Filtrar la columna por el número («5 o más», «revisar»): hoy solo se ordena. Hacerlo sin romper el filtro Sí/No de siempre (otra llave).
- Mostrarlo también en «Historial» de cada respuesta de Filtros y en el detalle del participante.
- Si en la práctica sobran asteriscos, subir el umbral de «revisar» o separar «cambió de teléfono» de «cambió de nombre».

## Bitácora

- **2026-11-10:** primera versión, con su sí a la propuesta: número en la columna «Otros formularios» (renombrada «Filtros llenados»), marca de confianza, lista con los datos usados en el historial, contacto compartido sin número, orden por la columna. La definición de contacto compartido pasó a `src/lib/filtrosLlenados.ts`.
- **2026-11-11:** las traídas cuentan como su respuesta original (ver la definición de arriba). Lo notó Sergio al ver noviembre con 544 respuestas y 0 nuevas en «Por reclutador»: era la misma causa. Afecta a las personas que se trajeron de otro filtro (544 con fila en un tablero ese día): su número baja en uno si la respuesta original también está en un tablero.
