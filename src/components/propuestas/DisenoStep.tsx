import { useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Palette, Sparkles } from 'lucide-react';
import { savePropuestaDiseno, generatePropuestaPaletas, uploadPropuestaArchivo } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ESTILOS, PORTADAS, archivoABase64 } from '../../lib/propuestasCatalogo';
import { Seccion } from './PasoUi';

const hex = (c: string) => `#${(c ?? '').replace('#', '')}`;
const sinHash = (c: string) => c.replace('#', '').toUpperCase();
type Paleta = { acento: string; secundario: string; fases: string[] };

function Muestras({ colores }: { colores: string[] }) {
  return <div className="flex gap-1">{colores.map((c, i) => <span key={i} className="h-5 w-5 rounded border border-black/10" style={{ backgroundColor: hex(c) }} />)}</div>;
}

// Un hueco de archivo (foto de portada, ilustración, captura): sube al elegir y
// reemplaza el anterior del mismo slot.
function SlotArchivo({ p, tipo, slot, etiqueta, onChanged }: { p: any; tipo: string; slot: string; etiqueta: string; onChanged: () => Promise<void> | void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const actual = p.archivos.find((a: any) => a.tipo === tipo && a.slot === slot);
  const subir = async (f: File) => {
    setSubiendo(true);
    try { await uploadPropuestaArchivo({ id: p.id, tipo, slot, nombre: f.name, mime: f.type, base64: await archivoABase64(f) }); await onChanged(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo subir la imagen'); }
    finally { setSubiendo(false); }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ''; }} />
      <span className="text-xs font-medium w-28 shrink-0">{etiqueta}</span>
      <span className="text-[11px] text-muted-foreground truncate flex-1">{actual ? `✓ ${actual.path.split('/').pop().replace(/^[a-z_]+_\d+_/, '')}` : 'Sin imagen'}</span>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => ref.current?.click()} disabled={subiendo}>
        {subiendo ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImagePlus className="w-3 h-3" />} {actual ? 'Cambiar' : 'Subir'}
      </Button>
    </div>
  );
}

