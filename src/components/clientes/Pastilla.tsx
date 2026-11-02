import { ALERTA, EXITO, GRIS, INFO, PELIGRO } from '@/lib/toolColors';

// Pastilla «sólido chico» del sistema del moodboard (relleno de color, texto blanco, esquinas de 6 px, puntito blanco); el color es lenguaje:
// éxito = listo, alerta = falta algo, gris = sin datos todavía, info = informativo, peligro = problema.
export type TonoPastilla = 'exito' | 'alerta' | 'gris' | 'info' | 'peligro';

const COLOR: Record<TonoPastilla, string> = { exito: EXITO, alerta: ALERTA, gris: GRIS, info: INFO, peligro: PELIGRO };

export default function Pastilla({ tono, children, title }: { tono: TonoPastilla; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white whitespace-nowrap"
      style={{ backgroundColor: COLOR[tono] }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {children}
    </span>
  );
}
