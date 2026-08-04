import { FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function SharpliTestPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card flex-shrink-0">
        <FlaskConical className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">Sharpli iframe test</h1>
        <Badge variant="secondary" className="text-xs">Prueba temporal</Badge>
      </div>
      <p className="px-6 py-2 text-xs text-muted-foreground">
        Si ves "Sharpli embed OK" dentro del iframe, la integración es viable. Si ves pantalla en blanco, revisa la consola del navegador para errores de X-Frame-Options o Content-Security-Policy.
      </p>
      <div className="flex-1 px-6 pb-6">
        <iframe
          src="https://sharpli.ai/embed/ping"
          className="w-full h-full rounded-lg border border-border"
          style={{ minHeight: 'calc(100vh - 180px)' }}
          title="Sharpli embed test"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
