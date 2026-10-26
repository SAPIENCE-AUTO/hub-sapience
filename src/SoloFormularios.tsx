import { BrowserRouter, Routes, Route } from 'react-router-dom';
import FormularioPublicoPage from './pages/FormularioPublicoPage';

/**
 * Lo único que se carga en el dominio de los participantes (sharpli.mx, ver
 * lib/formularios/dominio.ts): el formulario y el aviso de privacidad. Ni el
 * inicio de sesión ni ninguna otra pantalla del Hub; cualquier otra dirección
 * ve una página vacía y neutra.
 */
export default function SoloFormularios() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/f/:codigo" element={<FormularioPublicoPage />} />
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
