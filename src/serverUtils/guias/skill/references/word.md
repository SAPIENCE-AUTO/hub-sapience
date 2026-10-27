# El Word

El documento se arma sobre `assets/plantilla-guia.docx`: es una guía de la agencia vaciada, que conserva el encabezado con el logo de Sapience, los estilos con Source Sans Pro y la viñeta de la agencia (lista `numId` 18). El cuerpo se genera con `scripts/word.mjs` y se inserta donde dice `{{BODY}}` en `word/document.xml`.

## Orden del documento

1. **Carátula**: el nombre del proyecto, el tema si lo hay y la **Muestra** (un renglón por perfil; «N sesiones de grupo con…» va en negritas).
2. **Road map**: el párrafo fijo («A continuación, se muestra el flujo general de la sesión de grupo…») y la tabla con número, bloque temático, tiempo y objetivos.
3. **Desarrollo de guía de tópicos** (en página nueva): el texto fijo sobre preguntas abiertas y las **Indicaciones generales**.
4. **Un recuadro por bloque**: barra oscura con «N. Nombre (X min.)» y, debajo, la frase del moderador, los subtemas, las preguntas con viñeta, las opciones con sub-viñeta y las notas en gris. Un bloque sin escribir sale como «(Bloque por escribir)».
5. **Cierre y agradecimientos.**

## Reglas del armado

- Los textos se escapan para XML y se quitan los caracteres de control que Word no acepta.
- Los renglones vacíos de objetivos o de muestra no se imprimen.
- `**texto**` se imprime en negritas.
- Los hijos de `w:rPr` y `w:pPr` van en el orden del esquema de Word (Word rechaza o «repara» el archivo si no).

## Uso

```bash
cd scripts && npm install          # una vez
node scripts/construir_word.mjs guia.json "Guía de sesiones.docx"
```

En el Hub, el servidor importa `construirWord()` de `scripts/word.mjs` y devuelve el archivo (ver el README del paquete).
