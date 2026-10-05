# Estructura de una propuesta Sapience

## Orden

Columna fija: portada, contexto, objetivos, enfoque o metodología, target y muestra, tiempos, inversión, cierre con logo.

Los módulos opcionales se acomodan así: postura después del contexto; detalle de fase después del enfoque; entregables después del detalle de fase; valor agregado, escenarios, lo que necesitamos del cliente y siguiente paso después de la inversión, antes del cierre. Entre muestra, tiempos e inversión no va ninguna otra lámina.

Módulos que se agregan según el proyecto:
- Detalle de fase, una o varias láminas por fase, con barra de navegación.
- Ejemplos de entregables de estudios anteriores (capturas reales que aporta la persona). Es de lo que más vende.
- Lámina de postura («En Sapience estamos convencidos de que…») cuando el estudio es de posicionamiento o estrategia.
- Valor agregado (sesiones posteriores al reporte, workshop).
- Escenarios u opciones de inversión.
- Lo que necesitamos del cliente para arrancar.
- Contenido de socios (cuanti con un proveedor, creatividad de una agencia), siempre reescrito con el estilo de la propuesta.

No hay límite de láminas. La extensión la decide el estudio, pero cada lámina tiene que sumar al argumento o a la decisión del cliente. Lo operativo (controles de calidad, matrices de responsabilidades, protocolos completos) se queda para el kick off.

## Contexto

Se escribe como en Aspirina, Falabella y Halls, nunca como titular. El contexto cuenta la situación del negocio, la marca, la categoría o el consumidor con datos del brief o de la persona; no repite el target ni adelanta lo que vamos a investigar:
- Abre con un párrafo de entrada (`entrada`) que plantea la situación con conectores, usando las palabras del brief. Ejemplo de Aspirina: «La marca Aspirina se encuentra en un momento de profunda transformación y vulnerabilidad. En los últimos años, ha enfrentado una serie de desafíos simultáneos que han impactado tanto su desempeño de negocio como su conexión con el consumidor».
- Los bloques se nombran con un concepto, no con una frase de copy: «Categoría en contracción», «Pérdida de foco en el core», «Consumidor que ha cambiado»; o solo «Crecimiento», «Uso», «Asociación». Nunca «Un portafolio que no se ha movido».
- Cada bloque lleva al menos un dato concreto del brief o de la persona (una cifra, un hecho, un cambio, una hipótesis del cliente). El target del estudio no es contexto: «hombres de 25 a 40 años, NSE C+/C» va en la muestra, nunca como si fuera un logro de la marca («ya llegó a…»). Lo que falta saber tampoco es contexto («Falta entender cómo…» es un objetivo).
- Si el brief no trae datos para armar al menos dos bloques con sustancia, se pregunta (en Hub, en el campo `preguntas` del esqueleto). No se rellena con el target, con los objetivos ni con generalidades de la categoría.
- Las flechas encadenan causa y consecuencia: el segundo punto gira con «Sin embargo», «Pero» o «La oportunidad es».
- Se cierra con una frase puente que dice qué necesitamos saber o resolver («Por eso necesitamos entender…», «Dados estos retos, necesitamos…»), con la frase clave resaltada. El cierre no adelanta el método ni el orden de las fases («Por eso proponemos ir primero a…»); eso va en el enfoque.
- Las hipótesis del cliente pueden ir como bloque propio («Hipótesis de PepsiCo»), tal como vienen en el brief.

## Objetivos

Siempre con la misma estructura, como en Razones de llegada a Ensure, Bonafont, Falabella y Aspirina:
- **Objetivo general**: una sola oración que empieza con verbo en infinitivo, dice el objeto del estudio y el para qué de negocio, construida con lo que pide el brief.
- **Objetivos específicos**: entre 2 y 6, agrupados de forma coherente (si el brief trae 7 objetivos sueltos, se agrupan). El título de cada uno ya es el objetivo: verbo en infinitivo más lo que se va a lograr («Entender la relación de la consumidora con el kéfir», «Reconstruir el journey completo hacia Ensure»). Nunca un tema suelto como «La consumidora frente al kéfir». Debajo va el desagregado breve de lo que cubre, en flechas, en preguntas o en un texto corto.
- Los verbos van acordes al método. En un cualitativo: entender, explorar, identificar, reconstruir, co-crear, evaluar, decodificar. Medir, cuantificar o dimensionar solo en un cuantitativo.
- Con 2 o 3 específicos van en una fila; con 4, en dos filas de dos; con 5 o 6, en dos filas de tres.

