# Generador de guías de tópicos — paquete para Hub Sapience (v2)

Para pasárselo a Claude Code dentro del Hub. Es la versión 2 del paquete original (`~/Downloads/guias-hub`, con su `CONTEXTO.md` y `prototipo.html`). Trae las mejoras que salieron de llevar el generador a Empathy Scale (octubre 2026) y está adaptado a cómo está hecho el Hub: mismo patrón que **Propuestas** (`src/serverUtils/propuestas/`, `src/api/*Propuesta*`, `src/components/propuestas/`).

## Qué es

Una herramienta para que el equipo de Sapience arme guías de tópicos para sesiones de grupo, mini grupos, tríadas y entrevistas a profundidad. Se puede partir de tres lugares:
- **Un roadmap que ya existe** (bloques, minutos y objetivos): se pega o se sube y se convierte en tabla editable.
- **Un brief:** Claude propone el roadmap y señala las decisiones metodológicas que tomó.
- **Solo un tema:** Claude propone el roadmap a partir del tema y de los datos del proyecto.

También se pueden armar los bloques a mano. Con el roadmap revisado, Claude escribe la guía bloque por bloque con la voz de los moderadores de Sapience, cada texto se puede corregir y la guía se descarga en Word con la plantilla de la agencia.

## Qué cambió respecto al paquete original

| Mejora | Por qué |
|---|---|
| Las reglas viven en una **skill** (`skill/SKILL.md` + `references/`), igual que Propuestas | Una sola fuente de reglas. Sirve sola en Claude Code o claude.ai y como system prompt en el Hub. |
| Tercer punto de partida: **solo el tema** (además de roadmap y brief), y armar los bloques **a mano** | Muchas veces no hay brief formal. |
| **Modelo por etapa:** roadmap con `claude-sonnet-5-5` y redacción con `claude-opus-5-5` | El prototipo escribía con el nivel «complex». Con un modelo menor la guía salía escueta. |
| **Volumen calibrado y explícito por bloque:** cada prompt de bloque dice «este bloque dura N minutos: escribe alrededor de N/2 preguntas principales… que ronde las 16·N palabras» | La regla original («una pregunta por minuto») daba guías del doble de las reales (≈ 4,100 palabras, 14 páginas para 120 min). Calibrada con las 8 guías de Sapience (≈ 2,000 palabras, 85–150 «¿», ≈ 7 páginas): con los mismos bloques bajó de 4,114 a 1,939 palabras y de 284 a 150 «¿». |
| **Reglas para no sesgar** (`redaccion.md`): primero lo espontáneo, sin palabras, conceptos ni ejemplos que el participante no haya dicho, sin presuponer, balanceando lo positivo y lo negativo | Las guías metían conceptos y términos del estudio («natural», «limpio»…) antes de que salieran solos. Ahora abren espontáneo y dejan nota al moderador. |
| `maxTokens` de 16 000 para bloques y **error claro si la respuesta se corta** (`stop_reason: max_tokens`) | Antes, un bloque largo podía llegar truncado y fallar como «JSON inválido». |
| **System prompt con caché** | Las ~8 llamadas de una guía comparten la skill entera; con caché se cobra una vez. |
| Respuesta de Claude **validada con zod** y un reintento pidiendo solo el JSON | Patrón de Propuestas. |
| Al cambiar el roadmap, **se conserva lo ya escrito** en los bloques que quedaron igual (`realinearGuia`) | Antes, ajustar el roadmap borraba toda la guía. |
| **Guardado con versión:** si dos personas editan la misma guía, la segunda recibe un aviso para recargar | Antes, la última en guardar pisaba a la otra. |
| **Tope de uso de IA** por persona y por hora, y lista opcional de quién puede usarlo | Para que un error o un bucle no se coma el presupuesto, y para probarlo antes de abrirlo. |
| **Word:** el constructor vive en la skill (`scripts/word.mjs`) y lo usa el Hub tal cual | Orden de esquema corregido en `rPr`/`pPr`, sin caracteres de control, sin renglones vacíos, «(Bloque por escribir)» en bloques vacíos y el tema en la carátula. Validado abriéndolo en Word. |
| Edición en pantalla: clic abre un cuadro de texto; **Esc** deshace, **Cmd+Enter** guarda, dejarlo vacío quita el texto; botón «+ pregunta» | Más simple y robusto que `contenteditable`. |

