---
name: sapience-guias-de-topicos
description: Arma guías de tópicos de Sapience para sesiones de grupo, mini grupos, tríadas y entrevistas a profundidad, con el roadmap (bloques, minutos y objetivos), la guía escrita bloque por bloque con la voz de los moderadores de Sapience y el Word con el formato de la agencia. Úsala cuando alguien pida una guía de tópicos, una guía de sesiones o de entrevistas, o pegue un brief o un roadmap para convertirlo en guía.
---

# Guías de tópicos Sapience

Esta skill convierte un roadmap, un brief o solo un tema en una guía de tópicos lista para el moderador. La guía tiene que leerse como si la hubiera escrito un moderador de Sapience: preguntas abiertas, en español de México coloquial, agrupadas por subtemas, con notas al moderador, y con el volumen justo para el tiempo de cada bloque.

Antes de escribir, lee los tres archivos de referencia:
- `references/redaccion.md` — la voz de las guías de Sapience, el volumen por tiempo y lo que no se escribe.
- `references/estructura.md` — reglas del roadmap, forma de cada bloque y formato JSON de roadmap y bloques.
- `references/word.md` — cómo se arma el Word sobre la plantilla de la agencia.

Las guías reales de las que salen las reglas están en `assets/guias-ejemplo/` (Jet, Landscape agua y lácteos, Planeta V1 y V2, Xalapa Día de Muertos y VIDA). Úsalas como referencia de tono cuando dudes. `assets/ejemplo_guia.json` es una guía completa en el formato de esta skill.

## Flujo de trabajo

1. **Reunir los datos del proyecto.** Proyecto (marca y estudio), tipo de sesión, duración (120 minutos si no se dice), muestra (un perfil por renglón), estímulos que se van a mostrar y notas del equipo. Pregunta todo junto, en un solo mensaje, solo lo que cambie la guía; lo demás decídelo con criterio.
2. **Armar el roadmap** según de dónde se parta:
   - **Ya hay roadmap** (pegado o en un archivo): conviértelo a bloques sin inventar bloques ni cambiar su orden.
   - **Hay brief:** propón el roadmap con las reglas de `estructura.md`.
   - **Solo hay un tema:** propón el roadmap a partir del tema y del contexto del proyecto, con las mismas reglas.
   En los dos últimos casos anota en `supuestos` las decisiones metodológicas que tomaste sin que el brief o el tema las resolvieran.
3. **Presentar el roadmap y esperar el visto bueno.** Muestra la tabla (bloque, minutos, objetivos), cuántos minutos suma contra la duración y los supuestos. La persona puede mover, quitar, agregar bloques o pedir ajustes en palabras; aplica el ajuste y conserva todo lo demás.
4. **Escribir la guía bloque por bloque**, en el orden del roadmap, con `redaccion.md`. Cada bloque abre con la transición del moderador desde el bloque anterior, no adelanta temas del siguiente y no repite lo que cubren otros. El volumen se calcula por tiempo: alrededor de una pregunta principal cada 2 minutos de bloque; una guía de 120 minutos ronda las 2,000 palabras (unas 7 páginas).
5. **Revisar** que cada objetivo del roadmap esté cubierto, que el volumen corresponda a los minutos, que no haya jerga de marketing frente al participante ni preguntas de sí o no sin seguimiento, y que los estímulos lleven primero ejercicio individual por escrito.
6. **Construir el Word** con `node scripts/construir_word.mjs guia.json salida.docx` (instala una vez con `npm install` dentro de `scripts/`). `guia.json` tiene la forma de `assets/ejemplo_guia.json`.
7. **Entregar** el .docx con una o dos frases sobre las decisiones que tomaste y lo que la persona debe completar (estímulos, nombres de marcas, datos que no venían).

## Reglas que no se negocian

- **No se inventa información** sobre la marca, el mercado ni el consumidor: sale del brief, del tema o de lo que diga la persona. Lo que es hipótesis va en `supuestos`, no se afirma en la guía.
- Al leer un roadmap existente **no se inventan bloques ni se cambia su orden**. Si un bloque no trae minutos, va en 0 y se señala en `supuestos`.
- Los tiempos van en **múltiplos de 5** y deben **sumar la duración** de la sesión, salvo que la persona pida otra cosa.
- **Completa pero a la medida del tiempo**: un bloque de 30 minutos lleva alrededor de 15 preguntas principales (cada una con uno o dos seguimientos como mucho); un warm up de 5, 2 o 3. Ningún objetivo queda sin preguntas, pero es una guía para el moderador, no un cuestionario.
- **No sesgar**: primero lo espontáneo; ni palabras, ni conceptos, ni ejemplos que el participante no haya dicho; nada de presuponer. Ver «Para no sesgar la conversación» en `redaccion.md`.
- Frente al participante, **palabras de consumidor**: nada de insight, RTB, brand role, territorio ni claim.
- Cuando se muestra un estímulo, **primero el ejercicio individual por escrito** y después la discusión.

## Modo Hub

En Hub Sapience la interfaz resuelve los pasos 1, 3 y 7 (formulario, tabla editable del roadmap y descarga del Word). Cada llamada pide un solo entregable y se responde únicamente con un objeto JSON válido con el formato de `estructura.md`, sin texto antes ni después y sin bloques de código. Todas las reglas de esta skill siguen vigentes.
