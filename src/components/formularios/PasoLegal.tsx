import { Loader2 } from 'lucide-react';
import { ACUERDO_SECCIONES, ACUERDO_TITULO } from '@/lib/formularios/acuerdo';
import { AYUDA_AVISO } from '@/lib/formularios/inicio';
import { TEXTO_REPASO_AVISO } from '@/lib/formularios/pasos';
import { EnlaceAviso, TextoAviso } from './AvisoPrivacidad';

/** La liga a /f/aviso que cita el acuerdo, para poder tocarla. */
function ConLigaDelAviso({ texto }: { texto: string }) {
  const [antes, despues] = texto.split('sharpli.mx/f/aviso');
  if (despues === undefined) return <>{texto}</>;
  return <>{antes}<a href="/f/aviso" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">sharpli.mx/f/aviso</a>{despues}</>;
}

/** El acuerdo de confidencialidad completo, con el nombre de quien lo acepta arriba si ya lo dio en «Antes de empezar». */
function TextoAcuerdo({ nombre }: { nombre?: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-[#45454D]">
      <h2 className="text-[20px] font-semibold leading-snug text-[#1F1F23]">{ACUERDO_TITULO}</h2>
      <p>{nombre ? <>Yo, <b className="font-semibold text-[#1F1F23]">{nombre}</b> (nombre completo), declaro que:</> : 'Declaro que:'}</p>
      {ACUERDO_SECCIONES.map((s) => (
        <div key={s.titulo} className="space-y-2">
          <h3 className="pt-2 text-[15px] font-semibold text-[#1F1F23]">{s.titulo}</h3>
          {s.parrafos.map((p, i) => <p key={i}><ConLigaDelAviso texto={p} /></p>)}
        </div>
      ))}
    </div>
  );
}

/**
 * Una de las dos pantallas de ley de todo filtro (lib/formularios/pasos.ts): el aviso de privacidad, con su texto completo en la página, justo después de la bienvenida, o el acuerdo de
 * confidencialidad, al final, con «Leí y acepto». Cada una con su botón para aceptar y «No acepto» (termina ahí). El acuerdo deja volver atrás a revisar lo contestado.
 */
export function PasoLegal({ tipo, nombre, enMarco, enviando, falla, onElegir, onAtras }: {
  tipo: 'aviso' | 'acuerdo';
  nombre?: string;
  enMarco: boolean;
  enviando?: boolean;
  falla?: string;
  onElegir: (acepta: boolean) => void;
  onAtras?: () => void;
}) {
  return (
    <>
      <div className={`flex-1 px-5 pt-6 ${enMarco ? 'pb-8' : 'pb-52'}`}>
        {tipo === 'aviso'
          ? (
            <>
              <p className="mb-5 text-[15px] leading-relaxed text-[#45454D]">{AYUDA_AVISO}</p>
              <TextoAviso />
            </>
          )
          : <TextoAcuerdo nombre={nombre} />}
        {falla && <p className="mt-6 rounded-xl bg-[#FBEAEA] px-4 py-3 text-[14px] text-[#C2272D]">{falla}</p>}
      </div>
      <div className={`${enMarco ? 'sticky' : 'fixed inset-x-0'} bottom-0 z-20 border-t border-[#E4E4E7] bg-white/95 px-5 py-3 backdrop-blur`}>
        <div className="mx-auto max-w-lg">
          <button onClick={() => onElegir(true)} disabled={enviando} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1F1F23] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60">
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            {tipo === 'aviso' ? 'He leído y acepto' : 'Leí y acepto'}
          </button>
          <div className="mt-1 flex items-center justify-between">
            {onAtras
              ? <button onClick={onAtras} disabled={enviando} className="py-2 text-[14px] text-[#62626B]">Atrás</button>
              : <span />}
            <button onClick={() => onElegir(false)} disabled={enviando} className="py-2 text-[14px] font-medium text-[#1F1F23] underline underline-offset-2 disabled:opacity-60">No acepto</button>
          </div>
        </div>
      </div>
    </>
  );
}

/** En «Antes de empezar», para quien ya pasó por el aviso: el recordatorio con la liga para volver a leerlo (el texto lo pidió Sergio, 2026-11-06). */
export function RecordatorioAviso() {
  return (
    <div>
      <p className="text-[16px] font-semibold leading-snug text-[#1F1F23]">Aviso de privacidad</p>
      <p className="mt-1 text-[13px] text-[#62626B]">{TEXTO_REPASO_AVISO}</p>
      <EnlaceAviso className="mt-2" />
    </div>
  );
}
