# Estructura: roadmap y bloques

## Datos del proyecto

| Campo | Qué es |
|---|---|
| `proyecto` | Marca y nombre del estudio. Va en la portada. |
| `tipo` | `Sesión de grupo`, `Mini grupo`, `Tríada` o `Entrevista a profundidad`. Define si se habla de "ustedes" o de "tú". |
| `duracion` | Minutos totales de la sesión (120 si no se dice). |
| `muestra` | Un perfil o grupo por renglón, sin asteriscos, p. ej. «1 sesión de grupo con consumidores lovers de X, 25 a 35 años, NSE C, CDMX». |
| `tema` | Lo que se quiere entender, en palabras de quien arma la guía (cuando no hay brief ni roadmap). |
| `estimulos` | Lo que se va a mostrar: empaques, conceptos, comerciales, precios… |
| `notas` | Lo que el equipo quiere cuidar: hipótesis, temas a evitar, marcas a vigilar. |

## Reglas del roadmap

- El primer bloque es **Warm up de 5 minutos**.
- Los tiempos van en **múltiplos de 5** y deben **sumar exactamente la duración**.
- Normalmente son **entre 5 y 7 bloques**; el bloque central del estudio (la evaluación o el diagnóstico principal) es el más largo.
- Cada bloque lleva **de 2 a 6 objetivos** redactados como lo hace la agencia: «Identificar…», «Validar…», «Entender…», «Hacer una radiografía de la marca en cuanto a: …», «Poner a prueba…».
- Si el brief describe la muestra, propónla; si la persona ya la escribió, respétala.
- En `supuestos` van las **decisiones metodológicas** que tomaste sin que el brief o el tema las resolvieran (por ejemplo, si un benchmark va a ciegas o si algo se explora dentro de otro bloque), una frase cada una.

### Al leer un roadmap que ya existe

Conviértelo sin inventar bloques ni cambiar su orden. Si un bloque no trae minutos, pon 0. Si los objetivos vienen en un párrafo, sepáralos en frases cortas. Si el texto trae la muestra, pásala a `muestra`; si no, deja la que dio la persona. Anota en `supuestos` lo que hayas tenido que interpretar.

### Al ajustar un roadmap

Aplica el ajuste que se pide y conserva todo lo demás. Mantén los tiempos en múltiplos de 5 que sumen la duración, salvo que se pida otra duración.

## Formato del roadmap (JSON)

```json
{"proyecto": "marca y nombre del estudio, si se puede saber",
 "tipo": "Sesión de grupo",
 "duracion": 120,
 "muestra": ["1 sesión de grupo con …"],
 "bloques": [{"nombre": "Warm up", "minutos": 5, "objetivos": ["Get the ball rolling / entrar en calor", "Conocer un poco el contexto de los participantes", "Establecer el tono de la conversación"]}],
 "supuestos": ["decisiones que tomaste porque el texto no las resolvía"]}
```

## Forma de cada bloque

- `moderador`: la frase de transición, sin la palabra «Moderador:».
- `secciones`: los subtemas, en orden. Cada uno con:
  - `subtema`: nombre corto de lo que se explora.
  - `intro` (opcional): instrucción o frase del moderador para ese subtema.
  - `preguntas`: textos de pregunta; cuando una pregunta lleva una lista de opciones o atributos, va como objeto `{"texto": "…", "sub": ["…", "…"]}`.
  - `notas` (opcional): notas al moderador en tercera persona, sin la palabra «Nota:».
- Usa **negritas** (`**así**`) solo para resaltar instrucciones de ejercicio, nunca preguntas completas.
- El primer bloque no lleva transición desde otro; el último puede cerrar con consejos o recomendaciones finales a la marca si encaja.

## Formato de un bloque (JSON)

```json
{"moderador": "frase de transición del moderador",
 "secciones": [
   {"subtema": "nombre corto del subtema",
    "intro": "opcional",
    "preguntas": ["¿Pregunta? ¿Seguimiento?", {"texto": "Por favor díganme qué valoran en cuanto a:", "sub": ["Empaque", "Sabor"]}],
    "notas": ["opcional: nota al moderador en tercera persona"]}
 ]}
```

## La guía completa (`guia.json`)

Los datos del proyecto, más `bloques` (el roadmap) y `guia`: una entrada por bloque, en el mismo orden, con la forma de arriba (`null` si el bloque aún no está escrito). Ver `assets/ejemplo_guia.json`.
