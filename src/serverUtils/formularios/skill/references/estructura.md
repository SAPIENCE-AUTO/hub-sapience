# La estructura (etapa 1)

La estructura se revisa rápido antes de que se escriban las preguntas. Dice quién se busca, cuántos de cada perfil y por dónde pasa el participante, con las preguntas en una línea. Con ella se calculan los minutos contra el tope de 10.

## Formato

```
{
  "pais": "MX",
  "tituloPublico": "Estudio sobre productos para el hogar",
  "perfil": "A quién se busca en general, en 2 o 3 frases: edad, género, NSE, ciudad, qué compra o usa, qué no puede ser.",
  "frentes": [{ "id": "aerosoles", "nombre": "Aerosoles", "grupo": "marca_a", "meta": 6, "quien": "Compró aerosol en los últimos 3 meses, 25 a 55 años, NSE C+." }],
  "secciones": [{
    "id": "aroma_formatos", "titulo": "Aromatizantes",
    "para": "Qué formatos usa y cuáles compró: decide qué bloques se abren.",
    "aparece": "Solo si compra aromatizantes.",            // opcional
    "repetirPor": "idPregunta", "repetirSolo": ["idOpcion"], // opcional, si la sección se repite
    "nse": true,                                           // solo en la sección del NSE (sin preguntas: las pone el Hub)
    "preguntas": [{
      "id": "formatos_uso", "tipo": "multiple", "nombre": "Formatos que usa",
      "texto": "¿Cuáles de estos aromatizantes usas en tu casa o en tu auto?",
      "opciones": [{ "id": "aerosol", "label": "Aerosol (lata que rocías)", "corto": "aerosol" }],
      "filas": [{ "id": "…", "label": "…" }],             // solo matrices
      "opcionesDe": "idPregunta",                          // si sus opciones salen de otra
      "soloSi": "Solo si no marcó Ninguno.",               // opcional
      "logica": "Más de 7 marcados: alerta de sobredeclarante." // opcional, en palabras
    }]
  }],
  "supuestos": ["…"]
}
```

## Cómo se arma

- `perfil` es a quién se busca en general; los **perfiles** con su cuota van en la lista `"frentes"` (su nombre interno). A la persona siempre se le dice «perfiles».
- **Perfiles y cuotas** salen de la propuesta o del kick-off, con sus nombres. `quien` dice en palabras quién entra (lo vuelve condición la etapa final). Perfiles de la misma marca del cliente, mismo `grupo`.
- **Secciones en orden de embudo** (ver `reglas.md`): aviso, contacto y perfil, filtros de seguridad, categorías, formatos, bloques por formato, rechazo de marcas, NSE, condiciones. Cada sección dice `para` qué está, en una frase.
- **Preguntas en una línea**: `texto` es la redacción propuesta (la etapa 2 la pule). Las de opciones llevan **todas sus opciones** con id; así se calculan bien los minutos y la lógica de otras secciones puede usarlas.
- `tipo` es el que va a tener (ver `contrato.md`); una o varias decidido por lo que se pregunta.
- `nombre` es el nombre corto de la columna, de 1 a 3 palabras («Edad», «Marcas que compra»; ver `contrato.md`).
- La sección del NSE va con `"nse": true` y sin preguntas.
- **Ids** cortos y que digan qué son (`edad`, `formatos_uso`, `aerosol`). Si la estructura ya trae ids, se conservan.
- **Minutos**: apunta a 10 o menos por el camino común. Lo que se repite cuenta varias veces.

## Supuestos

Una frase cada uno, con de dónde salió o por qué se decidió:

- datos que no venían y se decidieron («No dicen la ciudad: dejé código postal para filtrar por zona después»);
- de dónde salió cada dato importante («Tomé la edad de 25 a 55 de la lámina de target»);
- reglas de `reglas.md` que no aplican a este estudio y por qué;
- lo que conviene confirmar antes de salir a campo («Confirmar que la marca trampa no exista en el país»).

No repitas lo que ya dice la estructura.

## Ajustar una estructura

Cuando se pide un ajuste, llega la estructura actual con sus ids y lo que se pide cambiar:

- Conserva el id de cada sección, pregunta y opción que sigue. Lo nuevo lleva id que empiece con `nuevo_`.
- Pon `"cambia": false` en cada sección que no tocas (el Hub la deja exactamente como estaba) y `"cambia": true` en las que cambias o agregas.
- Cambia solo lo que se pide y lo que eso obliga a cambiar (si quitas una pregunta, también lo que dependía de ella). En `supuestos`, solo lo nuevo que decidiste.
