import { getSupabaseAdmin } from '../../../server/supabaseAdmin';

// Los NDA firmados llevan datos personales (nombre, firma, correo, IP): viven en un bucket PRIVADO y solo se ven con URL firmada.
// El bucket lo crea server/scripts/add-nda-tables.ts.
export const BUCKET = process.env.NDA_BUCKET ?? 'nda';

export interface AlmacenNda {
  subir(ruta: string, data: Buffer): Promise<void>;
  urlFirmada(ruta: string, segundos?: number): Promise<string>;
}

export const almacenSupabase: AlmacenNda = {
  async subir(ruta, data) {
    const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(ruta, data, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error(`No se pudo guardar el PDF: ${error.message}`);
  },
  async urlFirmada(ruta, segundos = 600) {
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(ruta, segundos);
    if (error || !data) throw new Error(`No se pudo abrir el PDF: ${error?.message}`);
    return data.signedUrl;
  },
};
