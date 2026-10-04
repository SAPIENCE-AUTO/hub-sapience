# Estructura de una propuesta Sapience

## Orden

Columna fija: portada, contexto, objetivos, enfoque o metodología, target y muestra, tiempos, inversión, cierre con logo.

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

Se escribe como en Aspirina, Falabella y Halls, nunca como titular:
- Abre con un párrafo de entrada (`entrada`) que plantea la situación con conectores, usando las palabras del brief. Ejemplo de Aspirina: «La marca Aspirina se encuentra en un momento de profunda transformación y vulnerabilidad. En los últimos años, ha enfrentado una serie de desafíos simultáneos que han impactado tanto su desempeño de negocio como su conexión con el consumidor».
- Los bloques se nombran con un concepto, no con una frase de copy: «Categoría en contracción», «Pérdida de foco en el core», «Consumidor que ha cambiado»; o solo «Crecimiento», «Uso», «Asociación». Nunca «Un portafolio que no se ha movido».
- Las flechas encadenan causa y consecuencia: el segundo punto gira con «Sin embargo», «Pero» o «La oportunidad es».
- Se cierra con una frase puente que dice qué hay que hacer («Por eso necesitamos…», «Dados estos retos…»), con la frase clave resaltada.
- Las hipótesis del cliente pueden ir como bloque propio («Hipótesis de PepsiCo»), tal como vienen en el brief.

## Objetivos

Siempre con la misma estructura, como en Razones de llegada a Ensure, Bonafont, Falabella y Aspirina:
- **Objetivo general**: una sola oración que empieza con verbo en infinitivo, dice el objeto del estudio y el para qué de negocio, construida con lo que pide el brief.
- **Objetivos específicos**: entre 2 y 6, agrupados de forma coherente (si el brief trae 7 objetivos sueltos, se agrupan). El título de cada uno ya es el objetivo: verbo en infinitivo más lo que se va a lograr («Entender la relación de la consumidora con el kéfir», «Reconstruir el journey completo hacia Ensure»). Nunca un tema suelto como «La consumidora frente al kéfir». Debajo va el desagregado breve de lo que cubre, en flechas, en preguntas o en un texto corto.
- Los verbos van acordes al método. En un cualitativo: entender, explorar, identificar, reconstruir, co-crear, evaluar, decodificar. Medir, cuantificar o dimensionar solo en un cuantitativo.
- Con 2 o 3 específicos van en una fila; con 4, en dos filas de dos; con 5 o 6, en dos filas de tres.

## Modelo de fases

Cada fase tiene nombre propio, goal, qué haremos, cómo lo haremos, muestra si aplica, output, qué le entrega a la siguiente fase, ejemplos de entregables, semanas y precio (con costo, sin costo o incluido como valor agregado).

Dos modos:
- **Fases separables**: se cotizan por partes y tienen precio de paquete menor a la suma. Ejemplo: Halls (Onboarding, Exploring, Measuring, Landing), BAC (Exploring, Landing, Testing).
- **Técnicas encadenadas con los mismos participantes**: un solo recorrido y un solo precio. Ejemplo: Canal 22 (diario, entrevistas, triadas).

Nombres de fase: de una a tres palabras, legibles solos en la barra de navegación. Se eligen según lo que el cliente necesita decidir en ese proyecto. Patrones de Sapience: gerundios en inglés (Exploring, Landing, Testing, Expanding, Measuring, Onboarding), pares de propósito (Business Sense, Consumer Empathy, Empathize & Inspire, Map & Build) y técnicas con nombre de producto (Ethnoweek, Ethnotalks, Brand Switch Journal, Human Reach). Un nombre que ya funcionó se puede repetir cuando encaja. Siempre va acompañado de su goal en español. El output de cada fase se anuncia como insumo de la siguiente.

## Muestra

Tabla o celdas con perfiles en filas y cortes (edad, ciudad, relación con la marca) en columnas. Debajo, los criterios comunes con flechas. Si hay menores de edad, nota de consentimiento de padres o tutores. Las sumas tienen que cuadrar con lo que se dice en método e inversión.

