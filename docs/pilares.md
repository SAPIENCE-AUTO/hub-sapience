# Pilares (unidades de negocio)

Guía viva de **Pilares** (`/comercial/pilares` y el bloque «Pilares» de la pestaña General de cada deal): cada deal se reparte entre las unidades de negocio de Sapience (Cualitativo, Cuantitativo, Digital, Estrategia, y las que se creen después) con **montos en pesos**, de ingreso y de costo, y los porcentajes salen solos. Sirve para ver cuánto del dinero y de la rentabilidad es de cada pilar. Pedido de Sergio el 2026-11-24 («tags fijos, no texto por cada tipo de proyecto; en pesos y que calcule el porcentaje; poder crear más pilares»).

## Por qué existe

`deals.project_type` («Tipo de proyecto») era texto libre: 252 de 463 deals decían literalmente «Tipo de proyecto» y 51 estaban vacíos (en 2025, 133 de 134 ganados sin clasificar); los demás escribían lo mismo de varias formas («Cuali», «Cualitativo», «CUALITATIVO») o mezclas a mano («Cuali + Digital»). Las partidas de las cotizaciones no sirven para adivinar el pilar (hablan de tareas: moderación, reclutamiento, incentivos). Por eso el pilar se captura en el deal.

## Quién lo ve y quién puede qué

Todo el candado real está en el servidor (`src/serverUtils/pilares/acceso.ts`); el del menú y el de las pantallas es cosmético.

- **Repartir el INGRESO de un deal** entre pilares: cualquiera que pueda editar deals (`getDealPilares` / `saveDealPilares`).
- **Costos por pilar** (verlos, capturarlos, ver el costo ya registrado en el Hub), **administrar el catálogo** (crear, renombrar, color, desactivar) y la **pantalla de Pilares** con sus acciones en lote: solo **Owner o Socio**. Quien no lo es guarda el ingreso y NO toca costos: los que ya había se conservan, y el servidor ni siquiera se los devuelve.
- Entrada de menú «Pilares» dentro de Comercial (`roles: ['Owner', 'Socio']`).

## Datos

Dos tablas nuevas, declaradas en `server/generate.py` (EXTRA_TABLES; `schema.sql`, `schema-map.ts` y `types.ts` salen de ahí) y creadas en producción con `server/scripts/add-pilares-tables.ts` (idempotente, siembra los 4 pilares de arranque; **no se ejecuta solo y va ANTES de subir el código**). Una prueba (`test-pilares.ts`) comprueba que el script deja exactamente lo mismo que `schema.sql`.

- `pilares` — el catálogo: `name` (único sin importar mayúsculas ni espacios; en código además sin acentos), `color` (`#RRGGBB`), `sort_order`, `deactivated_at`. **Nunca se borra**: desactivado deja de ofrecerse en deals nuevos pero los deals que ya lo tienen lo conservan (y lo pueden seguir editando).
- `deal_pilares` — por deal y pilar: `price` (ingreso) y `cost` (costo, opcional), en la **moneda del deal** (pesos casi siempre). `deal_id` con `on delete cascade` (al borrar un deal se va su reparto), `pilar_id` con `restrict`. Un pilar una sola vez por deal (índice único). **Los porcentajes no se guardan**: salen de dividir.

El generador ganó una opción: una columna de enlace de EXTRA_TABLES puede pedir `notnull` y `ondelete` (`'cascade'` / `'restrict'`); por omisión sigue igual que antes (opcional y `set null`).

## Reglas del reparto (`src/lib/pilares/reparto.ts`, puro, lo usan el servidor y la pantalla)

- **Un solo pilar = 100 % sin escribir nada.** Su `price` se guarda vacío y el ingreso que cuenta es el precio del deal, aunque el precio cambie después. Con **dos o más**, los ingresos deben sumar el precio del deal (un peso de tolerancia por centavos): menos = «incompleto» (se avisa cuánto falta; en los reportes lo que falta saldrá como «sin clasificar»), más = «excedido» y **se rechaza al guardar** («El reparto suma $350,000 y el precio del deal es $300,000: se pasa por $50,000»). Sin precio en el deal: «sin precio», se guarda sin validar.
- Los **costos** son opcionales y no tienen que sumar nada: es lo que quien captura dice que le toca a cada pilar. Sin costo capturado = «sin costo» (los reportes futuros usarán el costo registrado del deal).
- Todo se calcula en **centavos enteros** (el reparto parejo de $100 entre 3 da 33.34, 33.33 y 33.33 y suma exacto; «Reajustar al precio» conserva proporciones con el método del resto mayor).
- Al elegir dos pilares con precio arranca **parejo**; «Completar» pone en una fila lo que falta; «Reajustar al precio» sirve cuando el precio cambió después de repartir.
- Cada vez que cambia el reparto, **`deals.project_type` se reescribe con los nombres de los pilares** en el orden del catálogo («Cualitativo + Digital», sin porcentajes: así el dashboard anterior, el tablero y los Excel que leen ese texto se limpian solos y no se multiplican los grupos). Renombrar un pilar reescribe el texto de los deals que lo tienen. Un reparto vacío no borra el texto.
- Un reparto guardado se **reemplaza completo** (lo que no viene se borra).
- **Moneda:** los montos se capturan en la moneda del deal (el bloque lo dice: «Ingreso (pesos)» o «Ingreso (USD)»); los reportes convertirán como el tablero (tipo de cambio del deal, o 20).

