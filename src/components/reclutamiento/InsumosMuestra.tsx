import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, ImageIcon, Loader2, Mic, Upload, X } from 'lucide-react';
import { saveMuestraInsumos } from 'zite-endpoints-sdk';
import { INFO, TEAL } from '@/lib/toolColors';
import { abrirImagen, esArchivoDeImagen, esCampoDeTexto, imagenesDe, traeArchivos } from '@/lib/swipe/imagenes';
import type { ArchivoInsumo, ReunionInsumo } from '@/lib/formularios/generador';
import { Etiqueta, archivoABase64 } from '@/components/formularios/generador/comun';

export interface VistaInsumos {
  insumos: { notas?: string; archivos: Omit<ArchivoInsumo, 'texto' | 'ruta'>[]; reuniones: ReunionInsumo[] };
  propios: boolean;
  filtro?: { id: string; titulo: string };
}
export type Reunion = ReunionInsumo & { tipo?: string };

const DOCUMENTOS = ['pdf', 'pptx', 'docx', 'xlsx'];
const extension = (nombre: string) => nombre.split('.').pop()?.toLowerCase() ?? '';
const TIPO = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', imagen: 'Imagen' } as const;
const fecha = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
/** Las imágenes van a la IA con el lado largo a lo más 1568 px (más grande no la ve mejor). */
const LADO_MAX = 1568;

