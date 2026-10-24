import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { traerImagenDeEnlace } from 'zite-endpoints-sdk';
import { ArrowDown, ArrowUp, Loader2, Lock, MessageSquareText, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { SECCION_INICIO } from '@/lib/formularios/inicio';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ALERTA } from '@/lib/toolColors';
import { alertaEnPalabras, frenteEnPalabras, logicaDeSeccion, ubicar } from '@/lib/formularios/palabras';
import {
  GRUPOS_TIPOS, agregarPregunta, agregarSeccion, cambiarFrente, cambiarPregunta, cambiarSeccion, cambiarTextos, moverSeccion, quitarSeccion, usosDeSeccion,
} from '@/lib/formularios/editar';
import { PAISES } from '@/lib/formularios/paises';
import { reglaVigente } from '@/lib/formularios/nse';
import { TIPOS, type Definicion, type Seccion, type TipoPregunta } from '@/lib/formularios/tipos';
import type { Editor } from './useEditorFiltro';
import { BotonIcono, Contexto, Logica, SECCION_PERFILES, claveDestino, useAlCerrarMenu, type ContextoDoc, type Destino, type Quitar } from './comun';
import { EditorCondicion } from './Ajustes';
import { conImagenEnOpcion, tipoConImagen } from './Opciones';
import { MUESTRA_BIENVENIDA, MUESTRA_FINAL, MuestraCelular } from './MuestraCelular';
import { PreguntaDoc } from './PreguntaDoc';
import { TextoEditable } from './TextoEditable';
import { esCampoDeTexto, imagenesDe, subirImagenFiltro, traeArchivos } from './imagenes';
import { PropuestaIA } from '../generador/PropuestaIA';

