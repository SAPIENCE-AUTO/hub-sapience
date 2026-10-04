import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FileJson, Hammer, Loader2, RefreshCw, Undo2 } from 'lucide-react';
import { generatePropuestaContenido, buildPropuestaPptx, getPropuestaDescarga, savePropuestaContenido } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { descargarUrl } from '../../lib/propuestasCatalogo';
import { Progreso, Seccion } from './PasoUi';
import { useLlamadaLarga } from './useLlamadaLarga';

// Pantalla 4 (spec §6): estado del proceso, problemas, ajustes de paleta,
// descarga e historial de versiones.
export default function RevisionStep({ p, iniciar, onIniciado, onChanged, onVolverEsqueleto }: {
  p: any; iniciar: boolean; onIniciado: () => void; onChanged: () => Promise<void> | void; onVolverEsqueleto: () => void;
}) {
  const llamada = useLlamadaLarga();
  const [construyendo, setConstruyendo] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [json, setJson] = useState('');
  const [guardandoJson, setGuardandoJson] = useState(false);
  const arrancado = useRef(false);

  const construir = async () => {
    setConstruyendo(true);
    try { await buildPropuestaPptx({ id: p.id }); await onChanged(); toast.success('PowerPoint construido'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo construir el PowerPoint'); await onChanged(); }
    finally { setConstruyendo(false); }
  };

  const escribir = async () => {
    try {
      const r = await llamada.correr(generatePropuestaContenido({ id: p.id }));
      setAvisos(r.avisos ?? []);
      await onChanged();
      if (!r.problemas?.length) await construir();   // sin problemas: se construye de una vez (pasos 6-7 del flujo)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo escribir la propuesta'); await onChanged(); }
  };

  useEffect(() => {
    if (iniciar && !arrancado.current) { arrancado.current = true; onIniciado(); escribir(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iniciar]);

  const descargar = async (version?: number) => {
    try { descargarUrl((await getPropuestaDescarga({ id: p.id, ...(version ? { version } : {}) })).url); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar'); }
  };

  const guardarJson = async () => {
    setGuardandoJson(true);
    try {
      const r = await savePropuestaContenido({ id: p.id, contenido: JSON.parse(json) });
      await onChanged();
      toast.success(r.problemas.length ? `Guardado — el revisor aún marca ${r.problemas.length}` : 'Guardado — sin problemas');
    } catch (e) { toast.error(e instanceof SyntaxError ? 'El JSON no es válido' : e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setGuardandoJson(false); }
  };

  const ocupado = llamada.corriendo || construyendo;
  const hayContenido = !!p.contenido;

  return (
    <div className="space-y-6">
      {llamada.corriendo && <Progreso pasos={llamada.pasos} segundos={llamada.segundos} />}
      {construyendo && (
        <div className="rounded-xl border border-border bg-muted/20 p-4 flex items-center gap-2 text-sm font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Construyendo el PowerPoint…
        </div>
      )}

      {!ocupado && !hayContenido && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Todavía no se escribe la propuesta. Elige el diseño y pulsa «Escribir propuesta».
        </div>
      )}

      {!ocupado && p.estado === 'error' && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> La última construcción falló. Revisa el contenido o vuelve a intentar.
        </div>
      )}

      {avisos.map((a, i) => <p key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">{a}</p>)}

      {hayContenido && (
        <Seccion titulo={p.problemas.length ? `El revisor marca ${p.problemas.length} problema${p.problemas.length > 1 ? 's' : ''}` : 'Revisión del contenido'}
          ayuda={p.problemas.length ? 'Después de 2 vueltas de corrección sigue marcando esto. Edita el contenido, vuelve al esqueleto, o construye de todos modos.' : undefined}>
          {p.problemas.length === 0 ? (
            <p className="text-sm text-emerald-700">✓ Sin problemas: el contenido cumple las reglas de Sapience.</p>
          ) : (
            <ul className="rounded-xl border border-border divide-y divide-border">
              {p.problemas.map((x: any, i: number) => (
                <li key={i} className="px-3 py-2 text-xs"><span className="font-mono text-muted-foreground">{x.ruta}</span><br />{x.problema}</li>
              ))}
            </ul>
          )}
        </Seccion>
      )}

      {p.ajustesPaleta?.length > 0 && (
        <Seccion titulo="Ajustes que hizo el constructor a la paleta" ayuda="Contraste, saturación y que las fases se distingan.">
          <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">{p.ajustesPaleta.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
        </Seccion>
      )}

      {hayContenido && (
        <div className="flex flex-wrap items-center gap-2">
          {p.tienePptx && (
            <Button className="gap-1.5" onClick={() => descargar()} disabled={ocupado}><Download className="w-4 h-4" /> Descargar PowerPoint (v{p.version})</Button>
          )}
          <Button variant="outline" className="gap-1.5" onClick={construir} disabled={ocupado}><Hammer className="w-4 h-4" /> {p.tienePptx ? 'Reconstruir' : 'Construir PowerPoint'}</Button>
          <Button variant="outline" className="gap-1.5" onClick={escribir} disabled={ocupado}><RefreshCw className="w-4 h-4" /> Reescribir propuesta</Button>
          <Button variant="ghost" className="gap-1.5" onClick={onVolverEsqueleto} disabled={ocupado}><Undo2 className="w-4 h-4" /> Volver al esqueleto</Button>
        </div>
      )}

      {p.versiones?.length > 1 && (
        <Seccion titulo="Historial de versiones">
          <div className="flex flex-wrap gap-2">
            {p.versiones.map((v: number) => <Button key={v} variant="outline" size="sm" onClick={() => descargar(v)}>v{v}</Button>)}
          </div>
        </Seccion>
      )}

      {hayContenido && (
        <details className="rounded-xl border border-border" onToggle={e => { if ((e.target as HTMLDetailsElement).open) setJson(JSON.stringify(p.contenido, null, 2)); }}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium flex items-center gap-2"><FileJson className="w-4 h-4" /> Editar el contenido (JSON)</summary>
          <div className="p-3 space-y-2 border-t border-border">
            <Textarea value={json} onChange={e => setJson(e.target.value)} rows={16} className="font-mono text-xs" />
            <div className="flex justify-end"><Button size="sm" onClick={guardarJson} disabled={guardandoJson || ocupado}>Guardar y revisar</Button></div>
          </div>
        </details>
      )}
    </div>
  );
}