/** Una imagen lista para la IA: reducida y en JPEG (las fotos de celular pesan mucho). */
async function imagenParaIA(archivo: File): Promise<{ nombre: string; mime: string; base64: string }> {
  const bitmap = await abrirImagen(archivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen');
  ctx.fillStyle = '#ffffff'; // un PNG con transparencia saldría negro en JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
  const nombre = `${archivo.name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'imagen'}.jpg`;
  return { nombre, mime: 'image/jpeg', base64 };
}

/**
 * Lo que lee la IA para proponer o cambiar la muestra, a la vista y para
 * sumarle cosas: archivos e imágenes (arrastrar y soltar, elegir o pegar),
 * reuniones de Notetaker y texto. Mientras nadie los toca, son los del filtro.
 */
export function InsumosMuestra({ proyectoId, vista, reuniones, ocupado, onCambio }: {
  proyectoId: string; vista: VistaInsumos; reuniones: Reunion[]; ocupado: boolean; onCambio: (v: VistaInsumos) => void;
}) {
  const { insumos } = vista;
  const [notas, setNotas] = useState(insumos.notas ?? '');
  const [subiendo, setSubiendo] = useState<string[]>([]);
  const [encima, setEncima] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const bloqueado = ocupado || subiendo.length > 0;
  const elegidas = new Set(insumos.reuniones.map((r) => r.id));
  // Las del proyecto y, aunque ya no aparezcan ahí, las que están elegidas (las del filtro pueden ser de su deal).
  const lista: Reunion[] = [...reuniones, ...insumos.reuniones.filter((r) => !reuniones.some((x) => x.id === r.id))];
  useEffect(() => setNotas(insumos.notas ?? ''), [insumos.notas]);

  const guardar = async (cambio: Record<string, unknown>) => {
    const r = await saveMuestraInsumos({ proyectoId, ...cambio });
    onCambio(r.insumos as VistaInsumos);
  };

  const guardarNotas = async () => {
    if (notas === (insumos.notas ?? '')) return;
    try { await guardar({ notas }); } catch (e) { toast.error((e as Error).message || 'No se pudo guardar el texto'); }
  };

  const subir = async (archivos: FileList | File[] | null) => {
    const lista = Array.from(archivos ?? []);
    const sirven = lista.filter((a) => esArchivoDeImagen(a) || DOCUMENTOS.includes(extension(a.name)));
    const fuera = lista.filter((a) => !sirven.includes(a));
    if (fuera.length) toast.error(`${fuera.map((a) => `«${a.name}»`).join(', ')}: sube un PDF, PowerPoint, Word, Excel o una imagen.`);
    for (const archivo of sirven) {
      setSubiendo((s) => [...s, archivo.name]);
      try {
        const datos = esArchivoDeImagen(archivo)
          ? await imagenParaIA(archivo)
          : { nombre: archivo.name, mime: archivo.type, base64: await archivoABase64(archivo) };
        await guardar({ archivo: datos });
      } catch (e) {
        toast.error((e as Error).message || `No se pudo subir «${archivo.name}».`);
      } finally {
        setSubiendo((s) => s.filter((n) => n !== archivo.name));
      }
    }
    if (input.current) input.current.value = '';
  };

  const alternarReunion = async (r: Reunion) => {
    const lista = elegidas.has(r.id) ? insumos.reuniones.filter((x) => x.id !== r.id) : [...insumos.reuniones, { id: r.id, titulo: r.titulo, fecha: r.fecha }];
    try { await guardar({ reuniones: lista }); } catch (e) { toast.error((e as Error).message); }
  };

  // Se puede soltar en cualquier parte del recuadro, y pegar una captura (fuera de un campo de texto).
  const arrastre = {
    onDragOver: (e: React.DragEvent) => { if (!traeArchivos(e.dataTransfer)) return; e.preventDefault(); if (!bloqueado) setEncima(true); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false); },
    onDrop: (e: React.DragEvent) => {
      if (!traeArchivos(e.dataTransfer)) return;
      e.preventDefault();
      setEncima(false);
      if (!bloqueado) void subir(e.dataTransfer.files);
    },
    onPaste: (e: React.ClipboardEvent) => {
      if (esCampoDeTexto(e.target)) return;
      const imagenes = imagenesDe(e.clipboardData);
      if (!imagenes.length || bloqueado) return;
      e.preventDefault();
      void subir(imagenes);
    },
  };

  const icono = (tipo: ArchivoInsumo['tipo']) => (tipo === 'imagen' ? ImageIcon : tipo === 'xlsx' ? FileSpreadsheet : FileText);

  return (
    <div className="space-y-4 text-left" tabIndex={-1} {...arrastre}>
      {!vista.propios && vista.filtro && (
        <p className="text-xs text-muted-foreground">Tomados del filtro «{vista.filtro.titulo}».</p>
      )}

      <section className="space-y-1.5">
        <Etiqueta>Archivos e imágenes</Etiqueta>
        <input ref={input} type="file" multiple accept=".pdf,.pptx,.docx,.xlsx,image/*" className="hidden" onChange={(e) => subir(e.target.files)} />
        {insumos.archivos.length > 0 && (
          <ul className="space-y-1">
            {insumos.archivos.map((a) => {
              const Icono = icono(a.tipo);
              return (
                <li key={a.id} className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-sm">
                  <Icono className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.nombre}</span>
                  <span className="text-[11px] text-muted-foreground">{TIPO[a.tipo]}</span>
                  <button type="button" aria-label={`Quitar ${a.nombre}`} disabled={bloqueado} onClick={() => guardar({ quitarArchivo: a.id }).catch((e) => toast.error((e as Error).message))} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-[#D32222]"><X className="h-3.5 w-3.5" /></button>
                </li>
              );
            })}
          </ul>
        )}
        {subiendo.map((n) => <p key={n} className="flex items-center gap-2 px-2.5 py-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{n}</p>)}
        <button
          type="button"
          disabled={bloqueado}
          onClick={() => input.current?.click()}
          className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-4 text-center transition-colors disabled:pointer-events-none disabled:opacity-50 ${encima ? 'border-[#0F3D4D] bg-[#0F3D4D]/[0.05]' : 'border-[#0F3D4D]/25 bg-white hover:border-[#0F3D4D]/50 hover:bg-[#0F3D4D]/[0.02]'}`}
        >
          <Upload className="h-5 w-5" style={{ color: TEAL }} />
          <span className="text-sm font-medium" style={{ color: TEAL }}>{encima ? 'Suelta aquí' : 'Arrastra archivos o imágenes, o haz clic para elegirlos'}</span>
          <span className="text-[11px] text-muted-foreground">PDF, PowerPoint, Word, Excel o imagen · también puedes pegar una captura</span>
        </button>
      </section>

      <section className="space-y-1.5">
        <Etiqueta>Texto</Etiqueta>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          onBlur={guardarNotas}
          disabled={ocupado}
          rows={3}
          placeholder="Técnicas, cuántas, ciudades, fechas, perfiles…"
          className="w-full resize-y rounded-md border bg-white px-3 py-2 text-sm outline-none focus:border-[#0F3D4D]/50"
        />
      </section>

      <section className="space-y-1.5">
        <Etiqueta>Reuniones de Notetaker</Etiqueta>
        {lista.length === 0 && <p className="text-xs text-muted-foreground">Este proyecto no tiene reuniones con transcripción.</p>}
        <ul className="space-y-1">
          {lista.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-white px-2.5 py-1.5 text-sm hover:bg-[#0F3D4D]/[0.02]">
                <input type="checkbox" checked={elegidas.has(r.id)} disabled={bloqueado} onChange={() => alternarReunion(r)} className="h-4 w-4 accent-[#0F3D4D]" />
                <Mic className="h-4 w-4 flex-shrink-0" style={{ color: INFO }} />
                <span className="min-w-0 flex-1 truncate">{r.titulo}</span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">{[r.tipo, fecha(r.fecha)].filter(Boolean).join(' · ')}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Cuántos insumos hay (para el botón del encabezado). */
export const cuantosInsumos = (v: VistaInsumos) => v.insumos.archivos.length + v.insumos.reuniones.length + (v.insumos.notas?.trim() ? 1 : 0);
