import { toast } from 'sonner';

/** Copia un valor y avisa. Devuelve si pudo copiarlo (para que quien llama cambie su ícono solo si funcionó). */
export async function copiar(valor: string, etiqueta: string, fallo = 'No se pudo copiar. Selecciona el link y cópialo a mano.'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(valor);
    toast.success(`${etiqueta} copiado`);
    return true;
  } catch {
    toast.error(fallo);
    return false;
  }
}
