# Tablero comercial — guía del motor

Guía viva del **Tablero comercial** (`/comercial/tablero`), el reemplazo del dashboard comercial anterior (`/comercial/dashboard`, que sigue intacto y funcionando). Cada sesión que trabaje en él: lee esta guía antes de tocar nada y, al terminar, actualiza la bitácora.

## Qué es

Pantalla donde Sergio arma su propio tablero de ventas: bloques (cifra, barras, barras apiladas, líneas, área, pastel, dona, ranking, embudo, dispersión, tabla) que se mueven y se estiran en una rejilla de 12 columnas, se editan en un panel lateral y se guardan como vistas. Cada bloque es una **receta** guardada (qué medir, cómo cortar, con qué cruzar, filtros, periodo, comparación, fecha de referencia, moneda, acumulado, orden y límite); el motor la ejecuta sobre los deals y la gráfica solo dibuja el resultado.

Quién lo ve: solo `TABLERO_EMAILS` (`src/lib/tablero/acceso.ts`), en el menú y en la propia pantalla. No usa datos nuevos (`getDeals` y las vistas guardadas de siempre), así que no hay un candado de servidor aparte.

## Reglas que pidió Sergio (no cambiarlas sin preguntarle)

1. **Nada rígido:** todo bloque se mueve, se estira, se edita, se duplica y se quita; colores (paletas), valores en la gráfica, leyenda y tipo de gráfica los elige quien arma el tablero.
2. **La comparación es una elección, no una regla:** ninguna, misma fecha del año anterior, año anterior completo, periodo anterior o rango propio. Siempre se ven los rangos exactos que se comparan («1 ene–23 oct 2026 vs 1 ene–23 oct 2025»). Nunca forzar «misma fecha».
3. **Pocos botones:** al ver, el tablero se muestra limpio; el acomodo y la edición de bloques solo aparecen en modo «Editar».
4. **La fecha de referencia también se elige** (aprobación, propuesta, brief, pérdida). Con «si falta, usar la otra» (`alterna`) se replica la regla del dashboard anterior.
5. **Cada bloque puede traer lo suyo** (periodo, comparación, fecha, moneda, filtros); lo que traiga distinto se avisa en su encabezado, y si la gráfica no dibuja la comparación lo dice en lugar de callar.

## Dónde está

- `src/lib/tablero/` — el motor, **puro** (sin React ni red) y probado:
  - `campos.ts` — registro de medidas y cortes. Un campo nuevo se declara solo aquí y aparece en todos los menús.
  - `motor.ts` — `ejecutar(consulta, deals, ctx) → Resultado` (filas × columnas × medidas, con valores previos y los deals de cada celda para el detalle).
  - `periodos.ts` / `fechas.ts` — periodos, comparaciones y fechas ISO sin zona horaria.
  - `rejilla.ts` — acomodo de bloques (choques, empujar hacia abajo, gravedad).
  - `vistas.ts` — tablero inicial, lectura defensiva de lo guardado, conversión de vistas del dashboard anterior.
  - `graficas.ts`, `formato.ts`, `paletas.ts`, `exportar.ts`, `tipos.ts`, `acceso.ts`.
- `src/components/tablero/` y `src/pages/TableroComercialPage.tsx` — la pantalla.
- Pruebas: `server/scripts/test-tablero.ts` (motor, con deals inventados y cuentas iguales a las del dashboard anterior) y `server/scripts/test-vistas-tablero.ts` (vistas guardadas contra PGlite).

## Vistas guardadas

- Viven en la misma tabla que las del dashboard anterior (`commercial_dashboard_views`), sin cambios de esquema: el `viewId` empieza con `t2_`, `widgetsJson` es el tablero completo (`v: 2`) y `filtersJson` es `{"v":2}`.
- El dashboard anterior ignora las `t2_` y el tablero nuevo ignora las demás (y ofrece convertirlas con `desdeVistaAnterior`).
- **Cada una tiene su predeterminada:** `saveCommercialView` solo desmarca las predeterminadas de su misma familia. Antes desmarcaba todas las de la persona, y guardar la primera vista del tablero le habría quitado la suya al dashboard anterior.
- Lo guardado se lee con `leerTablero`, que no confía en el contenido: lo inválido se descarta o se reemplaza por su valor de siempre, nunca truena.

## Decisiones de cálculo

