import { Projects, Deals } from '../../server/compat';

// Minutas / notetaker (sep 2026): sugerencia de vínculo por naming —
// "mejor esfuerzo", nunca certera. Solo compara el asunto de la junta contra
// nombres de proyectos/deals ya existentes; si no hay match razonable, la
// UI ofrece vincular a mano (linkMeetingRecording.ts) en vez de forzar uno.
function normalize(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MIN_MATCH_LEN = 4;

function namesOverlap(subject: string, candidate: string): boolean {
  const a = normalize(subject);
  const b = normalize(candidate);
  if (a.length < MIN_MATCH_LEN || b.length < MIN_MATCH_LEN) return false;
  return a.includes(b) || b.includes(a);
}

export interface MeetingLinkSuggestion {
  projectId?: string;
  projectName?: string;
  dealId?: string;
  dealName?: string;
}

/** Prioriza proyecto sobre deal — una junta post-aprobación suele referirse al proyecto ya en curso, no al deal que le dio origen. */
export async function suggestMeetingLink(subject: string): Promise<MeetingLinkSuggestion> {
  if (!subject?.trim()) return {};

  const { records: projects } = await Projects.findAll({ limit: 500, fields: ['fullName', 'projectCode'] });
  for (const p of projects) {
    if (p.fullName && namesOverlap(subject, p.fullName)) {
      return { projectId: p.id, projectName: p.fullName };
    }
  }

  const { records: deals } = await Deals.findAll({ limit: 10_000, fields: ['dealName'] });
  for (const d of deals) {
    if (d.dealName && namesOverlap(subject, d.dealName)) {
      return { dealId: d.id, dealName: d.dealName };
    }
  }

  return {};
}
