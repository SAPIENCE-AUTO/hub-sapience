# Guías de tópicos — guía del módulo

Guía viva del generador de **guías de tópicos** del Hub: pestañita «Guías» dentro de **Tools** de cada proyecto, junto a Swipe, Ejes y Prework. Cada sesión que trabaje en él: lee esta guía antes de tocar nada y, al terminar, actualiza la bitácora.

## Qué es

Arma la guía de tópicos de una sesión de grupo, mini grupo, tríada o entrevista a profundidad en tres pasos: **Proyecto** (de dónde se parte y los datos), **Roadmap** (bloques con minutos y objetivos) y **Guía** (las preguntas de cada bloque, con la voz de los moderadores de Sapience). Se parte de un roadmap que ya existe, de un brief o solo del tema; también se pueden armar los bloques a mano. La guía se corrige con un clic en cualquier texto y se descarga en Word con la plantilla de la agencia.

Quién la ve: **todo el equipo**, cualquiera que entra al Hub (desde el 2026-10-26; antes fue solo para Sergio mientras se probaba). `puedeVerGuias` en `src/lib/guias/acceso.ts` decide si se ve la pestañita; el candado real es `exigirAccesoGuias`, en el servidor. Se puede volver a acotar sin tocar el código con `GUIAS_ALLOWED_EMAILS` en Render (correos separados por coma, o `*` para todo el equipo). La pestaña Tools del proyecto la ve quien tenga alguna herramienta: Swipe (y Ejes y Prework) según sus listas en `ProjectHubPage.tsx`, o las guías (todo el equipo); quien solo tiene las guías ve únicamente «Guías». La portada del proyecto muestra su tarjeta de Swipe solo a quien tiene Swipe.

## Dónde está

- `src/serverUtils/guias/` — el servidor:
  - `skill/` — las reglas en un solo lugar, como Propuestas: `SKILL.md`, `references/` (`redaccion.md`, `estructura.md`, `word.md`) y `scripts/word.mjs` (arma el Word sobre `assets/plantilla-guia.docx`). Es el system prompt de todas las llamadas, con caché. Las 8 guías reales de ejemplo y el ejemplo completo en JSON **no** viajan al servidor: están en `paquetes/guias-topicos/skill/assets/`.
  - `claude.ts` (llamadas con zod, un reintento si el JSON no cumple, error claro si la respuesta se corta por largo, «Detener» que llega hasta Claude), `prompts.ts` (el volumen de cada bloque), `esquemas.ts` (topes de lo que entra), `normalizar.ts`, `word.ts`, `archivo.ts` (Word, .txt o .md → texto; las tablas salen como un renglón por fila con « | »), `acceso.ts` (candado y tope de uso de la IA por persona y hora), `datos.ts`.
- `src/api/` — 10 endpoints: `createGuia` (una guía nueva se llama como el proyecto; las repetidas del mismo proyecto salen como «(2)», «(3)»…), `getGuias`, `getGuia`, `saveGuia`, `deleteGuia`, `leerArchivoGuia`, `getGuiaWord` y los tres de IA con avance (`generateGuiaRoadmap`, `adjustGuiaRoadmap`, `generateGuiaBloque`).
- `src/lib/guias/` — lo que comparten el servidor y la pantalla (`types.ts`, `acceso.ts`) y los helpers de la pantalla.
- `src/components/guias/` — la pantalla (`GuiasTab` es la entrada); se monta como pestañita de `ProjectToolsTab.tsx` (`ProjectHubPage.tsx` le pasa el proyecto y si la persona puede verla).
- Tabla `guias_topicos` (definida en `generate.py`, EXTRA_TABLES; el CREATE real: `server/scripts/add-guias-topicos-table.ts`, no se ejecuta solo). Todo el estado de una guía va en `estado jsonb` (datos del proyecto, el roadmap o brief pegado, el roadmap armado y la guía escrita): se lee y se escribe entero, nunca se consulta por dentro. `version` sube con cada guardado y evita que dos personas se pisen (409 «Otra persona la cambió»). Borrado suave con `deleted_at`; borra quien la creó, un Owner o un Socio.
- Pruebas: `server/scripts/test-guias.ts` (contra PGlite con el esquema real y una Claude de mentiras) y `server/scripts/test-guias-ui.ts` (lo puro de la pantalla).
- El paquete original sigue en `paquetes/guias-topicos/` (README, skill completa con las guías reales, referencia de la UI de Empathy).

## Reglas que salen de las guías reales de Sapience

- **Volumen calibrado por bloque:** una pregunta principal cada 2 minutos y unas 16 palabras por minuto (≈ 2,000 palabras, 85–150 «¿» y 7 páginas para 120 minutos). Cada llamada de bloque lleva el número concreto de ese bloque. Con «una por minuto» salían guías del doble de largo.
- **Para no sesgar:** primero lo espontáneo, sin palabras, conceptos ni ejemplos que el participante no haya dicho, sin presuponer, balanceando lo positivo y lo negativo, y la marca del cliente no se nombra antes de su bloque. Las palabras vedadas por el equipo van como nota al moderador.
- **Modelo por etapa:** el roadmap con `claude-sonnet-5-5` y la redacción de los bloques con `claude-opus-5-5` (cambian con `GUIAS_MODELO_ROADMAP` y `GUIAS_MODELO_BLOQUE`). Una guía de 6 bloques son 7 llamadas (1 de Sonnet y 6 de Opus de dos en dos), unos 13,000 tokens de salida y alrededor de 70 segundos.
- Al cambiar el roadmap se conserva lo ya escrito solo en los bloques que quedaron igual (`realinearGuia`).
- Lo que escribe la IA nunca inventa información de la marca ni del mercado: lo que sea hipótesis va en «supuestos», que la persona revisa.

## Límites conocidos

- La lectura de archivos acepta Word (.docx), .txt y .md hasta 10 MB; los PDF no.
- El tope de uso de la IA (150 llamadas por persona y hora, `GUIAS_LIMITE_HORA`) se cuenta en la memoria del proceso: un reinicio del servidor lo reinicia.
- El Word usa la plantilla de Sapience (Source Sans Pro); la versión de Empathy cambió el 17 de octubre a Montserrat incrustada, roadmap compacto en la primera página y 1–2 objetivos por bloque. Falta decidir si Sapience lo adopta.

## Bitácora

- **2026-10-26 — integración:** el paquete del 5 de octubre pasó al Hub: servidor, tabla, pantalla como pestaña de cada proyecto y pruebas. Probado de punta a punta con la IA de verdad (tema → roadmap → 6 bloques → Word, en una base en memoria): 1,716 palabras y 124 «¿» para 120 minutos, dentro de lo calibrado.
- **2026-10-26 (noche) — a Tools:** por pedido de Sergio la pantalla pasó de pestaña propia del proyecto a pestañita de Tools (sin cambios de servidor ni de base).
- **2026-10-26 (noche) — para todo el equipo:** Sergio pidió que todos tengan acceso: `puedeVerGuias` pasó a «cualquiera que entra al Hub», Tools se muestra a quien tenga alguna herramienta y quien solo tiene las guías ve solo «Guías». Todo el equipo puede abrir, editar y bajar el Word de cualquier guía; borra quien la creó, un Owner o un Socio.
- **Siguiente:** prellenar la muestra con la de Reclutamiento → Muestra; usar la transcripción del kick-off de Notetaker como brief; decidir el estilo del Word; probar con los casos reales del paquete original (un roadmap para leer y un brief para proponer) y afinar `redaccion.md` si algo suena genérico.