## Qué contiene y a dónde va

| En el paquete | Destino en el Hub |
|---|---|
| `skill/` (SKILL.md, references, assets con la plantilla y las 8 guías, scripts/word.mjs) | `src/serverUtils/guias/skill/` |
| `codigo/serverUtils/guias/*.ts` | `src/serverUtils/guias/` |
| `codigo/api/*.ts` (9 endpoints) | `src/api/` |
| `codigo/generate-py-guias.txt` | Pegar en `server/generate.py`, junto a `'Propuestas'` |
| `referencia/empathy-ui/` | No se copia: es la interfaz de Empathy, referencia del comportamiento |

`skill/assets/ejemplo_guia.json` es una guía completa real (7 bloques escritos por Opus) en el formato del constructor del Word. Sirve como referencia del formato; es anterior a la calibración del largo, así que mide el doble de lo que se busca.

## Pasos para integrarlo

1. **Skill y servidor:** copia `skill/` a `src/serverUtils/guias/skill/` y `codigo/serverUtils/guias/*` a `src/serverUtils/guias/`. Las rutas relativas ya asumen esos destinos (`../../../server/compat`, `./skill/...`).
2. **Endpoints:** copia `codigo/api/*` a `src/api/`. Son `createEndpoint` con zod, como el resto; los de IA llevan `streaming: true` y `conLatido` para mantener viva la conexión.
3. **Tabla:** pega el bloque de `codigo/generate-py-guias.txt` en `server/generate.py` y vuelve a correrlo. Se regeneran `schema.sql`, `schema-map.ts` y `types.ts`, que no se editan a mano. Aplica el SQL nuevo a Supabase como se hizo con `propuestas` y agrega `export const GuiasTopicos = createModel(pool, 'GuiasTopicos');` en `server/compat/index.ts`.
4. **Conflicto de versión:** agrega `'CONFLICT'` → 409 en `server/compat/errors.ts`; `saveGuia` lo usa.
5. **Dependencias:** `npm install jszip`. `@anthropic-ai/sdk` ya está por Propuestas. `construir.ts` resuelve jszip a través de pptxgenjs; para guías conviene tenerla directa.
6. **Variables de entorno:**
   - Ya existe: `ANTHROPIC_API_KEY`.
   - Opcionales:
     - `GUIAS_MODELO_ROADMAP` (default `claude-sonnet-5-5`).
     - `GUIAS_MODELO_BLOQUE` (default `claude-opus-5-5`).
     - `GUIAS_ALLOWED_EMAILS`: correos separados por coma; vacío = todo el equipo.
     - `GUIAS_LIMITE_HORA` (default 150).
7. **Front:**
   - Registra los 9 endpoints en `src/shims/zite-endpoints-sdk.ts`: los de streaming (`generateGuiaRoadmap`, `adjustGuiaRoadmap`, `generateGuiaBloque`) con `callStreaming`, como `generatePropuestaEsqueleto`; el resto como los demás.
   - Arma la interfaz en `src/components/guias/` con shadcn, `lucide-react` y `sonner`, reutilizando `useLlamadaLarga` y `PasoUi` de `components/propuestas/`. El comportamiento está abajo y en `referencia/empathy-ui/`.
8. **Descarga del Word:** `getGuiaWord` devuelve `{ nombre, base64 }` (unos 60 KB) y el front lo convierte en Blob. Si se prefiere el patrón de Propuestas (guardar cada versión en Storage y devolver una URL firmada), se cambia solo ese endpoint.

## La interfaz (comportamiento que hay que conservar)

Tres pasos con indicador clicable: **Proyecto**, **Roadmap** y **Guía**. Una lista de guías guardadas con abrir y borrar, y botón de nueva guía.

