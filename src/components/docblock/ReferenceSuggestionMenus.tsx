import { SuggestionMenuController } from '@blocknote/react';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import { getReferenceOptionsCached } from '../../lib/referenceOptionsCache';
import type { ReferenceType } from './docSchema';
import type { docSchema } from './docSchema';

type Editor = typeof docSchema.BlockNoteEditor;

/**
 * Reemplaza a EntityMentionMenu.tsx. Nota sobre "/": en el editor viejo "/" es
 * el trigger de menciones de Grupo — en BlockNote "/" ya es el trigger nativo
 * del menú de inserción de bloques (heading, lista, quote, etc.), así que se
 * cambia el trigger de Grupo a "&" para no chocar con eso. Es la única
 * diferencia de comportamiento respecto al editor viejo.
 */
const TRIGGERS: { char: string; type: ReferenceType }[] = [
  { char: '@', type: 'user' },
  { char: '#', type: 'project' },
  { char: '!', type: 'event' },
  { char: '&', type: 'group' },
];

function insertReference(editor: Editor, refType: ReferenceType, refId: string, label: string) {
  editor.insertInlineContent([
    { type: 'reference', props: { refType, refId, label } },
    ' ',
  ] as any);
}

async function getItems(editor: Editor, type: ReferenceType, query: string): Promise<DefaultReactSuggestionItem[]> {
  const data = await getReferenceOptionsCached();
  const q = query.toLowerCase();

  if (type === 'user') {
    return data.members
      .filter(m => { const n = `${m.firstName ?? ''} ${m.lastName ?? ''}`.toLowerCase(); return !q || n.includes(q) || (m.email ?? '').toLowerCase().includes(q); })
      .slice(0, 7)
      .map(m => {
        const label = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?';
        return { title: label, subtext: m.email ?? '', icon: <span>👤</span>, onItemClick: () => insertReference(editor, 'user', m.id, label) };
      });
  }
  if (type === 'project') {
    return data.projects
      .filter(p => !q || p.code.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q))
      .slice(0, 7)
      .map(p => {
        const label = p.name ?? p.code;
        return { title: label, subtext: p.code, icon: <span>📁</span>, onItemClick: () => insertReference(editor, 'project', p.code, label) };
      });
  }
  if (type === 'event') {
    return data.events
      .filter(e => !q || e.name.toLowerCase().includes(q) || (e.projectCode ?? '').toLowerCase().includes(q))
      .slice(0, 7)
      .map(e => ({
        title: e.name,
        subtext: e.date ? new Date(e.date).toLocaleDateString() : (e.projectCode ?? ''),
        icon: <span>📅</span>,
        onItemClick: () => insertReference(editor, 'event', e.id, e.name),
      }));
  }
  return data.groups
    .filter(g => !q || g.name.toLowerCase().includes(q) || (g.projectCode ?? '').toLowerCase().includes(q))
    .slice(0, 7)
    .map(g => ({
      title: g.name,
      subtext: g.projectCode ?? '',
      icon: <span>👥</span>,
      onItemClick: () => insertReference(editor, 'group', g.name, g.name),
    }));
}

export default function ReferenceSuggestionMenus({ editor }: { editor: Editor }) {
  return (
    <>
      {TRIGGERS.map(({ char, type }) => (
        <SuggestionMenuController
          key={char}
          triggerCharacter={char}
          getItems={query => getItems(editor, type, query)}
        />
      ))}
    </>
  );
}
