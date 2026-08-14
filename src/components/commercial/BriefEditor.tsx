import BlockNoteDocEditor from '../docblock/BlockNoteDocEditor';

export default function BriefEditor({ dealId }: { dealId: string }) {
  return <BlockNoteDocEditor dealId={dealId} />;
}
