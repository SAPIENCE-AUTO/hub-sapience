# Diseño Sapience

## Lo fijo

- Título de sección grande, en mayúsculas, en color de acento, siempre a la misma altura; debajo la oración de propuesta en negrita; el cuerpo en peso ligero. Tres niveles con saltos grandes de tamaño.
- Encabezado con el nombre del proyecto y el logo; pie con número de página.
- Bloques sólidos con texto centrado: píldoras, barras, círculos u otras formas rellenas con icono de línea, encabezados de tabla en bloque de color, chevrones o flechas gruesas que conectan.
- Lo que no está activo se apaga en gris (barra de navegación de fases), no se quita.
- Los números van dentro de la oración y en negrita; el número grande se reserva para la inversión.
- Cronograma con rejilla de días.
- Fotos o capturas reales (sesiones, diarios, entregables) en la propuesta.
- Nada encimado, nada cortado, ningún texto pegado al borde.

## Lo que varía

Color de acento y secundario, pareja tipográfica, base oscura o clara (sostenida en toda la propuesta), forma de los bloques, contenedor de los iconos, tipo de encabezado y pie, portada y acomodo de algunos módulos.

## Densidad visual

Ninguna lámina queda solo con texto sobre el fondo. El contexto lleva sus bloques con encabezado de color y su cierre en bloque; los objetivos, el general en bloque de acento y cada específico en su recuadro; el detalle de fase, foto o bloque con el icono de la fase; la inversión, lo que incluye en recuadro. Los iconos de contexto se piden con `icono` en cada columna.

## Paletas por tono

Una paleta propia se arma desde un tono breve o desde los colores de marca del cliente. Reglas: acentos saturados (Sapience no usa paletas apagadas), texto sobre cada color en blanco u oscuro según el contraste, acento con contraste suficiente sobre el fondo, y colores de fase que se distingan entre sí. El constructor aplica estos candados solo. Pendiente: los marcos de portada conservan su color original; al usar una paleta propia, elige una portada cuyos colores combinen.

## Uniformidad

Las cajas de una misma fila llevan el mismo número de puntos con largo parecido y la misma altura, ajustada al contenido para que no queden huecos.

Los títulos de las cajas de una fila (encabezados de color del contexto, títulos de objetivos específicos) ocupan todos el mismo número de renglones, 1 o 2, nunca más. El texto de abajo va en letra más chica que el título. El título de cada lámina cabe en un renglón.

## Ilustraciones

Propuestas como Grinch van construidas alrededor de ilustraciones (una por bloque de contexto, por objetivo y por técnica). Con `ilustraciones: true` el constructor deja los huecos en su lugar exacto. Las ilustraciones no se generan con AI; las pone el diseñador.

## Lo que nunca va

Versalitas espaciadas, numerales 01-02-03, etiquetas tipo formulario, números gigantes tipo tablero en metodología, tarjetas con fondo tenue e icono en cuadrito, barras delgadas de color para separar o dividir, paletas apagadas ajenas a Sapience, alternar láminas oscuras y claras, portadas sin foto, el logo escrito como texto, imágenes generadas con AI.

## Los siete estilos (`assets/estilos`)

| Estilo | Base | Títulos | Bloques | Iconos | Enfoque | Objetivos | Muestra | Encabezado y pie | Portada |
|---|---|---|---|---|---|---|---|---|---|
| A · Oscuro coral | Navy | Montserrat | Píldora | Círculo | Círculos | Columnas | Celdas | Línea gris | Mancha en cascada |
| B · Banda navy, base clara | Gris claro | Oswald | Píldora | Círculo | Círculos | Columnas | Celdas | Banda navy arriba | Onda |
| C · Blanco, pie amarillo | Blanco | Montserrat | Píldora | Círculo | Círculos | Columnas | Celdas | Banda amarilla abajo | Pixeles |
| D · Rombos, verde | Blanco | Source Sans | Esquina suave | Rombo | Banda de chevrones | Columnas | Celdas | Banda navy arriba | Rombos redondeados |
| E · Mancha, embudo y tabla | Navy | Montserrat | Píldora | Círculo | Círculos | Embudo | Tabla | Línea gris | Mancha, cliente protagonista |
| F · Pizarra, cuadrado | Pizarra | Oswald | Cuadrado | Cuadrado | Banda de chevrones | Columnas | Tabla | Línea gris | Chevrón |
| G · Diagonal X, contorno | Blanco | Montserrat | Contorno | Cuadrado redondeado | Círculos | Embudo | Celdas | Banda navy arriba | Diagonal en X |

Cómo elegir: si la persona no tiene preferencia, escoge según el cliente y la categoría (por ejemplo, salud y farma con D o C; consumo masivo con A, E o G; estrategia de marca con B o F) y evita repetir el estilo de la última propuesta al mismo cliente.

Vista de los siete estilos: `assets/vistas/estilos.jpg`.

## Las once portadas (`assets/portadas.json`)

Vista del catálogo: `assets/vistas/portadas.jpg`.

Mancha en cascada (CITIZEN), mancha con cliente protagonista (DOS), diagonal en X (SANTIAGO), brochazo sobre blanco (AURELIO), chevrón (ESPARTA), diagonal amarilla (1200), pixeles (PIVOT), triángulos (Yellow), rombos en retícula (VALOR), rombos redondeados con tres fotos (PAIN), onda sobre foto completa (FRESH).

Cada portada tiene un marco PNG que va encima de la foto y la recorta, uno o varios huecos de foto y textos con plantilla ({titulo}, {cliente}, {fecha}, {tipo}; en mayúsculas si el marcador va en mayúsculas). Cualquier estilo puede usar cualquier portada con el campo `portada` del contenido; cuida que los colores del marco combinen con el acento del estilo.

## Fotos

Las fotos las pone la persona en cada propuesta según la temática: personas en su contexto, producto o categoría, nunca imágenes genéricas de oficina. La portada de rombos redondeados necesita tres fotos; las demás una.
