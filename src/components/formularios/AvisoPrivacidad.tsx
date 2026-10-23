import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { getAvisoPrivacidad } from 'zite-endpoints-sdk';

interface Bloque { tipo: 'titulo' | 'parrafo' | 'lista'; texto: string }

/** El aviso se pide una sola vez por página. */
let pedido: Promise<Bloque[]> | null = null;
const cargar = () => (pedido ??= (getAvisoPrivacidad({}) as Promise<{ bloques: Bloque[] }>).then((r) => r.bloques).catch(() => { pedido = null; return []; }));

/** El texto del aviso de privacidad (títulos, párrafos y listas), en los neutros del formulario. */
export function TextoAviso() {
  const [bloques, setBloques] = useState<Bloque[] | null>(null);
  useEffect(() => { void cargar().then(setBloques); }, []);
  if (!bloques) return <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-[#62626B]" />;
  if (!bloques.length) return <p className="py-6 text-[15px] text-[#62626B]">No pudimos cargar el aviso de privacidad. Vuelve a intentar en un momento.</p>;
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-[#45454D]">
      {bloques.map((b, i) => (b.tipo === 'titulo'
        ? <h2 key={i} className={`font-semibold text-[#1F1F23] ${i === 0 ? 'text-[20px]' : 'pt-2 text-[15px]'}`}>{b.texto}</h2>
        : b.tipo === 'lista'
          ? <p key={i} className="flex gap-2 pl-1"><span aria-hidden>•</span><span>{b.texto}</span></p>
          : <p key={i}>{b.texto}</p>))}
    </div>
  );
}

/** «Leer el aviso de privacidad»: lo abre encima del formulario, sin salir de él. */
export function EnlaceAviso({ className = '', texto = 'Leer el aviso de privacidad' }: { className?: string; texto?: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} className={`text-[14px] font-medium text-[#1F1F23] underline underline-offset-2 ${className}`}>
        {texto}
      </button>
      {abierto && (
        <div role="dialog" aria-modal="true" aria-label="Aviso de privacidad" className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-[#E4E4E7] px-5 py-3">
            <span className="text-[15px] font-semibold text-[#1F1F23]">Aviso de privacidad</span>
            <button type="button" aria-label="Cerrar" onClick={() => setAbierto(false)} className="rounded-full p-2 text-[#62626B] hover:bg-[#F4F4F5]"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="mx-auto max-w-lg"><TextoAviso /></div>
          </div>
          <div className="border-t border-[#E4E4E7] px-5 py-3">
            <button type="button" onClick={() => setAbierto(false)} className="mx-auto block w-full max-w-lg rounded-xl bg-[#1F1F23] py-3.5 text-[15px] font-semibold text-white">Volver al cuestionario</button>
          </div>
        </div>
      )}
    </>
  );
}

/** La página del aviso, para mandar el enlace: /f/aviso. */
export function PaginaAviso() {
  return (
    <div className="min-h-dvh bg-white px-5 py-8">
      <div className="mx-auto max-w-lg"><TextoAviso /></div>
    </div>
  );
}