- **Proyecto:**
  - Punto de partida: «Tengo el roadmap», «Tengo el brief» o «Solo tengo el tema».
  - Según el caso, se pega el texto o se sube el archivo (Word: mammoth en el navegador, las tablas como renglones separados por « | »), o se escribe el tema.
  - Campos: proyecto, tipo de sesión, duración (120 por defecto), muestra, estímulos y notas.
- **Roadmap:**
  - Si aún no hay, se elige «Los armo yo» (warm up de 5 min más un bloque vacío) o «Proponer / Leer».
  - Tabla editable: nombre, minutos y objetivos uno por renglón, con subir, bajar, quitar y agregar bloque.
  - Arriba se ven los minutos que suma contra la duración, con «cuadra», «faltan N» o «sobran N». Aparece un aviso junto a los minutos que no son múltiplo de 5.
  - Los **supuestos** se muestran en un recuadro, con «Ya lo revisé».
  - Hay un campo para pedir un ajuste en palabras y la opción de volver a proponer.
  - Al aplicar un roadmap nuevo, usa `realinearGuia` para no perder lo ya escrito.
- **Guía:**
  - «Escribir la guía» manda los bloques de dos en dos; cada uno aparece en cuanto está listo, con «escribiendo…» mientras tanto.
  - Si uno falla, se queda con «Reintentar» sin detener a los demás.
  - Cada texto (frase del moderador, subtemas, indicaciones, preguntas, opciones y notas) se corrige con un clic; los `**` se ven en negritas.
  - Cada bloque tiene «Rehacer» con un comentario; arriba están «Reescribir toda», «Copiar texto» y «Descargar Word».
- **Confirmaciones** con el diálogo del Hub ante todo lo que borra trabajo: reemplazar el roadmap cuando ya hay guía, reescribir toda, quitar un bloque escrito, descargar con bloques vacíos.
- **Guardado automático:**
  - La guía se crea al empezar y se guarda sola cerca de 1 s después de cada cambio (`saveGuia` con `version`), una escritura a la vez.
  - Si llega el aviso de conflicto, se muestra «Otra persona la cambió» con botón para recargar.
  - Se avisa antes de salir si hay cambios sin guardar.

## Decisiones que tiene que tomar Sergio

- **Dónde vive.** La tabla trae `project_id`. Si se liga a `Projects`, la guía se abre desde la ficha del proyecto y el campo «Proyecto» se llena solo. También podría vivir en Deals, como Propuestas.
- **Quién la usa.** Por defecto, todo el equipo autenticado ve y edita; borra quien la creó, Owner o Socio (`datos.ts`). Para probarla primero, `GUIAS_ALLOWED_EMAILS`.
- **Modelo de redacción.** Opus 5.5 es lo probado en Empathy: 7 bloques en unos 2 minutos y unos 20 000 tokens de salida por guía. Propuestas usa `claude-fable-5-1` como «el más nuevo»; se cambia con `GUIAS_MODELO_BLOQUE`.

## Cómo probarlo

- **La skill sola:**

  ```bash
  cd skill/scripts && npm install && node construir_word.mjs ../assets/ejemplo_guia.json prueba.docx
  ```

  Sale la guía de ejemplo en Word con el formato de Sapience.
- **En el Hub:**
  - Los casos del paquete original: leer el roadmap de Vichy Collagen y comparar con la guía entregada, y proponer desde el brief de Planeta para comparar con `Planeta V2`.
  - Además, una guía desde solo el tema.
  - Revisa que una guía de 120 minutos ronde las 2,000 palabras (unas 7 páginas) y que los bloques abran espontáneo, sin términos del estudio. Si las preguntas suenan genéricas o largas, se afina `skill/references/redaccion.md` con ejemplos de `assets/guias-ejemplo/`.
- **Pruebas automáticas:** en Empathy (`server/guias.test.ts`) hay pruebas con Claude simulado que vale portar. Cubren permisos, conflicto de versión, el contexto que llega al prompt, el modelo por etapa, el volumen por bloque, los errores de IA y que el Word salga con el contenido escapado.
