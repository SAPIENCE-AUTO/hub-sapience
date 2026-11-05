import { BrowserRouter, Routes, Route } from 'react-router-dom';
import FormularioPublicoPage from './pages/FormularioPublicoPage';
import NdaPage from './pages/NdaPage';

/**
 * Lo único que se carga en el dominio de los participantes (sharpli.mx, ver
 * lib/formularios/dominio.ts): el formulario, el aviso de privacidad y la página
 * para firmar el NDA (/nda/:token, ver docs/nda.md). Ni el inicio de sesión ni
 * ninguna otra pantalla del Hub; cualquier otra dirección ve una página vacía y neutra.
 */
export default function SoloFormularios() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/f/:codigo" element={<FormularioPublicoPage />} />
        <Route path="/nda/:token" element={<NdaPage />} />
        <Route path="*" element={<NoExiste />} />
      </Routes>
    </BrowserRouter>
  );
}

function NoExiste() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F6F6F7] px-6 text-center text-[15px] text-[#62626B]">
      Este enlace no existe.
    </div>
  );
}
