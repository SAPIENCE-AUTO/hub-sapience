// Adaptado de streamvault/src/lib/derivedStatus.ts (getGranularPipeline) —
// mismo concepto de 3 pasos derivados (Subido → Video listo → Transcrito)
// en vez de un solo texto de status, para que se vea de un vistazo qué
// falta sin tener que abrir la minuta.
export type PipelineStepState = 'done' | 'processing' | 'pending' | 'error';
export interface PipelineStep { key: string; label: string; state: PipelineStepState }

export interface MeetingPipelineInput {
  status?: string;
  muxPlaybackId?: string;
  transcript?: string;
  assemblyTranscriptId?: string;
}

export function getMeetingPipeline(r: MeetingPipelineInput): PipelineStep[] {
  const step1: PipelineStep = { key: 'uploaded', label: 'Subido', state: 'done' };

  let step2State: PipelineStepState = 'processing';
  if (r.muxPlaybackId) step2State = 'done';
  else if (r.status === 'fatal') step2State = 'error';
  const step2: PipelineStep = { key: 'video', label: 'Video listo', state: step2State };

  let step3State: PipelineStepState = 'pending';
  if (r.transcript) step3State = 'done';
  else if (r.status === 'transcription_error') step3State = 'error';
  else if (r.assemblyTranscriptId) step3State = 'processing';
  const step3: PipelineStep = { key: 'transcribed', label: 'Transcrito', state: step3State };

  return [step1, step2, step3];
}
