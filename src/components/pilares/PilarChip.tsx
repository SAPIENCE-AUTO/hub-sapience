// El pilar siempre se muestra con su nombre: el color solo acompaña (hay personas en el equipo que no distinguen algunos colores).
export default function PilarChip({ nombre, color, activo = true, pct }: { nombre: string; color: string; activo?: boolean; pct?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground ${activo ? '' : 'opacity-60'}`}>
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {nombre}
      {pct && <span className="tabular-nums text-muted-foreground">{pct}</span>}
      {!activo && <span className="text-[10px] text-muted-foreground">(inactivo)</span>}
    </span>
  );
}
