import { useEffect, useState } from 'react';
import { FileSpreadsheet, BarChart3, ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getProjectDocuments, GetProjectDocumentsOutputType } from 'zite-endpoints-sdk';

type Document = GetProjectDocumentsOutputType['documents'][0];

interface Props {
  projectCode: string;
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DocCard({ doc }: { doc: Document }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 px-4 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors group">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {doc.documentName ?? 'Sin nombre'}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {doc.version && (
            <span className="text-xs text-muted-foreground">v{doc.version}</span>
          )}
          {doc.uploadDate && (
            <span className="text-xs text-muted-foreground">{formatDate(doc.uploadDate)}</span>
          )}
        </div>
      </div>
      {doc.fileUrl ? (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 flex-shrink-0 text-primary opacity-70 group-hover:opacity-100"
          onClick={() => window.open(doc.fileUrl!, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-xs">Abrir</span>
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground flex-shrink-0">Sin link</span>
      )}
    </div>
  );
}

function DocSection({
  title,
  icon: Icon,
  docs,
  iconClass,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  docs: Document[];
  iconClass: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconClass}`}>
          <Icon className="w-4 h-4 text-primary-foreground" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">({docs.length})</span>
      </div>
      {docs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic pl-9">No hay documentos todavía</p>
      ) : (
        <div className="space-y-1.5">
          {docs.map(doc => <DocCard key={doc.id} doc={doc} />)}
        </div>
      )}
    </div>
  );
}

export default function ProjectDocuments({ projectCode }: Props) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getProjectDocuments({ projectCode });
      setDocs(res.documents);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectCode]);

  const calendarios = docs.filter(d => d.category === 'Calendario');
  const timelines   = docs.filter(d => d.category === 'Timeline');
  const isEmpty     = docs.length === 0;

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-6 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <Skeleton className="h-6 w-32 mt-4" />
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-12">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <FileText className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Sin documentos aún</h3>
        <p className="text-muted-foreground text-sm max-w-sm">
          Los archivos de Excel de timelines y calendarios generados aparecerán aquí automáticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Documentos del proyecto</h2>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={load}>
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </Button>
      </div>

      <DocSection
        title="Calendarios"
        icon={FileSpreadsheet}
        docs={calendarios}
        iconClass="bg-primary"
      />
      <DocSection
        title="Timelines"
        icon={BarChart3}
        docs={timelines}
        iconClass="bg-primary"
      />
    </div>
  );
}
