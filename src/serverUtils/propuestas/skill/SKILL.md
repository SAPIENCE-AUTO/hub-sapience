---
name: sapience-propuestas
description: Arma propuestas de trabajo de Sapience (investigación cualitativa, cuantitativa y estrategia de marca) en PowerPoint, con la estructura, la voz de redacción y el sistema visual de Sapience. Úsala cuando alguien pida una propuesta, cotización de estudio o respuesta a un brief de Sapience, o pegue un brief de cliente para contestarlo.
---

# Propuestas Sapience

Esta skill convierte un brief en una propuesta de trabajo de Sapience lista para mandar. La propuesta tiene que leerse como si la hubiera escrito Sergio y verse como una propuesta de Sapience, no como algo hecho con AI.

Antes de escribir una sola lámina, lee los tres archivos de referencia:
- `references/estructura.md` — orden de la propuesta, módulos, modelo de fases y formato del archivo de contenido.
- `references/redaccion.md` — la voz de Sapience, las correcciones obligatorias y lo que no se escribe.
- `references/diseno.md` — lo fijo y lo variable del diseño, los siete estilos y las once portadas.

## Flujo de trabajo

1. **Leer el brief completo** y separar lo que dice el cliente de lo que tendrás que proponer tú (método, muestra, tiempos, precio).
2. **Preguntar antes de armar** lo que el brief no resuelve y cambia la propuesta. Pregunta todo junto, en un solo mensaje y en prosa: presupuesto o rango esperado, si se cotiza por fases o en un solo precio, fecha de entrega y si hay fotos para la portada. No preguntes lo que puedes decidir con criterio.
3. **Proponer el esqueleto** en un mensaje y esperar el visto bueno. Lleva tres partes:
   - **Fases:** nombre de cada fase con su goal en una línea, técnica y muestra, y precio.
   - **Índice de láminas:** la lista completa en orden, cada lámina con una línea de lo que dirá, marcando cuáles propones incluir y cuáles dejas fuera y por qué (por ejemplo, entregables fuera si no hay capturas). Los módulos disponibles están en `references/estructura.md`; ofrece también los opcionales que apliquen (postura, valor agregado, escenarios de inversión, siguiente paso, requisitos al cliente).
   - **Ilustraciones:** pregunta si la propuesta va ilustrada. Si sí, el contenido lleva `"ilustraciones": true` y el constructor deja huecos marcados ILUSTRACIÓN en contexto, objetivos, enfoque y punto de partida, que el diseñador reemplaza (o se pasan rutas en `ilustracion`).
   - **Paleta:** si la persona da un tono («fun», «seria», «elegante») o colores de marca, propón tres paletas (`acento`, `secundario`, cuatro `fases`) acordes al tono y a la categoría, dibújalas con `python scripts/muestra_paletas.py paletas.json paletas.png` y preséntalas. La elegida va en `paleta` dentro del contenido. Si no hay indicación, se usa la paleta del estilo. El constructor revisa contraste, saturación y que las fases se distingan, ajusta lo necesario e imprime los ajustes; comunícalos a la persona.
   - **Estilo y portada:** presenta las imágenes `assets/vistas/estilos.jpg` (los siete estilos) y `assets/vistas/portadas.jpg` (las once portadas), propone una combinación con una frase de por qué y aclara que el estilo y la portada se pueden combinar libremente.
   La persona puede tachar, agregar o reordenar láminas y cambiar estilo o portada. Escribe el contenido solo con lo que haya aprobado.
4. **Escribir el archivo de contenido** (`contenido.json`) con el formato de `assets/ejemplo_contenido.json`, aplicando la voz de `redaccion.md`.
5. **Revisar el contenido** con `python scripts/revisar.py contenido.json`. Corrige todo lo que marque y vuelve a correrlo hasta que salga «Sin problemas». Además, revisa tú lo que el script no ve: que las sumas de muestra y de semanas cuadren, que el precio de paquete sea menor que la suma de las fases, que cada descripción corresponda a su etiqueta y que no queden restos de otro proyecto.
6. **Construir** con `node scripts/construir.js contenido.json salida.pptx`. Las fotos de portada van en `fotos_portada` en el orden de los huecos; si no hay fotos, la portada sale con huecos grises marcados FOTO 1, FOTO 2, que la persona reemplaza en PowerPoint.
7. **Revisar visualmente**: convierte a PDF e imágenes y mira cada lámina. Busca textos encimados o cortados, títulos a distinta altura, números separados de su unidad y contraste bajo. Corrige en el contenido o en el constructor, nunca a mano en el archivo final.
8. **Entregar** el .pptx con una o dos frases sobre las decisiones que tomaste y lo que la persona tiene que completar (fotos, capturas de entregables, datos que no venían en el brief).

## Reglas que no se negocian

- **No se inventa información.** El contexto y cualquier afirmación sobre el mercado, la marca, la competencia o el consumidor salen solo del brief o de lo que diga quien pide la propuesta. En el archivo de contenido, cada punto del contexto lleva su `fuente` (`brief`, `persona` o `hipotesis`). Lo que es hipótesis se redacta como hipótesis («podría», «la pregunta es si»). Las indicaciones sobre la muestra (por ejemplo, incluir compradores de cierta competencia) son decisiones de diseño, no datos de mercado, y no se convierten en afirmaciones del contexto. Si falta información para un buen contexto, se pregunta en el paso 2.

- El precio nunca lo inventa Claude: sale solo de lo que diga la persona. Si no lo da (o dice TBC), el precio va como `"pendiente"` en el contenido y el constructor deja un hueco marcado PRECIO POR CONFIRMAR, que la persona llena antes de mandar la propuesta. Nunca se escribe «por cotizar» como texto de la propuesta.
- Las fases se bautizan para cada proyecto (ver `estructura.md`). No uses un catálogo fijo de nombres.
- Nada de numeración con cero a la izquierda (01, 02); si algo se numera, va 1, 2, 3.
- Nada de barras delgadas de color para separar o dividir; se separa con aire o con bloques sólidos. Las únicas líneas delgadas permitidas son la gris bajo el encabezado y la rayita vertical junto al logo en las bandas.
- Ninguna lámina queda solo con texto. Cada una lleva al menos un elemento visual que la estructure: bloques sólidos, iconos, fotos o diagramas, como en las propuestas de Sapience.
- Tipografías: el cuerpo va en Montserrat, Poppins o Segoe UI; los títulos pueden llevar otra tipografía (Oswald, Source Sans) para dar variedad. Nunca otras familias.
- Las cajas de una misma fila llevan el mismo número de puntos y textos de largo parecido, para que se vean uniformes, y ninguna caja queda con espacio vacío. El revisor lo verifica; si marca diferencias, se reescriben los puntos, no se rellena con texto de más.
- Nada de versalitas espaciadas, etiquetas tipo formulario, números gigantes tipo tablero ni tarjetas con fondo tenue.
- No se generan imágenes con AI. Las fotos las pone la persona según la temática.
- Una salvedad sobre lectura direccional, donde aplique, basta. No se llena la propuesta de advertencias.

## Tipografías

Los estilos usan Montserrat, Poppins y Segoe UI en el cuerpo, y Oswald o Source Sans en algunos títulos. Las computadoras donde se abra la propuesta deben tenerlas instaladas.
