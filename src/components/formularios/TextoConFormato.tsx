import type { ReactNode } from 'react';
import { COLOR_RESALTADO, leerFormato } from '@/lib/formularios/formato';

/**
 * Un texto del filtro con sus negritas y su resaltado (lib/formularios/formato.ts),
 * igual en el formulario del participante, el celular de muestra y el editor.
 * `enNegrita`: el texto ya va en negritas (la pregunta), así que lo marcado en
 * negritas además se subraya, como en el Word. `pieza` dibuja cada pedazo
 * (en el editor, para mostrar «{opcion}» como marca).
 */
export function TextoConFormato({ texto, enNegrita = false, pieza }: { texto: string; enNegrita?: boolean; pieza?: (texto: string) => ReactNode }) {
  return (
    <>
      {leerFormato(texto).map((t, i) => {
        const contenido = pieza ? pieza(t.texto) : t.texto;
        if (!t.negrita && !t.resaltado) return <span key={i}>{contenido}</span>;
        return (
          <span
            key={i}
            className={t.negrita ? (enNegrita ? 'font-bold underline decoration-[1.5px] underline-offset-[3px]' : 'font-bold') : undefined}
            style={t.resaltado ? { color: COLOR_RESALTADO } : undefined}
          >
            {contenido}
          </span>
        );
      })}
    </>
  );
}
