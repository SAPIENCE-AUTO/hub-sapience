import { useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { uploadFile } from 'zite-file-upload-sdk';
import type { FotoSubida } from '@/lib/formularios/tipos';

const MAX_FOTOS = 3;

/** `simular`: en la vista Celular del editor la foto se queda en el navegador; nada se sube. */
export function Foto({ valor, codigo, simular, onChange }: { valor: FotoSubida[]; codigo: string; simular?: boolean; onChange: (v: FotoSubida[]) => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [falla, setFalla] = useState('');
  const [vistas, setVistas] = useState<Record<string, string>>({});
  const [encima, setEncima] = useState(false);

  const subir = async (archivos: File[]) => {
    setSubiendo(true);
    setFalla('');
    const nuevas: FotoSubida[] = [];
    try {
      for (const archivo of archivos.slice(0, MAX_FOTOS - valor.length)) {
        const { fileUrl } = simular
          ? { fileUrl: `simulada/${Date.now()}-${archivo.name}` }
          : await uploadFile({ data: archivo, filename: archivo.name, formularioCodigo: codigo });
        setVistas((v) => ({ ...v, [fileUrl]: URL.createObjectURL(archivo) }));
        nuevas.push({ ruta: fileUrl, nombre: archivo.name });
      }
    } catch (err) {
      setFalla((err as Error).message || 'No se pudo subir la foto. Intenta otra vez.');
    }
    if (nuevas.length) onChange([...valor, ...nuevas]);
    setSubiendo(false);
  };

  // En computadora la foto también se puede arrastrar y soltar sobre el recuadro.
  const soltar = (e: React.DragEvent) => {
    e.preventDefault();
    setEncima(false);
    if (subiendo) return;
    const imagenes = Array.from(e.dataTransfer.files).filter((a) => a.type.startsWith('image/'));
    if (imagenes.length) void subir(imagenes);
    else if (e.dataTransfer.files.length) setFalla('Suelta una foto (una imagen).');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {valor.map((f) => (
          <div key={f.ruta} className="relative h-24 w-24 overflow-hidden rounded-xl border border-[#D9D9DE] bg-[#F4F4F5]">
            {vistas[f.ruta]
              ? <img src={vistas[f.ruta]} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-[#62626B]"><Check className="mr-1 h-3 w-3" />Foto subida</div>}
            <button
              type="button"
              onClick={() => onChange(valor.filter((x) => x.ruta !== f.ruta))}
              className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white"
              aria-label="Quitar foto"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {valor.length < MAX_FOTOS && (
        <label
          onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); setEncima(true); } }}
          onDragLeave={() => setEncima(false)}
          onDrop={soltar}
          className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed px-4 py-4 text-[15px] font-medium text-[#1F1F23] ${encima ? 'border-[#1F1F23] bg-[#F4F4F5]' : 'border-[#A1A1AA] bg-white'} ${subiendo ? 'opacity-60' : ''}`}
        >
          {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {subiendo ? 'Subiendo…' : encima ? 'Suelta la foto aquí' : valor.length ? 'Agregar otra foto' : 'Tomar o elegir foto'}
          <input
            type="file" accept="image/*" className="hidden" disabled={subiendo}
            onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) void subir([a]); }}
          />
        </label>
      )}
      {falla && <p className="text-[13px] text-[#C2272D]">{falla}</p>}
    </div>
  );
}
