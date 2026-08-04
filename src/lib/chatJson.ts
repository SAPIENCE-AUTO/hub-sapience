// Centralized JSON helpers for chat fields

export type Reactions = Record<string, string[]>;
export type Attachment = { url: string; name: string; type: string };

export function parseReactions(json?: string): Reactions {
  try { return JSON.parse(json ?? '{}') as Reactions; } catch { return {}; }
}

export function serializeReactions(reactions: Reactions): string {
  return JSON.stringify(reactions);
}

export function parseAttachments(json?: string): Attachment[] {
  try { return JSON.parse(json ?? '[]') as Attachment[]; } catch { return []; }
}

export function serializeAttachments(atts: Attachment[]): string {
  return JSON.stringify(atts);
}

export function parseMembers(json?: string): string[] {
  try { return JSON.parse(json ?? '[]') as string[]; } catch { return []; }
}

export function serializeMembers(members: string[]): string {
  return JSON.stringify(members);
}
