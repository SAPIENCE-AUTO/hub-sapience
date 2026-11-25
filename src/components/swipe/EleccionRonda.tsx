import { useRef, useState } from 'react';
import { Check } from 'lucide-react';

export interface OpcionRonda {
  id: string;
  titulo: string;
  descripcion?: string;
  imagenUrl?: string;
}

/** Cada imagen de la ronda lleva su letra (A, B, C…), la misma en el celular y en la pantalla proyectada. */
export const LETRAS_RONDA = 'ABCDEFGH';

interface Props {
  nombre: string;
  pregunta?: string;
  opciones: OpcionRonda[];
  eleccionInicial?: string;
  /** Guarda la elección en el servidor; si no se pudo, devuelve { ok: false } (o lanza) y aquí se deshace la marca. */
  onElegir: (ideaId: string, msDecision: number) => Promise<{ ok: boolean; motivo?: string }>;
}

/**
 * Pantalla del celular en una ronda de «elegir entre las imágenes»: las imágenes ocupan la pantalla una sobre otra y se
 * toca la que gana. La elección se marca al instante y se puede cambiar mientras la ronda siga abierta. La marca se
 * dice con palabras y con un palomeo, no solo con color.
 */
export default function EleccionRonda({ nombre, pregunta, opciones, eleccionInicial, onElegir }: Props) {
  const [elegida, setElegida] = useState<string | null>(eleccionInicial ?? null);
  const [aviso, setAviso] = useState('');
  const desde = useRef(Date.now());

  const elegir = async (id: string) => {
    if (id === elegida) return;
    const anterior = elegida;
    setElegida(id);
    setAviso('');
    try {
      const res = await onElegir(id, Date.now() - desde.current);
      if (!res.ok) {
        setElegida(anterior);
        setAviso(res.motivo === 'ronda_cerrada' ? 'Esta ronda ya se cerró.' : 'No se pudo guardar tu elección. Intenta de nuevo.');
      }
    } catch {
      setElegida(anterior);
      setAviso('No se pudo guardar tu elección. Revisa tu conexión e intenta de nuevo.');
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-[#0F3D4C] text-white">
      <div className="px-5 pb-3 pt-5">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6FC2DA]">{nombre}</p>
        <h1 className="mt-1 text-[20px] font-bold leading-snug">{pregunta || 'Toca la imagen que prefieras'}</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
        {opciones.map((op, i) => {
          const activa = op.id === elegida;
          return (
            <button
              key={op.id}
              type="button"
              onClick={() => void elegir(op.id)}
              aria-pressed={activa}
              aria-label={`Opción ${LETRAS_RONDA[i] ?? i + 1}${activa ? ', tu elección' : ''}`}
              className={`relative min-h-0 flex-1 touch-manipulation select-none overflow-hidden rounded-2xl bg-white text-left transition-shadow ${
                activa ? 'ring-4 ring-[#3FA9C4] ring-offset-2 ring-offset-[#0F3D4C]' : ''
              }`}
            >
              {op.imagenUrl ? (
                <img src={op.imagenUrl} alt={op.titulo} draggable={false} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full flex-col justify-center gap-2 p-6 text-[#0F3D4C]">
                  <p className="text-[22px] font-bold leading-tight">{op.titulo}</p>
                  {op.descripcion && <p className="text-[15px] text-[#4d6a72]">{op.descripcion}</p>}
                </div>
              )}
              <span className="absolute left-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-[#0F3D4C] text-[16px] font-bold text-white shadow">
                {LETRAS_RONDA[i] ?? i + 1}
              </span>
              {activa && (
                <span className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-[#3FA9C4] px-3 py-1.5 text-[13px] font-bold text-[#0F3D4C] shadow">
                  <Check className="h-4 w-4" strokeWidth={3} /> Tu elección
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="px-5 pb-4 text-center text-[12.5px] text-[#8FB6C0]" role="status">
        {aviso || (elegida ? 'Puedes cambiar tu elección mientras la ronda siga abierta.' : 'Toca una imagen para votar.')}
      </p>
    </div>
  );
}
