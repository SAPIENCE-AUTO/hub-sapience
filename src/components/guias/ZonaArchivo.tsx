import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { leerArchivoGuia } from 'zite-endpoints-sdk';
import { TEAL } from '@/lib/toolColors';

const EXTENSIONES = ['docx', 'txt', 'md'];
export const MAX_BYTES = 10 * 1024 * 1024;

const extension = (nombre: string) => nombre.split('.').pop()?.toLowerCase() ?? '';
const traeArchivos = (data: DataTransfer | null | undefined) => !!data && Array.from(data.types ?? []).includes('Files');

function leerBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(archivo);
  });
}

/**
 * Subir el roadmap o el brief: Word, .txt o .md. Se lee en el servidor y el texto vuelve al cuadro para revisarlo. Se puede soltar el archivo en cualquier parte del paso
 * (`arrastre` va en el contenedor) o en el recuadro.
 */
export function useSubirArchivo(alTexto: (texto: string, nombre: string) => void, deshabilitado = false) {
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const subir = async (archivos: FileList | File[] | null) => {
    const lista = Array.from(archivos ?? []);
    if (lista.length === 0) return;
    const buenos = lista.filter((a) => EXTENSIONES.includes(extension(a.name)));
    const malos = lista.filter((a) => !buenos.includes(a));
    if (malos.length) toast.error(`${malos.map((a) => `«${a.name}»`).join(', ')}: sube un Word (.docx) o un texto (.txt, .md).`);
    const archivo = buenos[0];
    if (!archivo) { if (inputRef.current) inputRef.current.value = ''; return; }
    if (buenos.length > 1) toast.info(`Se lee un archivo a la vez: se usó «${archivo.name}».`);
    if (archivo.size > MAX_BYTES) { toast.error(`«${archivo.name}» pesa más de 10 MB.`); if (inputRef.current) inputRef.current.value = ''; return; }
    setSubiendo(archivo.name);
    try {
      const r = await leerArchivoGuia({ nombre: archivo.name, base64: await leerBase64(archivo) });
      const texto = String(r?.texto ?? '').trim();
      if (!texto) toast.error(`«${archivo.name}» no trae texto.`);
      else alTexto(texto, archivo.name);
    } catch (e) {
      toast.error((e as Error).message || `No se pudo leer «${archivo.name}».`);
    } finally {
      setSubiendo(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const libre = !deshabilitado && !subiendo;
  const arrastre = {
    onDragOver: (e: DragEvent) => { if (!traeArchivos(e.dataTransfer)) return; e.preventDefault(); if (libre) setEncima(true); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false); },
    onDrop: (e: DragEvent) => {
      if (!traeArchivos(e.dataTransfer)) return;
      e.preventDefault();
      setEncima(false);
      if (libre) void subir(e.dataTransfer.files);
    },
  };

  return { subiendo, encima, subir, arrastre, inputRef, deshabilitado };
}

export type Subida = ReturnType<typeof useSubirArchivo>;

export function ZonaArchivo({ subida }: { subida: Subida }) {
  const ocupado = subida.deshabilitado || !!subida.subiendo;
  return (
    <div>
      <input
        ref={subida.inputRef}
        type="file"
        accept=".docx,.txt,.md"
        className="hidden"
        aria-label="Elegir archivo"
        onChange={(e) => void subida.subir(e.target.files)}
      />
      <button
        type="button"
        disabled={ocupado}
        onClick={() => subida.inputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-center transition-colors disabled:pointer-events-none disabled:opacity-50 ${subida.encima ? 'border-[#0F3D4D] bg-[#0F3D4D]/5' : 'border-border hover:border-[#0F3D4D]/40 hover:bg-[#0F3D4D]/[0.02]'}`}
      >
        {subida.subiendo ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: TEAL }} /> : <Upload className="h-4 w-4" style={{ color: TEAL }} />}
        <span className="text-sm font-medium" style={{ color: TEAL }}>
          {subida.subiendo ? `Leyendo «${subida.subiendo}»…` : subida.encima ? 'Suelta el archivo aquí' : 'Arrastra el archivo aquí o haz clic para elegirlo'}
        </span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">Word, .txt o .md · hasta 10 MB</span>
      </button>
    </div>
  );
}
