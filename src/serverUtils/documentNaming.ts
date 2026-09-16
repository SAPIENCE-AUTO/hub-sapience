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