// Pantalla 3 (spec §6): estilo, portada, paleta, fotos e ilustraciones.
export default function DisenoStep({ p, onChanged, onEscribir }: { p: any; onChanged: () => Promise<void> | void; onEscribir: () => void }) {
  const dis = p.esqueleto?.diseno ?? {};
  const [estilo, setEstilo] = useState<string>(dis.estilo ?? 'A');
  const [portada, setPortada] = useState<string>(dis.portada ?? Object.keys(PORTADAS)[0]);
  const [paleta, setPaleta] = useState<Paleta | null>(dis.paleta ?? null);
  const [propuestas, setPropuestas] = useState<any[]>([]);
  const [tono, setTono] = useState('');
  const [marca, setMarca] = useState('');
  const [generando, setGenerando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const ilustrada = !!dis.ilustraciones;
  const nFases = p.esqueleto?.fases?.length ?? 0;
  const delEstilo = ESTILOS[estilo];

  const generarPaletas = async () => {
    setGenerando(true);
    try { setPropuestas((await generatePropuestaPaletas({ id: p.id, tono, coloresMarca: marca })).paletas); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudieron generar las paletas'); }
    finally { setGenerando(false); }
  };

  const escribir = async () => {
    setGuardando(true);
    try {
      await savePropuestaDiseno({ id: p.id, estilo, portada, paleta, ilustraciones: ilustrada });
      await onChanged();
      onEscribir();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo guardar el diseño'); setGuardando(false); }
  };

  const slotsIlustracion: [string, string][] = [
    ...[0, 1, 2].map(i => [`contexto.${i}`, `Contexto, columna ${i + 1}`] as [string, string]),
    ['punto_partida', 'Punto de partida'],
    ...[0, 1, 2, 3, 4, 5].map(i => [`objetivos.${i}`, `Objetivo ${i + 1}`] as [string, string]),
    ...Array.from({ length: nFases }, (_, i) => [`enfoque.${i}`, `Enfoque, fase ${i + 1}`] as [string, string]),
  ];

  return (
    <div className="space-y-6">
      <Seccion titulo="Estilo" ayuda="Siete sistemas visuales. El estilo y la portada se combinan libremente. Claude sugirió uno; cámbialo si quieres.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(ESTILOS).map(([k, e]) => (
            <button key={k} type="button" onClick={() => setEstilo(k)}
              className={`text-left rounded-xl border overflow-hidden transition-all ${estilo === k ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-foreground/30'}`}>
              <img src={`/propuestas/estilos/${k}.jpg`} alt={`Estilo ${k}`} className="w-full block" loading="lazy" />
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-xs font-bold">{k}</span><span className="text-xs text-muted-foreground flex-1">{e.nombre}</span>
                {estilo === k && <Check className="w-4 h-4 text-primary" />}
              </div>
            </button>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Portada" ayuda="Once portadas, independientes del estilo. Cada una indica cuántas fotos pide.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(PORTADAS).map(([id, c]) => (
            <button key={id} type="button" onClick={() => setPortada(id)}
              className={`text-left rounded-xl border overflow-hidden transition-all ${portada === id ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-foreground/30'}`}>
              <img src={`/propuestas/portadas/${id}.jpg`} alt={c.nombre} className="w-full block" loading="lazy" />
              <div className="px-2.5 py-1.5">
                <p className="text-xs font-medium leading-tight">{c.nombre}</p>
                <p className="text-[10px] text-muted-foreground">{c.huecos} {c.huecos === 1 ? 'foto' : 'fotos'}</p>
              </div>
            </button>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Paleta">
        <div className="space-y-3 rounded-xl border border-border p-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" checked={!paleta} onChange={() => setPaleta(null)} />
            <span className="text-sm">Usar la del estilo {estilo}</span>
            <Muestras colores={[delEstilo.acento, delEstilo.secundario, ...delEstilo.fases]} />
          </label>
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm"><Palette className="w-4 h-4 text-muted-foreground" /> Generar por tono o colores de marca</p>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
              <Input className="h-8" placeholder="Tono: fun, seria, elegante, farma…" value={tono} onChange={e => setTono(e.target.value)} />
              <Input className="h-8" placeholder="Colores de marca (hasta 3 hex, ej. E4002B 1B1B1B)" value={marca} onChange={e => setMarca(e.target.value)} />
              <Button size="sm" className="gap-1.5" onClick={generarPaletas} disabled={generando || (!tono.trim() && !marca.trim())}>
                {generando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generar
              </Button>
            </div>
            {propuestas.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {propuestas.map((pa, i) => {
                  const sel = paleta && sinHash(paleta.acento) === pa.acento && paleta.fases.join() === pa.fases.join();
                  return (
                    <button key={i} type="button" onClick={() => setPaleta({ acento: pa.acento, secundario: pa.secundario, fases: pa.fases })}
                      className={`text-left rounded-lg border p-2.5 space-y-1.5 ${sel ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-foreground/30'}`}>
                      <p className="text-xs font-semibold">{pa.nombre}</p>
                      <Muestras colores={[pa.acento, pa.secundario, ...pa.fases]} />
                      <p className="text-[11px] text-muted-foreground">{pa.tono}</p>
                    </button>
                  );
                })}
              </div>
            )}
            {paleta && (
              <div className="space-y-2 rounded-lg bg-muted/30 p-2.5">
                <p className="text-xs font-medium">Retoca cada color</p>
                <div className="flex flex-wrap gap-3">
                  {([['acento', 'Acento'], ['secundario', 'Secundario']] as const).map(([k, l]) => (
                    <label key={k} className="flex items-center gap-1.5 text-xs">{l}
                      <input type="color" value={hex(paleta[k])} onChange={e => setPaleta({ ...paleta, [k]: sinHash(e.target.value) })} />
                    </label>
                  ))}
                  {paleta.fases.map((c, i) => (
                    <label key={i} className="flex items-center gap-1.5 text-xs">Fase {i + 1}
                      <input type="color" value={hex(c)} onChange={e => setPaleta({ ...paleta, fases: paleta.fases.map((x, j) => (j === i ? sinHash(e.target.value) : x)) })} />
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-amber-700">Aviso: los marcos de portada conservan su color original (el recoloreo está pendiente). Si tu paleta es muy distinta a la de la portada elegida, pueden no combinar. El constructor ajusta contraste y saturación solo.</p>
              </div>
            )}
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Fotos de portada" ayuda="Si no subes foto, el hueco sale gris marcado FOTO 1, FOTO 2… para reemplazarlo en PowerPoint.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Array.from({ length: PORTADAS[portada].huecos }, (_, i) => (
            <SlotArchivo key={i} p={p} tipo="foto_portada" slot={`FOTO_${i + 1}`} etiqueta={`Foto ${i + 1}`} onChanged={onChanged} />
          ))}
        </div>
      </Seccion>

      {ilustrada && (
        <Seccion titulo="Ilustraciones (opcional)" ayuda="Los huecos sin imagen salen marcados ILUSTRACIÓN para que el diseñador los complete. Los slots que no existan en la propuesta se ignoran.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {slotsIlustracion.map(([slot, et]) => <SlotArchivo key={slot} p={p} tipo="ilustracion" slot={slot} etiqueta={et} onChanged={onChanged} />)}
          </div>
        </Seccion>
      )}

      <Seccion titulo="Capturas de entregables (opcional)" ayuda="Ejemplos de estudios anteriores. Sin capturas, la lámina de entregables se omite.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[0, 1, 2, 3].map(i => <SlotArchivo key={i} p={p} tipo="entregable" slot={`entregables.${i}`} etiqueta={`Captura ${i + 1}`} onChanged={onChanged} />)}
        </div>
      </Seccion>

      <div className="flex justify-end">
        <Button onClick={escribir} disabled={guardando} className="gap-1.5">
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Escribir propuesta
        </Button>
      </div>
    </div>
  );
}