## Modelo de fases

Cada fase tiene nombre propio, goal, qué haremos, cómo lo haremos, participantes (los mismos de la fase anterior o nuevos, con su porqué), muestra si aplica, output, qué le entrega a la siguiente fase, ejemplos de entregables, semanas y precio (con costo, sin costo o incluido como valor agregado).

Dos modos:
- **Fases separables**: se cotizan por partes y tienen precio de paquete menor a la suma. Ejemplo: Halls (Onboarding, Exploring, Measuring, Landing), BAC (Exploring, Landing, Testing).
- **Técnicas encadenadas con los mismos participantes**: un solo recorrido y un solo precio. Ejemplo: Canal 22 (diario, entrevistas, triadas).

Participantes: es una decisión de método y se toma en el esqueleto, no al escribir la muestra. Con los mismos participantes se gana profundidad y continuidad (diario y luego entrevista con la misma persona); con participantes nuevos se gana mirada fresca (evaluar propuestas sin el sesgo de haber hablado del tema). La decisión tiene que verse, no quedar enterrada en el texto. Se ve en tres lugares: en el enfoque, el conector entre fases dice «con los mismos participantes» o «con participantes nuevos» (lo pone el constructor a partir de `participantes`); en cada detalle de fase, el bloque de color dice quiénes participan (`quienes`: «16 participantes», «24 participantes nuevos»); y en la muestra, bajo el nombre de cada fase, cuántos son y qué hace cada uno (`detalle` en `grupos`). El porqué se dice una sola vez, en la bisagra de la muestra o en el detalle de la fase, y no se repite en las notas.

Nombres de fase: de una a tres palabras, legibles solos en la barra de navegación. Se eligen según lo que el cliente necesita decidir en ese proyecto. Patrones de Sapience: gerundios en inglés (Exploring, Landing, Testing, Expanding, Measuring, Onboarding), pares de propósito (Business Sense, Consumer Empathy, Empathize & Inspire, Map & Build) y técnicas con nombre de producto (Ethnoweek, Ethnotalks, Brand Switch Journal, Human Reach). Un nombre que ya funcionó se puede repetir cuando encaja. Siempre va acompañado de su goal en español. El output de cada fase se anuncia como insumo de la siguiente.

## Muestra

Tabla o celdas con perfiles en filas y cortes (edad, ciudad, relación con la marca) en columnas. La muestra refleja la decisión de participantes:
- Si todas las fases usan a los mismos participantes, va una sola tabla y una nota dice qué técnicas hace cada uno («Cada participante hará diario de 5 días y entrevista 1 a 1»).
- Si una fase usa participantes nuevos, la tabla se agrupa por fase con `grupos`: el nombre de la fase en su color arriba, debajo cuántos son y qué hacen («16 participantes con diario y entrevista») y luego sus cortes («Exploring» sobre Guadalajara y Ciudad de México, «Testing» sobre Guadalajara y Ciudad de México). Nunca columnas que mezclan fase y corte («Exploring en Guadalajara»).
- Las celdas dicen cuántos participantes o sesiones («4 participantes», «1 sesión de 6»); la técnica va en el `detalle` del grupo, no en la celda. Las notas quedan solo para los criterios de reclutamiento y la definición de cada perfil. Las celdas dicen la cantidad en español («6 en 1 sesión», «4 entrevistas»), sin puntos medios ni abreviaturas de formulario. Debajo, siempre, los criterios comunes con flechas y la definición operativa de cada perfil (por ejemplo, «Recompradores <la han comprado 2 veces o más en los últimos 3 meses>»). Si hay menores de edad, nota de consentimiento de padres o tutores. Las sumas tienen que cuadrar con lo que se dice en método e inversión.

## Tiempos

Cronograma por semanas con rejilla de días, barras del color de cada fase, aprobación y entrega señaladas en una nota de un renglón. Las semanas llevan fechas reales solo si la persona dio la fecha de inicio; si no, van como «Semana 1», «Semana 2»… Nunca se inventan fechas, ni en las semanas ni en la nota.

## Inversión

Formato único: `MXN $000,000.00 + IVA` (o `USD $00,000.00`) y la cantidad en letra con este formato fijo, sin agregarle nada: «Seiscientos diez mil pesos mexicanos + IVA». Por fases cuando son separables, con precio de paquete. Una partida puede ir «Sin costo» o «Incluido como valor agregado».

## Archivo de contenido