## Sugerencias del texto viejo (`src/lib/pilares/sugerencias.ts`)

Para los deals que aún no tienen reparto, el texto viejo de «Tipo de proyecto» se lee y, si **solo nombra pilares del catálogo**, se sugiere: «Cuali», «CUALITATIVO», «cualitativa» → Cualitativo; «Cuali + Digital», «Cuali y cuanti», «Cualitativo Digital» → varios (mixta). Cualquier otra palabra («Entendimiento de Consumidor», «Otro», «Tipo de proyecto», «Cuali + Sharpli») → **no se sugiere nada**: mejor que lo decida una persona. Un pilar creado después se reconoce por su propio nombre (una palabra del nombre basta). **Nunca se guarda solo**: en la pantalla de Pilares se acepta (una por una o en lote).

- Aceptar una sugerencia de **un solo pilar** pone ese pilar (100 %). Las **mezclas** se dejan para repartirlas a mano (el reparto no se puede adivinar): se abre «Repartir» y la sugerencia entra como punto de partida parejo.
- «Asignar 100 %» pone un pilar elegido a varios deals de golpe; solo toca deals **sin reparto** (los que ya tienen no se pisan).

## Pantalla de Pilares (`PilaresPage`)

Resumen del dinero ganado (en pesos) en tres partes con etiqueta: completos, por completar, sin clasificar. Filtros: búsqueda, solo ganados o todas las fases, año, orden (mayor precio, más reciente, cliente) y estado (sin clasificar, con sugerencia, por completar, listos, todos). Tabla con el precio, los pilares con su porcentaje, el estado y «Repartir» / «Editar» (abre el mismo bloque del deal en una ventana). Acciones en lote sobre los seleccionados. Administrar pilares desde el botón de arriba (también desde el «+ Pilar» del bloque del deal, solo Owner o Socio).

## En el deal

La pestaña General cambió el campo «Tipo de proyecto» por el bloque de Pilares (fichas para elegir pilares + tabla de ingreso y costo con porcentajes + avisos + «Guardar reparto»). En un deal nuevo (sin guardar) solo dice que se guarde primero. Para Owner o Socio, debajo se ve el **costo ya registrado en el Hub**: lo gastado (órdenes de compra de los proyectos del deal —`deal_vinculado_id` o `deal_asignado_id`—, sin borradores ni canceladas) y lo cotizado (partidas de las cotizaciones incluidas: `unit_cost × cantidad × componentes`); es solo referencia, avisa si hay órdenes en dólares sumadas sin convertir y si el deal no está en pesos.

Al pasar un deal a **Ganado** (fase o «Aprobar deal») sin reparto, sale un aviso con el botón «Repartir» (no bloquea nada).

## Lo que sigue (no construido)

1. **Rentabilidad por pilar** (Finanzas, junto a Costos por proyecto): por pilar y periodo, ingresos, costo, margen y margen %; ingreso = `price` (o el precio del deal con un solo pilar); costo = el capturado y, si no hay, el registrado del deal (real, luego cotizado) repartido con el mismo porcentaje; lo sin costo sale aparte. Antes: resolver dólares (las OC en dólares hoy se suman como pesos) y decidir cuándo cuenta un ingreso (aprobación, fin del proyecto o factura).
2. **Ingresos por pilar en el Tablero comercial:** el motor cuenta cada deal ENTERO en una sola clave; hay que enseñarle «partes» con peso (idea: expandir cada deal en una parte por pilar con precio y costo propios, y que los conteos cuenten deals únicos).
3. Mostrar los pilares en las tarjetas y la tabla del CRM (`getDeals` no los trae todavía).

## Pruebas

- `server/scripts/test-pilares-logica.ts` (33, puras): estados, porcentajes, reparto parejo y reajuste exactos al centavo, elegir y quitar pilares, lectura de montos escritos a mano, reconocimiento del texto viejo.
- `server/scripts/test-pilares.ts` (25, base en memoria con el esquema real y datos inventados): catálogo, reparto del deal y sus validaciones, el texto de «Tipo de proyecto», el candado de costos y de administrar, costo ya registrado, lista de clasificación, acciones en lote y que el script de producción deje lo mismo que `schema.sql`.
- Rotas a propósito de 36 formas (lógica, servicio y candados) y todas se detectan.

`node server/node_modules/.bin/tsx server/scripts/test-pilares-logica.ts` y `…/test-pilares.ts`; en producción: `cd server && npx tsx --env-file=../.env scripts/add-pilares-tables.ts` (solo con visto bueno de Sergio).
