import { useRef, useState } from 'react';
import { FileText, Upload, Sparkles } from 'lucide-react';
import { savePropuestaBrief, generatePropuestaEsqueleto } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { archivoABase64 } from '../../lib/propuestasCatalogo';
import { Progreso, Seccion } from './PasoUi';
import { useLlamadaLarga } from './useLlamadaLarga';

const METODOS = [['cualitativo', 'Cualitativo'], ['cuantitativo', 'Cuantitativo'], ['mixto', 'Mixto']] as const;

// Pantalla 1 (spec §6): brief (.pdf/.docx o texto pegado), notas y método.
export default function BriefStep({ p, onChanged, onEsqueleto }: { p: any; onChanged: () => Promise<void> | void; onEsqueleto: () => void }) {
  const [texto, setTexto] = useState('');
  const [notas, setNotas] = useState<string>(p.notas ?? '');
  const [metodo, setMetodo] = useState<string | null>(p.metodo ?? null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const llamada = useLlamadaLarga();

  const hayBrief = !!(texto.trim() || archivo || p.tieneBrief);

  const proponer = async () => {
    try {
      await savePropuestaBrief({
        id: p.id, notas, metodo,
        ...(texto.trim() ? { texto } : {}),
        ...(archivo ? { archivo: { nombre: archivo.name, mime: archivo.type, base64: await archivoABase64(archivo) } } : {}),
      });
      await llamada.correr(generatePropuestaEsqueleto({ id: p.id }));
      await onChanged();
      onEsqueleto();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo proponer el esqueleto');
    }
  };

  return (
    <div className="space-y-5">
      <Seccion titulo="Brief del cliente" ayuda="Sube el .pdf o .docx, o pega el texto. Si ya había uno, el nuevo lo reemplaza.">
        <div className="flex items-center gap-3 flex-wrap">
          <input ref={inputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={e => setArchivo(e.target.files?.[0] ?? null)} />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => inputRef.current?.click()} disabled={llamada.corriendo}>
            <Upload className="w-3.5 h-3.5" /> Subir brief
          </Button>
          {(archivo || p.briefNombre) && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="w-3.5 h-3.5" /> {archivo ? archivo.name : p.briefNombre}
            </span>
          )}
        </div>
        <Textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder="…o pega aquí el texto del brief" rows={6} disabled={llamada.corriendo} />
      </Seccion>

      <Seccion titulo="Notas" ayuda="Lo que el brief no dice: presupuesto o rango, fechas, número de prototipos, formato de sesión, aclaraciones.">
        <Textarea value={notas} onChange={e => setNotas(e.target.value)} rows={4} disabled={llamada.corriendo} />
      </Seccion>

      <Seccion titulo="Método">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {METODOS.map(([k, l], i) => (
            <button key={k} type="button" disabled={llamada.corriendo} onClick={() => setMetodo(metodo === k ? null : k)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-border' : ''} ${metodo === k ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
              {l}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Sin elegir, Claude lo decide según el brief.</p>
      </Seccion>

      {llamada.corriendo && <Progreso pasos={llamada.pasos} segundos={llamada.segundos} />}

      <div className="flex justify-end">
        <Button onClick={proponer} disabled={!hayBrief || llamada.corriendo} className="gap-1.5">
          <Sparkles className="w-4 h-4" /> {p.esqueleto ? 'Volver a proponer esqueleto' : 'Proponer esqueleto'}
        </Button>
      </div>
    </div>
  );
}
