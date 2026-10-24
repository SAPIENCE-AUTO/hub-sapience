# Reglas para diseñar un screener (de Sergio)

Salen de las versiones del screener de ALONG 2 (ejemplo 1) y de cómo trabaja el equipo. Si una no aplica al estudio, dilo en `supuestos`.

## Duración

- **Máximo 10 minutos** para quien entra por el camino más común. El Hub estima los minutos con la redacción y las opciones; un filtro que se pasa se recorta antes de entregarlo.
- Lo que se repite (un bloque por cada formato que compra) es lo que más alarga. Si se repite por algo, que se repita solo por lo que importa al estudio (`repetirSolo`) y con pocas preguntas por bloque.

## Orden: un embudo

0. **Nadie se corta por defecto.** Lo que antes «terminaba» el filtro ahora es «no califica»: se registra el motivo y la persona contesta todo, para no enseñarle dónde se corta. Usa `cortar` solo si el pedido lo dice.
1. **«Antes de empezar» lo pone el Hub** en todos los filtros: el aviso de privacidad (con «No acepto» que termina), el nombre y la foto de una identificación oficial (quien no quiere darla termina). No los escribas ni los repitas: la estructura empieza en lo que sigue.
2. **Datos de contacto y perfil básico**: celular, género, edad, código postal o ciudad, cómo es su hogar (el nombre ya lo pide el Hub). Van al inicio para poder recuperar a quien abandona y para cortar pronto por edad o zona.
3. **Filtros de seguridad**: giros y estudios recientes.
4. **De lo general a lo particular:** primero las categorías que compra o usa, después los formatos o tipos dentro de la categoría que importa, y **solo dentro de cada uno** el detalle (marcas, aroma o variante, lugar de compra, antigüedad, última compra, foto).
5. **Marcas que no compraría** (rechazo) después de los bloques, para no sugerir marcas antes.
6. **NSE** con el cuestionario oficial.
7. **Condiciones de participación** al final: lo que implica el estudio (visita, compra acompañada, grabación, sesión en línea con cámara, videollamada de verificación) con su aceptación, y disponibilidad.

## Abiertas u opciones

- **Abiertas solo donde una lista sesgaría o daría la respuesta:** aromas, variantes y, cuando importa, la marca que usa ahora. Sirven además como prueba de que lo usa de verdad («escríbelo como viene en el empaque»).
- **Todo lo demás de opción:** marcas, lugar de compra, tiempos, frecuencias, tamaños, presentaciones.
- **Una o varias, decidido por lo que se pregunta**, nunca por costumbre: «¿cuál es tu marca favorita?» es de una; «¿qué marcas compras?» es de varias. En Fillout se usaron casillas para preguntas de una sola respuesta porque la integración con Monday no aceptaba opción única: **no copies ese tipo** de los formularios viejos.
- Rangos de edad, frecuencias y tiempos con opciones que no se enciman y cubren todo.

## Disimular

- **Otras categorías solo para disimular**: aparecen en las listas (categorías que compra, marcas que no compraría) para que no se adivine de qué es el estudio, **sin preguntas propias**.
- **Nunca se menciona al cliente** ni el estudio en lo que lee el participante. El título que ve es general («Estudio sobre productos para el hogar»).
- Las marcas del cliente van mezcladas con las de la competencia y en orden aleatorio.

## Controles contra quien inventa

- **Una marca que no existe** en la lista de marcas que compra: si la marca, termina. Anota en la nota que hay que confirmar que no exista en el país.
- **Fotos** del producto donde se vean la marca y el aroma o la variante, o del lugar donde guarda los productos.
- **Preguntas que se cruzan**: lo que dice en una abierta tiene que coincidir con la foto; la última compra tiene que ser coherente con «lo compró en los últimos 3 meses».
- **Sobredeclarantes**: quien marca casi todo (más de 7 formatos, por ejemplo) se marca con una **alerta** para revisarlo a mano, no se descarta.
- Lo que solo puede revisar una persona (abiertas vagas, fotos) va en una **nota para el equipo**, no como descarte automático.

## Filtros de seguridad estándar

Van en todos los filtros, salvo que los insumos digan otra cosa:

- **Giros**: quien trabaja (o su familia o amigos cercanos) en publicidad o marketing, investigación de mercados, medios, o en la fabricación o venta de la categoría del estudio, termina. Otros giros van de disimulo.
- **Estudios recientes**: quien participó en un estudio de la misma categoría en los últimos 6 meses termina; otros temas no.
- **Aceptación de las condiciones** del estudio (visita, grabación, cámara, verificación): tiene que aceptarlas todas.

## Perfiles y cuotas

- Cada **perfil** es un tipo de persona con su cuota (de la propuesta o del kick-off): «Aerosoles 6, Reeds 6». Quién entra se escribe como condición sobre las respuestas.
- Los perfiles de una misma marca del cliente comparten **grupo**: así un rechazo a esa marca deja fuera de todos sus perfiles (`excluyeGrupos`).
- Criterios que solo reparten (mitad y mitad por edad, 70 % mujeres, variedad de hogares) no son condición del perfil: van en una **nota** para quien recluta.
- Si un criterio depende del perfil (edad distinta para cada marca), va en la condición del perfil, no como descarte general.

## NSE

- Las preguntas las pone el Hub con el cuestionario oficial del país (en México, la regla AMAI vigente). En la estructura solo se marca la sección con `nse: true`.
- **El NSE nunca descarta.** Lo que pide un perfil («C+», «C a D+») va en su condición y, si no coincide, la persona entra con una alerta para que el equipo decida.
- Si el país no tiene regla cargada en el Hub, no hay sección de NSE: dilo en `supuestos`.

## País

- Cada filtro dice su país. Cambia cómo se pide la dirección, la regla de NSE y cómo se le habla al participante (ver `redaccion.md`).
