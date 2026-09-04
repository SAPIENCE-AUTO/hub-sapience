import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { chatDealsAnalysis } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Markdown } from '@/components/markdown';
import { exportChartPpt } from '@/lib/exportChartPpt';
import { TEAL } from '@/lib/toolColors';
import { Send, Download, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  table?: { headers: string[]; rows: string[][] } | null;
  html?: string | null;
};

// Script inyectado (no generado por el modelo) al final del HTML antes de
// mostrarlo en el iframe — escucha el pedido de export del padre y regresa
// la imagen de cada <canvas> que haya en el documento. Se inyecta siempre
// nosotros, nunca se confía en que la IA escriba este listener por su cuenta
// — el único contrato con el modelo es "dibuja en un <canvas>" (ya cubierto
// por instruirlo a usar Chart.js).
const EXPORT_LISTENER_SCRIPT = `
<script>
window.addEventListener('message', function (e) {
  var data = e.data;
  if (!data || data.cmd !== 'export-charts') return;
  var canvases = document.querySelectorAll('canvas');
  var images = [];
  for (var i = 0; i < canvases.length; i++) {
    var c = canvases[i];
    var url;
    if (data.format === 'jpeg') {
      var tmp = document.createElement('canvas');
      tmp.width = c.width; tmp.height = c.height;
      var ctx = tmp.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(c, 0, 0);
      url = tmp.toDataURL('image/jpeg', 0.92);
    } else {
      url = c.toDataURL('image/png');
    }
    images.push(url);
  }
  window.parent.postMessage({ type: 'chart-export-result', requestId: data.requestId, images: images }, '*');
});
</script>
`;

function withExportListener(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${EXPORT_LISTENER_SCRIPT}</body>`);
  return html + EXPORT_LISTENER_SCRIPT;
}

function requestChartImages(iframe: HTMLIFrameElement | null, format: 'png' | 'jpeg'): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!iframe?.contentWindow) return reject(new Error('Gráfico no disponible'));
    const requestId = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Tiempo de espera agotado'));
    }, 5000);
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (!data || data.type !== 'chart-export-result' || data.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      resolve(data.images ?? []);
    }
    window.addEventListener('message', onMessage);
    iframe.contentWindow.postMessage({ cmd: 'export-charts', format, requestId }, '*');
  });
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ChartExportMenu({ iframeRef, title }: { iframeRef: React.RefObject<HTMLIFrameElement>; title: string }) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: 'png' | 'jpeg' | 'pptx') => {
    setExporting(true);
    try {
      const images = await requestChartImages(iframeRef.current, format === 'pptx' ? 'png' : format);
      if (images.length === 0) { toast.error('No se encontró ninguna gráfica para exportar'); return; }
      if (format === 'pptx') {
        await exportChartPpt(title, images[0]);
      } else {
        images.forEach((img, i) => downloadDataUrl(img, `${title || 'grafica'}${images.length > 1 ? `-${i + 1}` : ''}.${format === 'jpeg' ? 'jpg' : 'png'}`));
      }
    } catch {
      toast.error('No se pudo exportar la gráfica');
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={exporting} className="gap-1.5">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('png')}>PNG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('jpeg')}>JPG</DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('pptx')}>PowerPoint</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssistantMessage({ msg }: { msg: ChatMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(360);

  return (
    <div className="rounded-xl border border-border bg-card p-4 max-w-3xl">
      <Markdown>{msg.content}</Markdown>
      {msg.table && msg.table.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>{msg.table.headers.map((h, i) => <th key={i} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {msg.table.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-border">
                  {row.map((cell, ci) => <td key={ci} className="px-3 py-1.5 whitespace-nowrap">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg.html && (
        <div className="mt-3">
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts"
            srcDoc={withExportListener(msg.html)}
            style={{ width: '100%', height: iframeHeight, border: 'none', borderRadius: 8 }}
            onLoad={() => {
              // Altura fija generosa — evita depender de que el HTML generado
              // reporte su tamaño real vía postMessage, que añadiría otro
              // contrato más a confiar en el modelo.
              setIframeHeight(420);
            }}
          />
          <div className="mt-2 flex justify-end">
            <ChartExportMenu iframeRef={iframeRef} title={msg.content.slice(0, 40)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function DealsAnalysisPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Gate real de la página — la ocultación del nav es solo UX, esto evita
  // que alguien vea el módulo navegando directo a la URL sin ser Owner.
  useEffect(() => {
    if (user && user.role !== 'Owner') navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const question = input.trim();
    if (!question || loading) return;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const res = await chatDealsAnalysis({
        messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(prev => [...prev, { role: 'assistant', content: res.text, table: res.table, html: res.html }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al analizar');
      setMessages(prev => [...prev, { role: 'assistant', content: 'No pude generar el análisis. Intenta de nuevo.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role !== 'Owner') return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: TEAL }}>
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Análisis de ventas con IA</h1>
            <p className="text-xs text-muted-foreground">Historial completo de deals — pregunta lo que necesites analizar o comparar</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-6" ref={scrollRef as any}>
        <div className="max-w-3xl mx-auto py-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Ej. "¿cuántos deals ganamos en 2025 vs 2024?", "grafícame la tendencia mensual de este año",
              "dame una tabla de ventas por cliente"
            </p>
          )}
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={i} className="self-end rounded-xl bg-primary text-primary-foreground px-4 py-2 max-w-lg text-sm">
              {m.content}
            </div>
          ) : (
            <AssistantMessage key={i} msg={m} />
          ))}
          {loading && (
            <div className="rounded-xl border border-border bg-card p-4 max-w-3xl flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Analizando...
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="px-6 py-4 border-t border-border">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Pregunta algo sobre las ventas..."
            className="min-h-[44px] max-h-32 resize-none"
            disabled={loading}
          />
          <Button onClick={send} disabled={loading || !input.trim()} size="icon" className="flex-shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