function MenuTipos({ onElegir, children }: { onElegir: (t: TipoPregunta) => void; children: React.ReactNode }) {
  const { despues, alCerrar } = useAlCerrarMenu();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-60 overflow-y-auto" onCloseAutoFocus={alCerrar}>
        {GRUPOS_TIPOS.map((g, i) => (
          <div key={g.nombre}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] text-muted-foreground">{g.nombre}</DropdownMenuLabel>
            {g.tipos.map((t) => <DropdownMenuItem key={t} onSelect={() => despues(() => onElegir(t))}>{TIPOS[t].nombre}</DropdownMenuItem>)}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Las secciones del documento con un hueco en el lugar de las que la IA todavía escribe. */
function conHuecos(def: Definicion, pendientes?: { orden: string[]; titulos: Record<string, string>; escribiendo: Set<string> }) {
  const escritas = def.secciones.map((seccion) => ({ seccion, id: seccion.id, titulo: '', escribiendo: false }));
  if (!pendientes) return escritas;
  const huecos = pendientes.orden.filter((id) => !def.secciones.some((s) => s.id === id));
  if (!huecos.length) return escritas;
  const lugar = new Map(pendientes.orden.map((id, i) => [id, i]));
  const todas = [...escritas, ...huecos.map((id) => ({ seccion: undefined, id, titulo: pendientes.titulos[id] ?? '', escribiendo: pendientes.escribiendo.has(id) }))];
  return todas.sort((a, b) => (lugar.get(a.id) ?? Infinity) - (lugar.get(b.id) ?? Infinity));
}

function HuecoSeccion({ titulo, escribiendo }: { titulo: string; escribiendo: boolean }) {
  return (
    <section className="border-t border-[#E4E4E7] pt-6">
      <div className="rounded-lg border border-dashed border-[#0F3D4D]/25 bg-[#0F3D4D]/[0.02] px-4 py-5">
        <p className="text-[16px] font-bold text-[#1F1F23]/50">{titulo.split('{opcion}').join('…')}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {escribiendo ? <><Loader2 className="h-3.5 w-3.5 animate-spin text-[#0F3D4D]" />La IA está escribiendo esta sección…</> : 'En fila para escribirse'}
        </p>
      </div>
    </section>
  );
}

const botonAgregar = 'flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-[#0F3D4D]/80 hover:bg-[#0F3D4D]/5 hover:text-[#0F3D4D]';

function SeccionDoc({ s, i, total, ctx }: { s: Seccion; i: number; total: number; ctx: ContextoDoc }) {
  const { def, aplicar, quitar, nuevo, setNuevo, ia } = ctx;
  const [condicion, setCondicion] = useState(false);
  const [intro, setIntro] = useState(false);
  const [comentar, setComentar] = useState(false);
  const delNse = s.preguntas.some((p) => !!def.nse?.puntos[p.id]);
  // «Antes de empezar» la pone el Hub en todos los filtros: no se mueve, no se quita y no se le agregan preguntas.
  const inicio = s.id === SECCION_INICIO;
  const despuesDelInicio = i === 1 && def.secciones[0]?.id === SECCION_INICIO;
  const { despues, alCerrar } = useAlCerrarMenu();

  const agregar = (tipo: TipoPregunta) => {
    let id = '';
    aplicar((d) => { const r = agregarPregunta(d, s.id, tipo); id = r.id; return r.def; });
    setNuevo(id);
  };
  const pedirQuitar = () => {
    const usos = usosDeSeccion(def, s.id);
    const hacer = () => aplicar((d) => quitarSeccion(d, s.id));
    quitar({ que: `la sección «${s.titulo ?? s.id}» con sus ${s.preguntas.length} preguntas`, usos, hacer, confirmar: true });
  };

  return (
    <section id={`filtro-s-${s.id}`} data-parte={s.id} className="scroll-mt-24 border-t border-[#E4E4E7] pt-6">
      <div className="group/s flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[18px] font-bold leading-snug text-[#1F1F23]">
          {inicio ? s.titulo : (
            <TextoEditable
              valor={s.titulo ?? ''} linea etiqueta="Título de la sección" placeholder="Sección sin título"
              abrir={nuevo === s.id} onCerrar={() => nuevo === s.id && setNuevo(null)}
              onGuardar={(v) => aplicar((d) => cambiarSeccion(d, s.id, { titulo: v || undefined }))}
            />
          )}
          {inicio && <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] font-normal text-muted-foreground"><Lock className="h-3 w-3" />va en todos los filtros</span>}
        </h2>
        {!inicio && <div className="flex flex-shrink-0 items-center transition-opacity sm:opacity-0 sm:group-hover/s:opacity-100 sm:focus-within:opacity-100">
          {ia && !delNse && <BotonIcono titulo="Comentar la lógica de esta sección a la IA" onClick={() => setComentar((x) => !x)}><MessageSquareText className="h-4 w-4" /></BotonIcono>}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Más de esta sección" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#0F3D4D]">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={alCerrar}>
              <DropdownMenuItem disabled={i === 0 || despuesDelInicio} onSelect={() => aplicar((d) => moverSeccion(d, s.id, -1))}><ArrowUp className="mr-2 h-4 w-4" />Subir sección</DropdownMenuItem>
              <DropdownMenuItem disabled={i === total - 1} onSelect={() => aplicar((d) => moverSeccion(d, s.id, 1))}><ArrowDown className="mr-2 h-4 w-4" />Bajar sección</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => despues(() => setCondicion(true))}>{s.mostrarSi ? 'Cambiar cuándo aparece…' : 'Mostrar solo si…'}</DropdownMenuItem>
              {!s.intro && <DropdownMenuItem onSelect={() => despues(() => setIntro(true))}>Agregar texto de entrada</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={total === 1} className="text-[#D32222] focus:text-[#D32222]" onSelect={pedirQuitar}><Trash2 className="mr-2 h-4 w-4" />Quitar sección</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>}
      </div>
      {(s.intro || intro) && (
        <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-[#45454D]">
          <TextoEditable valor={s.intro ?? ''} etiqueta="Texto de entrada" placeholder="Texto que se lee al entrar a la sección" abrir={intro} onCerrar={() => setIntro(false)} onGuardar={(v) => aplicar((d) => cambiarSeccion(d, s.id, { intro: v || undefined }))} />
        </p>
      )}
      <Logica lineas={logicaDeSeccion(def, s)} className="mt-1.5" />
      {comentar && <PropuestaIA alcance={{ seccion: s.id }} onCerrar={() => setComentar(false)} />}
      {condicion && (
        <EditorCondicion lugar={{ seccion: s.id }} actual={s.mostrarSi} onCerrar={() => setCondicion(false)} onGuardar={(c) => aplicar((d) => cambiarSeccion(d, s.id, { mostrarSi: c }))} />
      )}
      <div className="mt-2 space-y-1">
        {s.preguntas.map((p) => <PreguntaDoc key={p.id} s={s} p={p} />)}
      </div>
      {!inicio && <MenuTipos onElegir={agregar}>
        <button type="button" className={`${botonAgregar} mt-1`}><Plus className="h-3.5 w-3.5" />Pregunta</button>
      </MenuTipos>}
    </section>
  );
}

function Frentes({ ctx }: { ctx: ContextoDoc }) {
  const { def, aplicar, ia } = ctx;
  const [comentar, setComentar] = useState(false);
  const frentes = def.frentes ?? [];
  const pais = PAISES[def.pais];
  const vigente = reglaVigente(def.pais);
  return (
    <section id={`filtro-s-${SECCION_PERFILES}`} className="scroll-mt-24 border-t border-[#E4E4E7] pt-6">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[18px] font-bold text-[#1F1F23]">Perfiles y cuotas</h2>
        {ia && <BotonIcono titulo="Comentar los perfiles y cuotas a la IA" onClick={() => setComentar((x) => !x)}><MessageSquareText className="h-4 w-4" /></BotonIcono>}
      </div>
      {comentar && <PropuestaIA alcance={{ frentes: true }} onCerrar={() => setComentar(false)} />}
      {frentes.length === 0 && <p className="mt-2 text-[13px] text-muted-foreground">Este filtro no tiene perfiles.</p>}
      <ul className="mt-3 space-y-3">
        {frentes.map((f) => (
          <li key={f.id} className="text-[14px]">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-[#1F1F23]">
                <TextoEditable valor={f.nombre} linea obligatorio etiqueta="Nombre del perfil" onGuardar={(v) => aplicar((d) => cambiarFrente(d, f.id, { nombre: v }))} />
              </span>
              <label className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                Cuota
                <CuotaFrente valor={f.meta} onGuardar={(meta) => aplicar((d) => cambiarFrente(d, f.id, { meta }))} />
              </label>
            </div>
            <p className="mt-0.5 text-[12.5px] leading-snug text-[#257E55]">↳ {frenteEnPalabras(def, f)}</p>
          </li>
        ))}
      </ul>
      {(def.alertas?.length ?? 0) > 0 && (
        <>
          <h3 className="mt-5 text-[14px] font-bold text-[#1F1F23]">Alertas</h3>
          <ul className="mt-1 space-y-0.5">
            {def.alertas!.map((a, i) => <li key={i} className="text-[12.5px]" style={{ color: ALERTA }}>↳ {alertaEnPalabras(def, a)}</li>)}
          </ul>
        </>
      )}
      <p className="mt-5 text-[12.5px] text-muted-foreground">
        {pais?.nombre ?? def.pais}
        {def.nse ? ` · NSE ${def.nse.regla ?? 'propio'}${vigente && def.nse.regla && def.nse.regla !== vigente ? ` (la vigente es ${vigente})` : ''}. El NSE es alerta, nunca descarte.` : ' · sin regla de NSE.'}
      </p>
    </section>
  );
}

function CuotaFrente({ valor, onGuardar }: { valor: number; onGuardar: (n: number) => void }) {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  const guardar = () => {
    const n = Number(texto);
    if (Number.isInteger(n) && n > 0 && n !== valor) onGuardar(n); else setTexto(String(valor));
  };
  return (
    <input
      aria-label="Cuota"
      inputMode="numeric"
      className="w-14 rounded-md border bg-white px-2 py-0.5 text-[13px] text-[#1F1F23]"
      value={texto}
      onChange={(e) => setTexto(e.target.value.replace(/\D/g, ''))}
      onBlur={guardar}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTexto(String(valor)); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * Vista Documento: el screener de arriba abajo, como lo leerá el cliente, con
 * la lógica en palabras bajo cada pregunta y opción. Todo texto se corrige con un clic; las imágenes
 * se arrastran o se pegan sobre la opción o la pregunta.
 */
export function Documento({ editor, ia, pendientes }: {
  editor: Editor;
  ia?: ContextoDoc['ia'];
  /** Fase 3: secciones de la estructura que la IA todavía está escribiendo, en su orden. Se ven como un hueco en su lugar. */
  pendientes?: { orden: string[]; titulos: Record<string, string>; escribiendo: Set<string> };
}) {
  const { def, aplicar } = editor;
  const [subiendo, setSubiendo] = useState<Set<string>>(new Set());
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [porQuitar, setPorQuitar] = useState<Quitar | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  /** Lo que se ve en el celular de al lado: la parte del documento donde se hizo clic. */
  const [enCelular, setEnCelular] = useState<string | null>(null);
  const apuntado = useRef<Destino | null>(null);
  const defRef = useRef<Definicion>(def);
  defRef.current = def;

  const ponerImagen = async (destino: Destino, archivo: File) => {
    const p = ubicar(defRef.current, destino.pregunta)?.pregunta;
    if (!p) return;
    if (destino.tipo === 'opcion' && !tipoConImagen(p)) {
      toast.error('Las opciones de este tipo de pregunta no llevan imagen. Suéltala sobre la pregunta para ponerla arriba.');
      return;
    }
    const clave = claveDestino(destino);
    setSubiendo((s) => new Set(s).add(clave));
    try {
      const url = await subirImagenFiltro(archivo);
      // Se busca otra vez: mientras subía pudo cambiar el tipo o el texto.
      const actual = ubicar(defRef.current, destino.pregunta)?.pregunta;
      if (!actual) return;
      if (destino.tipo === 'pregunta') aplicar((d) => cambiarPregunta(d, actual.id, { imagen: url }));
      else {
        const tipo = tipoConImagen(actual);
        aplicar(conImagenEnOpcion(actual, destino.opcion, url));
        if (tipo && tipo !== actual.tipo) toast.success(`La pregunta pasó a «${TIPOS[tipo].nombre}» para que se vean las imágenes.`);
      }
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo subir la imagen.');
    } finally {
      setSubiendo((s) => { const n = new Set(s); n.delete(clave); return n; });
    }
  };

  const ponerImagenDeEnlace = async (destino: Destino, url: string) => {
    const clave = claveDestino(destino);
    setSubiendo((s) => new Set(s).add(clave));
    try {
      const r = await traerImagenDeEnlace({ url }) as { base64: string; tipo: string; nombre: string };
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      await ponerImagen(destino, new File([bytes], r.nombre, { type: r.tipo }));
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo traer la imagen de ese enlace.');
      setSubiendo((s) => { const n = new Set(s); n.delete(clave); return n; });
    }
  };

  // Pegar una imagen (⌘V), o el enlace de una, la pone donde está el cursor.
  useEffect(() => {
    const pegar = (e: ClipboardEvent) => {
      if (esCampoDeTexto(e.target)) return;
      const [archivo] = imagenesDe(e.clipboardData);
      const enlace = archivo ? '' : (e.clipboardData?.getData('text/plain') ?? '').trim();
      if (!archivo && !/^https?:\/\/\S+$/i.test(enlace)) return;
      e.preventDefault();
      if (!apuntado.current) { toast('Pon el cursor sobre la opción o la pregunta y vuelve a pegar la imagen.'); return; }
      if (archivo) void ponerImagen(apuntado.current, archivo);
      else void ponerImagenDeEnlace(apuntado.current, enlace);
    };
    window.addEventListener('paste', pegar);
    return () => window.removeEventListener('paste', pegar);
  }); // se vuelve a enganchar en cada render: ponerImagen usa el editor del momento

  // Esc suelta la pregunta elegida (si no se está escribiendo).
  useEffect(() => {
    const soltar = (e: KeyboardEvent) => { if (e.key === 'Escape' && !esCampoDeTexto(e.target)) setElegida(null); };
    window.addEventListener('keydown', soltar);
    return () => window.removeEventListener('keydown', soltar);
  }, []);

  const ctx: ContextoDoc = useMemo(() => ({
    def, aplicar, subiendo, nuevo, setNuevo,
    ponerImagen: (d, a) => { void ponerImagen(d, a); },
    ponerImagenDeEnlace: (d, u) => { void ponerImagenDeEnlace(d, u); },
    apuntar: (d) => { apuntado.current = d; },
    quitar: (q) => (q.usos.length || q.confirmar ? setPorQuitar(q) : q.hacer()),
    ia,
    elegida,
    elegir: setElegida,
  }), [def, aplicar, subiendo, nuevo, ia, elegida]); // eslint-disable-line react-hooks/exhaustive-deps

  const muestra = enCelular && (enCelular === MUESTRA_BIENVENIDA || enCelular === MUESTRA_FINAL || def.secciones.some((x) => x.id === enCelular))
    ? enCelular
    : def.secciones[0]?.id ?? MUESTRA_BIENVENIDA;

  const agregarSeccionAl = (indice: number) => {
    let id = '';
    aplicar((d) => { const r = agregarSeccion(d, indice); id = r.id; return r.def; });
    setNuevo(id);
  };

  const textos = (campo: 'tituloPublico' | 'bienvenida' | 'despedida' | 'noCalifica', etiqueta: string, clase: string) => (
    <TextoEditable valor={def[campo]} etiqueta={etiqueta} obligatorio className={clase} onGuardar={(v) => aplicar((d) => cambiarTextos(d, { [campo]: v }))} />
  );

  return (
    <Contexto.Provider value={ctx}>
      <div
        className="flex items-start gap-6"
        // Una imagen soltada fuera de una opción o pregunta no debe abrirse en la pestaña.
        onDragOver={(e) => { if (traeArchivos(e.dataTransfer)) e.preventDefault(); }}
        onDrop={(e) => { if (traeArchivos(e.dataTransfer)) { e.preventDefault(); toast('Suelta la imagen sobre una opción o una pregunta.'); } }}
      >
        <article
          className="mx-auto w-full min-w-0 max-w-[780px] flex-1 space-y-6 rounded-xl border border-[#E4E4E7] bg-white px-4 py-6 shadow-sm sm:px-10 sm:py-9"
          // Un clic fuera de toda pregunta la suelta. Lo que abre una pregunta en otra capa (menús, avisos) no cuenta.
          onPointerDown={(e) => {
            const t = e.target as HTMLElement;
            if (!e.currentTarget.contains(t)) return;
            if (!t.closest('[data-pregunta]')) setElegida(null);
            const parte = t.closest('[data-parte]')?.getAttribute('data-parte');
            if (parte) setEnCelular(parte);
          }}
        >
          <header data-parte={MUESTRA_BIENVENIDA}>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Lo que ve el participante al entrar</p>
            <h1 className="mt-1 text-[24px] font-bold leading-tight text-[#1F1F23]">{textos('tituloPublico', 'Título', '')}</h1>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-[#45454D]">{textos('bienvenida', 'Bienvenida', '')}</p>
          </header>

          {conHuecos(def, pendientes).map((x, i) => (x.seccion
            ? <div key={x.seccion.id}><SeccionDoc s={x.seccion} i={def.secciones.indexOf(x.seccion)} total={def.secciones.length} ctx={ctx} /></div>
            : <HuecoSeccion key={`hueco-${x.id}-${i}`} titulo={x.titulo} escribiendo={x.escribiendo} />))}
          <button type="button" className={botonAgregar} onClick={() => agregarSeccionAl(def.secciones.length)}><Plus className="h-3.5 w-3.5" />Sección</button>

          <section data-parte={MUESTRA_FINAL} className="border-t border-[#E4E4E7] pt-6">
            <h2 className="text-[18px] font-bold text-[#1F1F23]">Al terminar</h2>
            <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Si llega al final</p>
            <p className="mt-0.5 whitespace-pre-line text-[14px] text-[#45454D]">{textos('despedida', 'Despedida', '')}</p>
            <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Si queda fuera antes (no se le dice por qué)</p>
            <p className="mt-0.5 whitespace-pre-line text-[14px] text-[#45454D]">{textos('noCalifica', 'Mensaje de no califica', '')}</p>
          </section>

          <Frentes ctx={ctx} />
        </article>

        {/* El celular al lado, solo donde cabe; en pantallas angostas está la pestaña Celular. */}
        {def.secciones.length > 0 && (
          <aside className="sticky top-4 hidden w-[340px] flex-shrink-0 xl:block">
            <MuestraCelular def={def} seccion={muestra} pregunta={elegida} onSeccion={setEnCelular} />
          </aside>
        )}
      </div>

      <AlertDialog open={!!porQuitar} onOpenChange={(o) => !o && setPorQuitar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar {porQuitar?.que}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {porQuitar?.usos.length ? (
                  <>
                    <p>Se usa en:</p>
                    <ul className="list-disc space-y-0.5 pl-5">{porQuitar.usos.map((u) => <li key={u}>{u}</li>)}</ul>
                    <p>Si la quitas, esa lógica deja de funcionar como ahora.</p>
                  </>
                ) : null}
                <p>Se puede deshacer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { porQuitar?.hacer(); setPorQuitar(null); }}>Quitar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Contexto.Provider>
  );
}
