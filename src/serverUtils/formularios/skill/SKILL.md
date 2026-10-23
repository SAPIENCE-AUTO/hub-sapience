---
name: sapience-filtros
description: Arma screeners (filtros de reclutamiento) de Sapience para estudios cualitativos, autoaplicados en el celular, a partir de notas, la propuesta o la transcripción del kick-off, o convirtiendo un screener que ya existe en Word. Trabaja en dos etapas (estructura y preguntas) y devuelve el filtro en el formato de Filtros del Hub. Úsala cuando alguien pida un screener, un filtro de reclutamiento o quiera corregir uno.
---

# Filtros de Sapience

Un filtro es el cuestionario corto que contesta una persona en su celular para saber si entra a un estudio cualitativo (sesiones de grupo, entrevistas, visitas en casa, compras acompañadas). Lo arma el equipo de Sapience a partir de lo que pide el estudio: quién se busca, cuántos de cada perfil (perfiles y cuotas) y qué hay que comprobar. Del mismo filtro salen el Word para el cliente, el formulario para participantes y las filas del tablero de Reclutamiento.

Antes de escribir, lee las referencias:

- `references/reglas.md` — las reglas de Sergio para diseñar un screener: embudo, abiertas y opciones, disimulo, controles contra quien inventa, filtros de seguridad, perfiles y cuotas, NSE y tope de 10 minutos.
- `references/redaccion.md` — cómo se le escribe al participante.
- `references/contrato.md` — el formato JSON del filtro (tipos de pregunta, lógica, perfiles, alertas, ids).
- `references/estructura.md` — el formato de la estructura (etapa 1) y cómo se ajusta.

Los ejemplos están en `assets/ejemplos/`: tres filtros reales del equipo, sin marcas. `hogar_word.md` y `hogar.json` son el mismo estudio en Word y en el formato del Hub (visita en casa con bloques que se repiten por formato, controles y dos clientes); `bebidas_frias.md` es un filtro de consumo y actitudes con dos perfiles; `refrescos_cr.md` es de Costa Rica, con perfiles por generación y voseo.

## Flujo de trabajo

1. **Leer los insumos**: notas del equipo, propuesta, transcripción del kick-off o un screener que ya existe. Sacar de ahí el país, el perfil, los perfiles con su cuota, los criterios de cada uno, lo que no puede ser (rechazos, estudios recientes, giros) y las condiciones de participación (visita, grabación, horarios, incentivo).
2. **Etapa 1 · Estructura.** Proponer país, perfil, perfiles con su cuota y quién entra a cada uno, y las secciones en orden de embudo con sus preguntas en una línea. Anotar en `supuestos` todo lo que hubo que decidir sin que los insumos lo dijeran, de dónde salió cada dato importante y qué regla de `reglas.md` no aplica a este estudio. La persona la revisa y la aprueba o pide ajustes.
3. **Etapa 2 · Preguntas.** Con la estructura aprobada, escribir sección por sección: redacción final, todas las opciones y la lógica, conservando los ids que trae la estructura.
4. **Lógica final.** Con todas las secciones escritas, armar quién entra a cada perfil, las alertas, las claves para el panel y los textos de bienvenida, despedida y no califica.
5. **Revisar** contra `reglas.md`: embudo, máximo 10 minutos, una o varias decidido por lo que se pregunta, controles, filtros de seguridad, nada del cliente a la vista y lógica que no dependa de algo que va después.

Si se parte de un **screener que ya existe**, se respeta su redacción, su orden y su lógica: se convierte, no se rediseña. Lo que hubo que interpretar (casillas de Fillout en preguntas de una sola respuesta, instrucciones de encuestador, reglas que no se pueden expresar igual) va en `supuestos`.

## Reglas que no se negocian

- **No se inventa**: país, edades, cuotas, marcas, criterios y condiciones salen de los insumos. Lo que se decide con criterio va en `supuestos`, diciendo de dónde salió («tomé la edad de 25 a 55 de la lámina de target») o por qué se decidió.
- **Nunca se menciona al cliente** ni se deja ver qué marca es la del estudio en lo que lee el participante.
- **Máximo 10 minutos** para quien entra por el camino más común.
- **Las preguntas del NSE no se escriben**: las pone el Hub con el cuestionario oficial del país. Solo se dice dónde van (`nse: true`) y qué NSE pide cada perfil.
- **El NSE nunca descarta**: si no coincide con el perfil, da una alerta.
- **Los ids que ya existen no cambian**: son la clave de la columna en el tablero.
- Si una regla de `reglas.md` no aplica al estudio, se dice en `supuestos`; no se rompe en silencio.

## Modo Hub

En Hub Sapience la interfaz resuelve la lectura de archivos, la revisión de la estructura y el armado del Word. Cada llamada pide un solo entregable (una estructura, una sección, la lógica final o un cambio) y se responde únicamente con un objeto JSON válido con el formato que pide la llamada, sin texto antes ni después y sin bloques de código. Todas las reglas de esta skill siguen vigentes.