`scripts/construir.js` lee un JSON. El ejemplo completo está en `assets/ejemplo_contenido.json`.

Campos generales: `proyecto` (nombre del estudio, va en encabezados y portada), `cliente`, `fecha`, `tipo` («Propuesta de trabajo» o «Propuesta de investigación y estrategia»), `paleta` (opcional: `{acento, secundario, fases[], fondo}` en hexadecimal sin #; sustituye los colores del estilo), `metodo` (`cualitativo`, `cuantitativo` o `mixto`), `estilo` (A a G), `portada` (opcional, para usar una portada distinta a la del estilo), `fotos_portada` (rutas en el orden de los huecos), `ilustraciones` (true para dejar huecos de ilustración), `fases` (lista de `{nombre, icono, etapa, participantes}`; `participantes` es `nuevos` o `mismos` (los de la fase anterior); `etapa` agrupa fases en etapas grandes, como Fase 1: off season y Fase 2: on season en Grinch, y se muestra sobre la barra de navegación; el icono es un nombre de Feather Icons de react-icons, por ejemplo FiCoffee, FiSearch, FiUsers, FiBarChart2, FiTarget, FiBookOpen, FiMessageCircle, FiCamera), `laminas` (lista de módulos).

Módulos (`tipo`):
- `contexto`: `entrada` (lista de textos; `{texto, negrita: true}` va en negrita), `columnas[{titulo, icono, puntos[{texto, fuente}] o texto, ilustracion}]`; con `texto` sirve para el formato Ambition – Challenge – Task de Grinch, `cierre` (lista de textos; `{texto, resalta: true}` sale en color de acento y `{texto, negrita: true}` en negrita). `bisagra` solo si no hay entrada.
- `punto_partida`: para cuando el cliente ya trae conocimiento previo (como Grinch). `bisagra`, `insight` (lista de textos, va en bloque de acento), `bloques[{titulo, texto}]` (drivers, momentos, segmentos, íconos…), `ilustracion` opcional.
- `objetivos`: `general` (una oración), `especificos[{titulo, puntos[] | preguntas[] | texto}]` (de 2 a 6), `acomodo` opcional (`columnas` o `embudo`; el embudo solo aplica con 2 o 3 específicos).
- `enfoque`: `bisagra`, `verbos` (por fase, una lista de tres frases cortas de verbo con objeto, de 2 a 4 palabras: «Entrar a la cocina», «Decodificar tensiones», «Aterrizar territorios»; nunca un verbo suelto como «Observar» o «Escuchar»), `acomodo` opcional (`circulos` o `banda`).
- `detalle_fase`: `fase` (índice desde 0), `quienes` (quiénes participan, en 2 a 4 palabras: «16 participantes», «24 participantes nuevos», «los mismos 16»), `goal`, `como[{titulo, texto}]` (el texto en futuro: «registrarán», «profundizaremos»), `output[]`, `foto` opcional.
- `muestra`: `bisagra`, `grupos[{fase, columnas, detalle}]` opcional (obligatorio si alguna fase tiene participantes nuevos; `fase` es el índice desde 0, como en `detalle_fase`; `columnas` es cuántas columnas abarca la fase; `detalle` dice cuántos son y qué hacen, «16 participantes con diario y entrevista»), `columnas[]`, `filas[{nombre, celdas[]}]`, `notas[]` (obligatorias: criterios comunes y la definición de cada perfil; si todas las fases usan a los mismos participantes, una nota dice qué técnicas hace cada uno; sin flecha al inicio, el constructor la pone), `acomodo` opcional (`celdas` o `tabla`).
- `entregables`: `bisagra`, `imagenes[{archivo, pie}]`.
- `tiempos`: `semanas[]`, `barras[{fase, inicio, fin, etiqueta}]` (inicio y fin en semanas, se permiten decimales), `nota`.
- `inversion`: `bisagra`, `partidas[{fase, descripcion, precio}]` o `incluye[]`, `paquete{etiqueta, precio, letra}`, `nota`. La `descripcion` no repite el nombre de la fase, porque ya va en la píldora de arriba, y cabe en dos líneas. La `nota` cabe en una línea.
- `seccion`: lámina libre con `titulo`, `bisagra` y `puntos[]` o `columnas[{titulo, puntos[]}]`. Sirve para postura, valor agregado o requisitos al cliente.
- `cierre`: lámina final con el logo.

Si el estilo define un acomodo, se usa salvo que la lámina diga otro. Alterna acomodos entre propuestas del mismo cliente para que no se vean iguales.
