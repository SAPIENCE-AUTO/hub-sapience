import { useState } from 'react';
import { generateMeetingSummary, updateMeetingSummary } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

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

// Minutas / notetaker (sep 2026): "en el formato de sharpli" pero con la
// pieza nueva que Sharpli no tiene — acuerdos con checkbox. meetingType se
// elige aquí (no antes) porque no se conoce hasta que alguien clasifica la
// junta; regenerar con otro tipo es solo volver a elegir y dar clic de nuevo.
export default function MeetingSummaryPanel({
  meetingRecordingId, transcript, summaryJson, onSummaryChange,
}: {
  meetingRecordingId: string;
  transcript?: string;
  summaryJson?: SummaryJson;
  onSummaryChange: (next: SummaryJson) => void;
}) {
  const [meetingType, setMeetingType] = useState<string>(MEETING_TYPES[0]);
  const [generating, setGenerating] = useState(false);

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
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{summaryJson.resumen}</p>

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
    </div>
  );
}
