// Port de scripts/icons.js de la skill: dibuja un Feather Icon (react-icons/fi)
// como PNG en base64 para pptxgenjs. Único cambio: si el nombre no existe
// (p. ej. un icono que Claude se inventó) cae a FiCircle en vez de tronar la
// construcción entera.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import * as fi from 'react-icons/fi';

export default async function icon(name: string, color = '#FFFFFF', size = 256): Promise<string> {
  const Comp = (fi as Record<string, React.ComponentType<any>>)[name] ?? fi.FiCircle;
  const svg = renderToStaticMarkup(React.createElement(Comp, { color, size, strokeWidth: 1.5 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}
