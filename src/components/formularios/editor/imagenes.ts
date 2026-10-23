import { uploadFile } from 'zite-file-upload-sdk';
import { abrirImagen } from '@/lib/swipe/imagenes';
import { dimensionesEscaladas } from '@/lib/swipe/concepto';

export { esCampoDeTexto, imagenesDe, traeArchivos } from '@/lib/swipe/imagenes';

/**
 * Imágenes de las preguntas y opciones de un filtro: van a una carpeta
 * pública (como las de Swipe), porque el formulario las muestra sin login.
 * Se achican al subir para que carguen rápido en el celular: con 1200 px de
 * lado largo una imagen se ve nítida a lo ancho de cualquier pantalla.
 */
const CARPETA = 'formularios-imagenes';
const LADO_MAX = 1200;
/** Una imagen que ya es chica y de un formato que todos abren se sube tal cual (también un GIF, para no perder su movimiento). */
const PESO_MAX_SIN_REDUCIR = 600 * 1024;
const TIPOS_SIN_REDUCIR = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const nombreBase = (nombre: string) => nombre.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'imagen';

async function achicada(archivo: File): Promise<File> {
  const bitmap = await abrirImagen(archivo);
  try {
    const grande = Math.max(bitmap.width, bitmap.height) > LADO_MAX;
    if (!grande && archivo.size <= PESO_MAX_SIN_REDUCIR && TIPOS_SIN_REDUCIR.includes(archivo.type)) return archivo;
    const { ancho, alto } = dimensionesEscaladas(bitmap.width, bitmap.height, LADO_MAX);
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar la imagen');
    ctx.fillStyle = '#ffffff'; // un PNG con transparencia saldría negro en JPEG; las opciones van sobre blanco
    ctx.fillRect(0, 0, ancho, alto);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    const blob = await new Promise<Blob>((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo preparar la imagen'))), 'image/jpeg', 0.86));
    return new File([blob], `${nombreBase(archivo.name)}.jpg`, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

/** Achica y sube una imagen; devuelve su URL pública. */
export async function subirImagenFiltro(archivo: File): Promise<string> {
  const lista = await achicada(archivo);
  const { fileUrl } = await uploadFile({ data: lista, filename: lista.name, folder: CARPETA });
  return fileUrl;
}
