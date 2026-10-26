# El formato del filtro (JSON)

Así guarda el Hub un filtro. `assets/ejemplos/hogar.json` es un filtro completo en este formato. Todo lo que escribas tiene que pasar la revisión del Hub (al final de este archivo): si algo queda mal armado, no se guarda.

## El filtro

```
{
  "version": 2, "pais": "MX",
  "tituloPublico": "…", "bienvenida": "…", "despedida": "…", "noCalifica": "…",
  "secciones": [ … ],
  "frentes": [ … ], "alertas": [ … ],
  "claves": { "nombre": "id", "telefono": "id", "edad": "id", "genero": "id" }
}
```

`version`, `pais` y la regla de NSE (`nse`) los pone el Hub, igual que la sección `hub_inicio` («Antes de empezar»: aviso de privacidad, nombre, celular, correo e identificación), que va primero en todo filtro y no se toca. `claves` dice qué pregunta tiene el nombre (`hub_nombre`), el celular (`contacto_celular`), la edad y el género, para mostrarlos en el panel.

## Secciones

```
{ "id": "…", "titulo": "…", "intro": "texto opcional al entrar",
  "mostrarSi": Condicion,          // opcional: la sección solo aparece si se cumple
  "repetirPor": "idPregunta",      // opcional: se repite por cada opción marcada en esa pregunta (de varias, de una sección anterior)
  "repetirSolo": ["idOpcion", …],  // opcional: solo esas opciones abren repetición
  "preguntas": [ … ] }
```

Una sección es una pantalla en el celular. En una sección que se repite, «{opcion}» en títulos y textos se cambia por el `corto` (o el `label`) de cada opción.

## Preguntas

Campos comunes: `id`, `tipo`, `texto`, `nombre`; opcionales `ayuda` (bajo la pregunta), `opcional: true` (se puede dejar sin contestar; por defecto todas son obligatorias), `mostrarSi`, `nota` (lógica para el equipo, nunca la ve el participante).

Formato en `texto`, `ayuda`, `intro`, la bienvenida y las despedidas: `**así**` es negrita y `==así==` va en color. Lo pone el analista: **consérvalo tal cual** al reescribir esos textos y no lo agregues por tu cuenta. Las opciones, filas, títulos y nombres cortos no llevan formato.

| tipo | para qué | lleva |
|---|---|---|
| `texto` | abierta corta (nombre, aroma, sucursal) | opcional `patron` (expresión regular) y `patronMensaje` |
| `texto_largo` | abierta larga | |
| `numero` | edad, personas en el hogar | `min`, `max` (lo que acepta); `terminaFuera` |
| `telefono` | celular de 10 dígitos | |
| `correo` | correo | |
| `direccion` | calle, número, colonia, ciudad, estado, código postal | |
| `unica` | una sola respuesta, en botones | `opciones` |
| `multiple` | varias respuestas, en botones | `opciones`; opcional `maxOpciones` |
| `lista` | una sola, en lista desplegable (listas largas: estados, municipios) | `opciones` |
| `lista_multiple` | varias, en lista con buscador | `opciones` |
| `matriz` | una respuesta por fila (frecuencia por categoría, quién se encarga de qué) | `filas` y `opciones` (las columnas); opcional `reglasMatriz` |
| `matriz_multiple` | varias por fila | `filas` y `opciones` |
| `ordenar` | ranking | `opciones`; opcional `maxOpciones` («tus 3 favoritas») |
| `escala` | 0 a 10 (o `min`/`max`) | opcional `etiquetas: { "min": "Nada probable", "max": "Muy probable" }` |
| `estrellas` | 1 a 5 | |
| `deslizador` | 0 a 100 | opcional `paso`, `etiquetas` |
| `casilla` | una casilla («Acepto…»); si es obligatoria hay que marcarla | |
| `interruptor` | sí o no | |
| `foto` | fotos desde el celular (hasta 3) | |
| `contenido` | texto sin pregunta (instrucciones) | |

