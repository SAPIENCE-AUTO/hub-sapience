import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { linksDeTalks, type TalksSesionVista } from '@/lib/talksSesion';
import { copiar } from './copiarLink';

/**
 * Cómo se ve la celda «Talks» de la fila de un evento (la lógica está en TalksFilaCell.tsx): sin links, el botón «Crear links de sesión»;
 * con links, «Abrir en Talks» (link del moderador) y los tres links con botón de copiar, en una sola línea. Solo dibuja: no llama al servidor,
 * para poder probarla en Node y verla suelta en el navegador.
 */

const AYUDA_CREAR = 'Crea la transmisión de Mux y la sesión en Talks. Si ya existen, no se duplican.';
const AYUDA_ABRIR = 'Abrir la sesión en Talks (entras directo, sin volver a escribir tu correo)';
const FALLO_AL_COPIAR = 'No se pudo copiar. Abre el evento (el lápiz) y copia el link desde ahí.';

/** Uno de los links: todo el botón copia y la palomita avisa un momento que ya se copió. */
function LinkCopiable({ etiqueta, nombre, valor }: { etiqueta: string; nombre: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(temporizador.current), []);
  return (
    <button
      type="button"
      title={`Copiar ${nombre.toLowerCase()}\n${valor}`}
      aria-label={`Copiar ${nombre.toLowerCase()}`}
      onClick={async () => {
        if (!(await copiar(valor, nombre, FALLO_AL_COPIAR))) return;
        setCopiado(true);
        clearTimeout(temporizador.current);
        temporizador.current = setTimeout(() => setCopiado(false), 1500);
      }}
      className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md bg-muted text-[11px] font-medium text-foreground/80 hover:bg-muted-foreground/15 hover:text-foreground transition-colors flex-shrink-0"
    >
      {etiqueta}
      {copiado ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

export function TalksFilaVista({ talks, creando, onCrear, abriendo, onAbrir }: {
  talks: TalksSesionVista | undefined; creando: boolean; onCrear: () => void;
  /** Mientras se pide el pase de acceso a Talks el botón «Abrir en Talks» queda apagado (no se aprieta dos veces). */
  abriendo: boolean; onAbrir: () => void;
}) {
  if (!talks) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1" onClick={onCrear} disabled={creando} title={AYUDA_CREAR}>
        {creando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
        {creando ? 'Creando...' : 'Crear links de sesión'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      {/* Un botón, no un link: el clic pide un pase de un solo uso para entrar directo (TalksFilaCell.tsx); si no se puede, abre el link normal del moderador. */}
      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1 flex-shrink-0" onClick={onAbrir} disabled={abriendo} title={AYUDA_ABRIR}>
        {abriendo ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
        Abrir en Talks
      </Button>
      {linksDeTalks(talks).map((l) => <LinkCopiable key={l.etiqueta} etiqueta={l.etiqueta} nombre={l.nombre} valor={l.valor} />)}
    </div>
  );
}
