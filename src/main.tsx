import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { esDominioDeFormularios } from './lib/formularios/dominio';
import './index.css';

const raiz = createRoot(document.getElementById('root')!);

// En el dominio de los participantes (sharpli.mx) solo se carga el formulario: el
// código del Hub ni se descarga. Por lo mismo index.html no trae título ni ícono
// (los leen las vistas previas de WhatsApp sin correr nada): el Hub los pone en
// marcaDelHub.ts.
if (esDominioDeFormularios()) {
  document.title = 'Cuestionario';
  import('./SoloFormularios').then(({ default: SoloFormularios }) => raiz.render(<StrictMode><SoloFormularios /></StrictMode>));
} else {
  import('./marcaDelHub');
  import('./App').then(({ default: App }) => raiz.render(<StrictMode><App /></StrictMode>));
}
