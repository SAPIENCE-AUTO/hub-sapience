import { Check, Loader2, X } from 'lucide-react';
import { getMeetingPipeline, type MeetingPipelineInput, type PipelineStepState } from './meetingPipeline';

function StepDot({ state }: { state: PipelineStepState }) {
  const base = 'h-4 w-4 rounded-full flex items-center justify-center shrink-0';
  if (state === 'done') return <span className={`${base} bg-emerald-500`}><Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /></span>;
  if (state === 'processing') return <span className={`${base} bg-primary/20`}><Loader2 className="h-2.5 w-2.5 text-primary animate-spin" /></span>;
  if (state === 'error') return <span className={`${base} bg-destructive`}><X className="h-2.5 w-2.5 text-white" strokeWidth={3} /></span>;
  return <span className={`${base} border-2 border-muted-foreground/30`} />;
}

function Connector({ done }: { done: boolean }) {
  return <div className={`h-0.5 w-3 rounded-full ${done ? 'bg-emerald-400' : 'bg-border'}`} />;
}

// Adaptado de streamvault/src/components/PipelineSteps.tsx — versión
// compacta (sin etiquetas visibles, solo title="" con el nombre del paso)
// pensada para caber en una fila de lista, no en una card completa.
export default function MeetingPipelineSteps({ recording }: { recording: MeetingPipelineInput }) {
  const steps = getMeetingPipeline(recording);
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1" title={step.label}>
          <StepDot state={step.state} />
          {i < steps.length - 1 && <Connector done={step.state === 'done'} />}
        </div>
      ))}
    </div>
  );
}
