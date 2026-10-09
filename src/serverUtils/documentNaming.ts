// Nomenclatura estándar para los documentos que Hub Sapience sube a Teams/
// SharePoint (Timelines, Calendarios): "PROYECTO - temática - Sapience -
// nombre y versión" — pedido explícito de Sergio (sep 2026), tras notar que
// esos archivos solo se guardaban como "proyecto - nombre". temática se omite
// limpio si el proyecto no la tiene (igual que ya hacía el título anterior en
// calendarExcelData.ts / sendTimelineToWebhook.ts, que solo unía temática +
// nombre cuando había temática).
export function buildSapienceDocumentName(parts: {
  projectCode: string;
  tematica?: string | null;
  docLabel: string; // p.ej. "Calendario - V3" o "Timeline - V2"
}): string {
  return [parts.projectCode, parts.tematica || null, 'Sapience', parts.docLabel]
    .filter(Boolean)
    .join(' - ');
}

// gantt-service pone el nombre del archivo en el header Content-Disposition, que solo admite latin-1
// imprimible: un guion largo (–), comillas curvas o un emoji en la temática lo hacían responder 500
// después de armar todo el Excel (NULO, oct 2026). El Hub no usa ese header (sube el archivo con su
// propio nombre), así que a gantt-service se le manda esta versión y a SharePoint la original.
export function nombreSeguroParaHeader(nombre: string): string {
  return nombre.replace(/[^\x20-\x7E\xA0-\xFF]/g, '-');
}
