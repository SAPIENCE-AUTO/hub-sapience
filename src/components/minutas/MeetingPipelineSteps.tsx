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
  return <div className={`h-0.5 w-4 rounded-full shrink-0 ${done ? 'bg-emerald-400' : 'bg-border'}`} />;
}

// Adaptado de streamvault/src/components/PipelineSteps.tsx — con etiqueta
// visible bajo cada punto (no solo title="" al pasar el mouse, que Sergio
// probó y no se entendía a simple vista).
export default function MeetingPipelineSteps({ recording }: { recording: MeetingPipelineInput }) {
  const steps = getMeetingPipeline(recording);
  return (
    <div className="flex items-start gap-0">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center">
          <div className="flex flex-col items-center gap-0.5">
            <StepDot state={step.state} />
            <span className={`text-[9px] leading-tight whitespace-nowrap ${
              step.state === 'done' ? 'text-emerald-600 font-medium' :
              step.state === 'processing' ? 'text-primary font-medium' :
              step.state === 'error' ? 'text-destructive font-medium' :
              'text-muted-foreground/60'
            }`}>
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && <Connector done={step.state === 'done'} />}
        </div>
      ))}
    </div>
  );
}
