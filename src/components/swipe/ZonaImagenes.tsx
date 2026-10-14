import { useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { esArchivoDeImagen, imagenesDe, traeArchivos } from '@/lib/swipe/imagenes';

/**
 * Zona para soltar imágenes o elegirlas con un clic. El pegado (⌘V) no se maneja aquí sino en el editor, que sabe a qué
 * zona le toca según dónde esté el cursor.
 */
export default function ZonaImagenes({ onImagenes, multiple = false, disabled = false, className = '', children }: {
  onImagenes: (archivos: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [encima, setEncima] = useState(false);
  const selector = useRef<HTMLInputElement>(null);

  const recibir = (archivos: File[]) => {
    if (archivos.length === 0) { toast.error('Solo imágenes (PNG, JPG, WebP o GIF).'); return; }
    onImagenes(multiple ? archivos : archivos.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) selector.current?.click(); }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selector.current?.click(); } }}
      onDragEnter={(e) => { if (!disabled && traeArchivos(e.dataTransfer)) { e.preventDefault(); setEncima(true); } }}
      onDragOver={(e) => { if (!disabled && traeArchivos(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation(); // la zona se queda con el archivo: el editor no lo vuelve a tomar
        setEncima(false);
        if (!disabled) recibir(imagenesDe(e.dataTransfer));
      }}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        encima ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:bg-accent/50'
      } ${disabled ? 'pointer-events-none opacity-60' : ''} ${className}`}
    >
      {children}
      <input
        ref={selector}
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        onChange={(e) => {
          recibir(Array.from(e.target.files ?? []).filter(esArchivoDeImagen));
          e.target.value = '';
        }}
      />
    </div>
  );
}
