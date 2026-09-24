import { useState, type ReactNode } from 'react';
import { generateMeetingSummary, updateMeetingSummary } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Markdown } from '@/components/markdown';
import { Sparkles, Loader2, Calendar, Copy, ClipboardCheck, Mail, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { getSectionMeta } from './sectionIcons';
import { markdownToHtml, copyRichText } from '@/lib/markdownToHtml';
import MeetingEmailDraftDialog from './MeetingEmailDraftDialog';

const MEETING_TYPES = [
  'Kick off con cliente',
  'Kick off interno',
  'Brief',
  'Alineación interna de análisis',
  'Follow up de proyecto',
] as const;

interface Acuerdo {
  texto: string;
  responsable?: string | null;
  hecho: boolean;
}
interface SummaryJson {
  resumen: string;
  acuerdos: Acuerdo[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Convierte el children de react-markdown (string u otros nodos) a texto
// plano — suficiente para emparejar la palabra clave del encabezado con su
// ícono, sin necesitar el texto exacto renderizado.
function headingText(children: ReactNode): string {
  return Array.isArray(children) ? children.map(String).join('') : String(children);
}

// Minutas / notetaker (sep 2026): "en el formato de sharpli" pero con la
// pieza nueva que Sharpli no tiene — acuerdos con checkbox. meetingType se
// elige aquí (no antes) porque no se conoce hasta que alguien clasifica la
// junta; regenerar con otro tipo es solo volver a elegir y dar clic de nuevo.
// "quisiera poder usar este resumen/minuta como base para trabajar...
// copiar minuta... copiar action items" (Sergio) agregó los botones de
// copiar (minuta con formato real vía markdownToHtml, acuerdos y
// transcripción en texto plano) y de redactar correo — y "que el formato
// fuera más lindo... le falta color" agregó el header con tipo/fecha y un
// ícono con color por sección, emparejado por palabra clave contra el set
// fijo de encabezados que usan los 5 prompts (ver sectionIcons.tsx).
export default function MeetingSummaryPanel({
  meetingRecordingId, subject, meetingStart, savedMeetingType, transcript, summaryJson, onSummaryChange,
}: {
  meetingRecordingId: string;
  subject?: string;
  meetingStart?: string;
  savedMeetingType?: string;
  transcript?: string;
  summaryJson?: SummaryJson;
  onSummaryChange: (next: SummaryJson) => void;
}) {
  const [meetingType, setMeetingType] = useState<string>(savedMeetingType || MEETING_TYPES[0]);
  const [generating, setGenerating] = useState(false);
  const [emailDraftType, setEmailDraftType] = useState<'interno' | 'cliente' | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateMeetingSummary({ meetingRecordingId, meetingType });
      onSummaryChange(result);
      toast.success('Resumen generado ✓');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar el resumen');
    } finally {
      setGenerating(false);
    }
  };

  const toggleAcuerdo = async (index: number) => {
    if (!summaryJson) return;
    const next: SummaryJson = {
      ...summaryJson,
      acuerdos: summaryJson.acuerdos.map((a, i) => i === index ? { ...a, hecho: !a.hecho } : a),
    };
    onSummaryChange(next);
    try {
      await updateMeetingSummary({ meetingRecordingId, summaryJson: next });
    } catch {
      toast.error('No se pudo guardar el cambio');
      onSummaryChange(summaryJson);
    }
  };

  const copyToClipboard = (text: string, successMessage: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(successMessage),
      () => toast.error('No se pudo copiar — el navegador bloqueó el acceso al portapapeles'),
    );
  };

  const copyTranscript = () => {
    if (!transcript?.trim()) return;
    copyToClipboard(transcript, 'Transcripción copiada');
  };

  const copyAcuerdos = () => {
    if (!summaryJson?.acuerdos.length) return;
    const text = summaryJson.acuerdos
      .map(a => `${a.hecho ? '[x]' : '[ ]'} ${a.texto}${a.responsable ? ` — ${a.responsable}` : ''}`)
      .join('\n');
    copyToClipboard(text, 'Acuerdos copiados');
  };

  // Copia la minuta con formato real (negritas, viñetas) — a diferencia de
  // copyToClipboard, que pega texto plano tal cual, esto convierte el
  // Markdown del resumen a HTML para que Word/Outlook/Gmail lo peguen con
  // viñetas y negritas de verdad, no asteriscos y guiones literales.
  const copyMinuta = async () => {
    if (!summaryJson) return;
    const ok = await copyRichText(markdownToHtml(summaryJson.resumen), summaryJson.resumen);
    if (ok) toast.success('Minuta copiada');
    else toast.error('No se pudo copiar — el navegador bloqueó el acceso al portapapeles');
  };

  if (!summaryJson) {
    if (!transcript?.trim()) {
      return <p className="text-muted-foreground text-sm">Esta minuta todavía no tiene transcripción lista.</p>;
    }
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-4">
        <p className="text-muted-foreground text-sm text-center">No hay resumen aún. Elige el tipo de junta y genéralo con IA.</p>
        <div className="flex items-center gap-2">
          <Select value={meetingType} onValueChange={setMeetingType}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MEETING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generar resumen</>}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="flex flex-wrap items-center gap-2">
          {savedMeetingType && <Badge variant="secondary">{savedMeetingType}</Badge>}
          {meetingStart && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" /> {formatDate(meetingStart)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={copyMinuta}>
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Minuta
          </Button>
          <Button size="sm" variant="outline" onClick={copyAcuerdos} disabled={!summaryJson.acuerdos.length}>
            <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" /> Action items
          </Button>
          <Button size="sm" variant="outline" onClick={copyTranscript} disabled={!transcript?.trim()}>
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Transcripción
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEmailDraftType('interno')}>
            <Mail className="h-3.5 w-3.5 mr-1.5" /> Email interno
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEmailDraftType('cliente')}>
            <Mail className="h-3.5 w-3.5 mr-1.5" /> Email cliente
          </Button>
        </div>
      </div>

      <Markdown
        components={{
          h2: ({ children }) => {
            const { icon: Icon, iconClass, bgClass } = getSectionMeta(headingText(children));
            return (
              <h2 className="flex items-center gap-2">
                <span className={`inline-flex items-center justify-center h-6 w-6 rounded-md shrink-0 ${bgClass}`}>
                  <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
                </span>
                <span>{children}</span>
              </h2>
            );
          },
        }}
      >
        {summaryJson.resumen}
      </Markdown>

      <div>
        <h4 className="text-sm font-semibold mb-2">Acuerdos</h4>
        {summaryJson.acuerdos.length === 0 ? (
          <p className="text-muted-foreground text-sm">No se identificaron acuerdos en esta junta.</p>
        ) : (
          <ul className="space-y-2">
            {summaryJson.acuerdos.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <Checkbox checked={a.hecho} onCheckedChange={() => toggleAcuerdo(i)} className="mt-0.5" />
                <span className={`text-sm ${a.hecho ? 'line-through text-muted-foreground' : ''}`}>
                  {a.texto}
                  {a.responsable && <span className="text-muted-foreground"> — {a.responsable}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Regenerar con otro tipo de junta</summary>
        <div className="flex items-center gap-2 mt-2">
          <Select value={meetingType} onValueChange={setMeetingType}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MEETING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </details>

      <MeetingEmailDraftDialog
        meetingRecordingId={meetingRecordingId}
        emailType={emailDraftType}
        onClose={() => setEmailDraftType(null)}
      />
    </div>
  );
}
