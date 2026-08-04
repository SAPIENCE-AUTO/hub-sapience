import DocumentCanvas from './brief/DocumentCanvas';

export default function BriefEditor({ dealId }: { dealId: string }) {
  return <DocumentCanvas dealId={dealId} />;
}
