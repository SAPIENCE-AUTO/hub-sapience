import { useMemo, type ReactNode } from 'react';
import BuscadorTranscripcion from './BuscadorTranscripcion';
import { useBusquedaTranscripcion } from './useBusquedaTranscripcion';

// Las transcripciones guardadas solo como texto (sin turnos con tiempos): el texto tal cual, con la misma búsqueda que la transcripción sincronizada.
export default function MeetingTranscriptTexto({ texto }: { texto: string }) {
  const textos = useMemo(() => [texto], [texto]);
  const busqueda = useBusquedaTranscripcion(textos);
  const partes: ReactNode[] = [];
  let pos = 0;
  (busqueda.resultado.porTexto[0] ?? []).forEach((r, k) => {
    if (r.inicio > pos) partes.push(texto.slice(pos, r.inicio));
    partes.push(
      <mark
        key={k}
        data-coincidencia={k}
        style={{ backgroundColor: k === busqueda.actual ? 'rgba(234,179,8,1)' : 'rgba(234,179,8,0.55)', color: '#000', borderRadius: 2 }}
      >
        {texto.slice(r.inicio, r.fin)}
      </mark>,
    );
    pos = r.fin;
  });
  if (pos < texto.length) partes.push(texto.slice(pos));

  return (
    <>
      <div className="mb-3">
        <BuscadorTranscripcion
          value={busqueda.consulta}
          onChange={busqueda.setConsulta}
          total={busqueda.total}
          actual={busqueda.actual}
          onAnterior={busqueda.anterior}
          onSiguiente={busqueda.siguiente}
          onLimpiar={busqueda.limpiar}
        />
      </div>
      <div ref={busqueda.contenedorRef} className="text-sm whitespace-pre-wrap leading-relaxed max-h-[calc(90vh-16rem)] overflow-y-auto pr-1">{partes}</div>
    </>
  );
}