- **`nombre`** es el nombre corto de la pregunta: el encabezado de su columna en el tablero de Reclutamiento y en el Excel (el participante no lo ve). De 1 a 3 palabras, sin signos de interrogación, como lo escribiría el equipo: «Edad», «Género», «Hijos», «Código postal», «Marcas que compra», «Marca favorita», «Rechazo de marcas», «Aviso de privacidad». Distinto de los demás nombres del filtro; en una sección que se repite, distinto dentro de la sección y sin el nombre de la opción (la columna ya lleva el del bloque: «Tu aerosol · Marcas que compra»). Lo lleva toda pregunta menos `contenido`.
- **Imágenes** (`imagen_unica`, `imagen_multiple`, y `imagen` en una opción o arriba de una pregunta): úsalas cuando te lo pidan o cuando el screener que conviertes las trae (selector con imágenes). Si te dan los enlaces de las imágenes (https://…), ponlos en `imagen` de cada opción; el Hub guarda su copia. Si no te los dan, deja las opciones sin `imagen`: la persona las pone después (la pregunta se guarda igual y queda como pendiente). Nunca inventes enlaces. Si mostrar fotos ayudaría y nadie lo pidió, usa `unica` o `multiple` y sugiérelo en `supuestos`.
- **Una o varias lo dice el tipo**: `unica`, `lista` y `matriz` son de una; `multiple`, `lista_multiple` y `matriz_multiple` son de varias.
- `casilla` e `interruptor` guardan `"si"` o `"no"`: en la lógica se usan como opciones con esos ids.

Más campos:

- `aleatorio: true`: las opciones en orden aleatorio (las `fija: true` se quedan en su lugar).
- `opcionesDe: "idPregunta"`: las opciones son las que marcó en esa pregunta (anterior); `opcionesExtra` agrega opciones al final («Ninguno en los últimos 3 meses»). Dentro de una repetición, toma lo marcado en la misma repetición. No lleva `opciones`.
- `terminaFuera: { "min": 25, "max": 65, "motivo": "…" }`: en número o escala, fuera de ese rango no califica.
- `terminaSi: { "si": Condicion, "motivo": "…" }`: no califica si se cumple, una vez contestada la pregunta (puede usar la misma pregunta).
- **«No califica» no corta el filtro**: la persona contesta todo, el motivo se registra y al final ve el mismo mensaje que todos (así nadie aprende dónde se corta y vuelve a llenarlo falseando). Solo si el pedido lo dice explícitamente, agrega `"cortar": true` (en la opción, en `terminaFuera`, en `terminaSi` o en la regla de la matriz) para que el filtro termine ahí.
- `reglasMatriz: [{ "fila": "idFila", "columnas": ["idOpcion"], "termina": "motivo" }]` o con `"excluyeGrupos": ["grupo"]`.

## Opciones

```
{ "id": "…", "label": "Lo que lee el participante",
  "corto": "nombre corto para {opcion}",   // opcional
  "termina": "motivo interno",             // si la marca, no califica (contesta todo; se registra)
  "descarta": "motivo interno",            // solo en secciones que se repiten: no cuenta ese bloque, el filtro sigue
  "excluyeGrupos": ["grupo"],              // queda fuera de los perfiles de ese grupo (rechazo a la marca)
  "otra": true,                            // pide escribir cuál («Otra, ¿cuál?»)
  "exclusiva": true,                       // «Ninguno»: al marcarla se quitan las demás (solo en las de varias)
  "fija": true }                           // no se mueve con el orden aleatorio
```

Los motivos (`termina`, `descarta`) son internos: los lee el equipo en el panel, nunca el participante. Escríbelos cortos y claros: «Trabaja en publicidad», «Marcó una marca que no existe».

## Condiciones (lógica)

```
{ "pregunta": "id", "incluye": ["idOpcion", …] }        // marcó alguna de esas
{ "pregunta": "id", "noIncluye": ["idOpcion", …] }      // no marcó ninguna de esas
{ "pregunta": "id", "incluyeTodas": ["idOpcion", …] }   // marcó todas esas
{ "numero": "id", "entre": [25, 55] }                   // número o escala entre esos dos (incluidos)
{ "nse": ["C+", "C"] }                                  // solo en perfiles: su NSE es uno de esos (si no, alerta)
{ "todas": [Condicion, …] }                             // y
{ "alguna": [Condicion, …] }                            // o
{ "no": Condicion }                                     // no
```

En secciones que se repiten:

- La clave de una respuesta dentro de la repetición es por opción. Desde fuera del bloque se pregunta por un bloque con `"instancia": "idOpcion"`: `{ "pregunta": "espacios", "instancia": "esfera", "incluye": ["auto"] }`.
- `{ "bloque": "idSeccion", "opcion": "idOpcion" }`: tiene ese bloque y no lo descartó.
- `{ "instanciaEs": ["idOpcion"] }`: dentro de la sección que se repite, la pregunta solo sale en ese bloque («solo especializado»).

Una condición solo puede usar preguntas que van **antes** de donde se usa. Los perfiles y las alertas se evalúan al final y pueden usar cualquiera.

## Perfiles, alertas y claves

En el JSON, los perfiles van en la lista `"frentes"` (es su nombre interno); a la persona siempre se le dice «perfiles».

```
"frentes": [{ "id": "…", "nombre": "Aerosoles", "grupo": "marca_a", "meta": 6,
  "califica": { "todas": [ { "bloque": "aroma_bloque", "opcion": "aerosol" }, { "numero": "edad", "entre": [25, 55] }, { "nse": ["C+"] } ] } }]
"alertas": [{ "texto": "Marcó más de 7 aromatizantes: posible sobredeclarante", "contar": { "pregunta": "formatos_uso", "masDe": 7 } },
            { "texto": "…", "si": Condicion }]
```

- Quien cumple algún «no califica» no entra a ningún perfil. Quien no cumple ninguno entra a todos los perfiles cuya condición cumple, menos los de grupos que excluyó.
- **Califica quien no cumple ningún «no califica», contesta todo y entra a al menos un perfil.** Por eso todo filtro lleva al menos un perfil; si el estudio tiene un solo perfil, es un perfil con la cuota total.
- Las alertas no descartan: marcan la respuesta para revisarla.

## Ids

- Solo letras minúsculas, números y guion bajo; sin `@`, `#` ni punto. Cortos y que digan qué son: `edad`, `formatos_uso`, `aerosol`.
- **Si te dan un id, lo usas tal cual**: los de la estructura y los de lo que ya está escrito. Es la clave de la columna en el tablero; cambiarlo rompe el tablero y la lógica de otras secciones.
- Lo nuevo que agregues lleva un id que empiece con `nuevo_` (`nuevo_marcas`, `nuevo_1`): el Hub le pone su id definitivo y cambia con él todas las referencias de tu respuesta.
- Los ids de opciones solo tienen que ser únicos dentro de su pregunta.

## Lo que revisa el Hub (y no deja guardar)

- ids repetidos, ids con `@`, `#` o punto, preguntas sin texto;
- preguntas de opciones sin opciones, o con opciones en un tipo que no las lleva;
- `exclusiva` o `maxOpciones` en una pregunta de una sola respuesta;
- `descarta` fuera de una sección que se repite; `termina`, `descarta` u `otra` en algo que no es de opciones;
- matriz sin filas; filas fuera de una matriz;
- `min` mayor o igual que `max`; rango o `terminaFuera` en algo que no da número; `patron` fuera de texto o inválido;
- `repetirPor` u `opcionesDe` hacia una pregunta que no existe, que va después o que no es de varias (`repetirPor`) o de opciones (`opcionesDe`);
- lógica que usa una pregunta que no existe o que va después; un bloque que no es de una sección que se repite;
- `nse` en una condición si el filtro no tiene regla de NSE;
- claves que apuntan a preguntas que no existen.

El Hub también avisa si la lógica nombra una opción que no existe en su pregunta (esa regla nunca se cumpliría).