## Tiempos

Cronograma por semanas con fechas reales y rejilla de días, barras del color de cada fase, aprobación y entrega señaladas en una nota.

## Inversión

Formato único: `MXN $000,000.00 + IVA` (o `USD $00,000.00`) y la cantidad en letra. Por fases cuando son separables, con precio de paquete. Una partida puede ir «Sin costo» o «Incluido como valor agregado».

## Archivo de contenido

`scripts/construir.js` lee un JSON. El ejemplo completo está en `assets/ejemplo_contenido.json`.

Campos generales: `proyecto` (nombre del estudio, va en encabezados y portada), `cliente`, `fecha`, `tipo` («Propuesta de trabajo» o «Propuesta de investigación y estrategia»), `paleta` (opcional: `{acento, secundario, fases[], fondo}` en hexadecimal sin #; sustituye los colores del estilo), `metodo` (`cualitativo`, `cuantitativo` o `mixto`), `estilo` (A a G), `portada` (opcional, para usar una portada distinta a la del estilo), `fotos_portada` (rutas en el orden de los huecos), `ilustraciones` (true para dejar huecos de ilustración), `fases` (lista de `{nombre, icono, etapa}`; `etapa` agrupa fases en etapas grandes, como Fase 1: off season y Fase 2: on season en Grinch, y se muestra sobre la barra de navegación; el icono es un nombre de Feather Icons de react-icons, por ejemplo FiCoffee, FiSearch, FiUsers, FiBarChart2, FiTarget, FiBookOpen, FiMessageCircle, FiCamera), `laminas` (lista de módulos).

Módulos (`tipo`):
- `contexto`: `entrada` (lista de textos; `{texto, negrita: true}` va en negrita), `columnas[{titulo, icono, puntos[{texto, fuente}] o texto, ilustracion}]`; con `texto` sirve para el formato Ambition – Challenge – Task de Grinch, `cierre` (lista de textos; `{texto, resalta: true}` sale en color de acento y `{texto, negrita: true}` en negrita). `bisagra` solo si no hay entrada.
- `punto_partida`: para cuando el cliente ya trae conocimiento previo (como Grinch). `bisagra`, `insight` (lista de textos, va en bloque de acento), `bloques[{titulo, texto}]` (drivers, momentos, segmentos, íconos…), `ilustracion` opcional.
- `objetivos`: `general` (una oración), `especificos[{titulo, puntos[] | preguntas[] | texto}]` (de 2 a 6), `acomodo` opcional (`columnas` o `embudo`; el embudo solo aplica con 2 o 3 específicos).
- `enfoque`: `bisagra`, `verbos` (una lista de tres verbos por fase), `acomodo` opcional (`circulos` o `banda`).
- `detalle_fase`: `fase` (índice desde 0), `goal`, `como[{titulo, texto}]`, `output[]`, `foto` opcional.
- `muestra`: `bisagra`, `columnas[]`, `filas[{nombre, celdas[]}]`, `notas[]`, `acomodo` opcional (`celdas` o `tabla`).
- `entregables`: `bisagra`, `imagenes[{archivo, pie}]`.
- `tiempos`: `semanas[]`, `barras[{fase, inicio, fin, etiqueta}]` (inicio y fin en semanas, se permiten decimales), `nota`.
- `inversion`: `bisagra`, `partidas[{fase, descripcion, precio}]` o `incluye[]`, `paquete{etiqueta, precio, letra}`, `nota`.
- `seccion`: lámina libre con `titulo`, `bisagra` y `puntos[]` o `columnas[{titulo, puntos[]}]`. Sirve para postura, valor agregado o requisitos al cliente.
- `cierre`: lámina final con el logo.

Si el estilo define un acomodo, se usa salvo que la lámina diga otro. Alterna acomodos entre propuestas del mismo cliente para que no se vean iguales.