- **Fecha de un deal:** la de referencia elegida; con `alterna`, si falta se usa la otra (aprobación ↔ propuesta), igual que el dashboard anterior.
- **Dinero:** «todo en pesos» convierte lo que no es MXN con el tipo de cambio del deal, o 20 si no tiene o lo tiene en cero (igual que el anterior); las otras opciones suman solo MXN o solo USD sin convertir. Un deal sin moneda cuenta como MXN, también al filtrar por moneda (el dashboard anterior los dejaba fuera al filtrar).
- **Tasa de cierre:** ganados entre los deals que llegaron a cotización enviada, negociación, ganado o perdido. Sin ningún deal de esos sale «—», no 0 %.
- **Qué deals cuenta cada cifra:** cada medida declara cuáles (`cuenta` en `campos.ts`: ganados para los ingresos, los que llegaron a cotización para la tasa de cierre…). Eso decide qué se ve al abrir el detalle de una cifra (el detalle suma lo que dice la cifra) y si un renglón o una columna tiene algo que mostrar: se queda si algún deal cuenta, aunque su cifra salga en 0 (0 % de cierre, 0 días); sale si solo tiene deals que no cuentan (un cliente con puros perdidos en «Ingresos»). Regla que se prueba: `calcular(deals)` es igual a `calcular(deals.filter(cuenta))`.
- **Deals con fecha adelantada** (después de hoy) cuentan en su mes, en el total y en el acumulado; un mes futuro sin deals se queda «sin dato», no en cero.
- **Comparar con el año pasado:** el fin de un mes cae en el fin de ese mes del otro año (28 de feb de 2025 contra 29 de feb de 2024). Si el corte es hoy, es el mismo día.
- **Ejes de calendario** («Mes (Ene–Dic)», «Trimestre (Q1–Q4)»): siempre salen los 12 meses o los 4 trimestres; «Sin fecha» solo si algún deal cuenta.
- **Límites que protegen una vista guardada dañada:** años entre 1900 y 2200, «últimos N» hasta 3650, fechas que existen de verdad, nombres de campo solo si están en el registro (nunca «constructor» ni «__proto__»), alturas de bloque hasta 400 filas y 100 bloques por tablero. Lo que no cumple se descarta o se arregla al leer; nunca debe congelar ni tronar la página.
- **Costo y margen:** usan `quoted_cost`, que **no es confiable** (`approveDeal` guarda ahí el precio de la cotización; el margen promedio sale negativo). Las medidas lo avisan en su descripción; no ofrecerlas como verdad hasta arreglar el origen del dato.
- **Comparación por posición:** los periodos se alinean por número de mes/trimestre/día dentro del periodo, no por fecha, y las columnas que quedan en cero en todo el periodo se descartan.
- **El «−16 %» que preocupaba** salía de comparar el año en curso (incompleto) contra todo el año anterior y de usar la fecha de propuesta; con la misma fecha de corte y la fecha de aprobación la caída es mucho menor. Por eso la comparación se elige y siempre muestra sus rangos.

## Límites conocidos

- Un deal **sin fecha** cuenta en los totales de «Todo el historial», pero no sale en una serie por mes (no tiene mes). Las fechas que no pueden ser reales (antes de 1990 o más de 2 años adelante) tampoco estiran la serie, y siguen contando en el total.
- Los deals en otra moneda sin tipo de cambio se convierten con 20 sin avisar cuántos fueron (hoy son muy pocos). El dashboard anterior sí avisaba; está pendiente.
- El filtro y el corte por **responsable** usan el nombre de la persona, no su id: si dos personas se llaman igual o `getTeamMembers` falla, se mezclan o no coinciden. Hoy el responsable está vacío en casi todos los ganados.
- Al comparar tramos que cruzan de mes distinto (2–3 de septiembre contra 31 de agosto–1 de septiembre) las filas se alinean por posición, no por fecha: la fila «Oct» puede mostrar el previo de septiembre. Es por diseño.
- Un tablero guardado con otra `v` que no sea 2 se abre como tablero inicial; guardar lo sobrescribiría.
- La revisión independiente del motor (2026-10-23) probó 40,500 comparaciones contra el dashboard anterior y 65,760 combinaciones de fechas: lo de esta guía se corrigió y quedó con pruebas en `test-tablero.ts`.

## Bitácora

- **2026-10-23 — etapa 1:** motor, pantalla, edición de bloques, vistas guardadas y conversión de las vistas del dashboard anterior. Probado con deals inventados y contra los deals reales (solo lectura).
- **Siguiente (etapa 2):** más campos (cliente nuevo vs recurrente, motivo de pérdida, tipo de proyecto por método cuali/cuanti/digital), tabla de calor y cruces con más de una medida, filtros por bloque desde la propia gráfica, listas accionables (cotizaciones viejas sin respuesta, clientes que dejaron de comprar).
- **Etapa 3:** más tipos de gráfica estilo cuanti, etiquetas y colores por serie, exportar a PowerPoint o Excel.
- **Fuera del tablero, pero lo alimenta:** en Deals, que el tipo de proyecto sea selección (pills) con % por método, y llenar el responsable (vacío en el 95 % de los ganados).
