import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ImagePlus, Link2, Loader2, MoreHorizontal, Plus, Sparkles, X } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logicaDeOpcion } from '@/lib/formularios/palabras';
import {
  agregarFila, agregarOpcion, cambiarFila, cambiarOpcion, cambiarTipo, moverFila, moverOpcion, quitarFila, quitarOpcion, usosDeOpcion,
} from '@/lib/formularios/editar';
import { esDeOpciones, forma, type Opcion, type Pregunta, type Seccion } from '@/lib/formularios/tipos';
import { BotonIcono, EnlaceImagen, EtiquetasLogica, Logica, PedidoImagenIA, claveDestino, useDoc, type Destino } from './comun';
import { TextoEditable } from './TextoEditable';
import { imagenesDe, traeArchivos } from './imagenes';

/** Props para que una fila reciba una imagen arrastrada y sepa que el cursor está encima (para pegar). */
export function useZonaImagen(destino: Destino, alSalir?: Destino | null) {
  const { apuntar, ponerImagen, subiendo } = useDoc();
  const [encima, setEncima] = useState(false);
  return {
    encima,
    cargando: subiendo.has(claveDestino(destino)),
    props: {
      onMouseEnter: () => apuntar(destino),
      onMouseLeave: () => apuntar(alSalir ?? null),
      onDragOver: (e: React.DragEvent) => {
        if (!traeArchivos(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setEncima(true);
      },
      onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false); },
      onDrop: (e: React.DragEvent) => {
        if (!traeArchivos(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setEncima(false);
        const [archivo] = imagenesDe(e.dataTransfer);
        if (archivo) ponerImagen(destino, archivo);
        else toast.error('Solo imágenes (PNG, JPG, WebP o GIF).');
      },
    },
  };
}

/** Un selector de archivo escondido, para «Poner imagen…» desde un menú. */
export function useElegirImagen(destino: Destino) {
  const { ponerImagen } = useDoc();
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) ponerImagen(destino, a); }}
    />
  );
  return { input, elegir: () => ref.current?.click() };
}

/** El tipo con imágenes que corresponde a una pregunta de opciones, para que la imagen de una opción se vea. */
export function tipoConImagen(p: Pregunta): Pregunta['tipo'] | undefined {
  if (p.tipo === 'imagen_unica' || p.tipo === 'imagen_multiple') return p.tipo;
  if (p.tipo === 'unica' || p.tipo === 'lista') return 'imagen_unica';
  if (p.tipo === 'multiple' || p.tipo === 'lista_multiple') return 'imagen_multiple';
  return undefined;
}

function Marca({ p, i }: { p: Pregunta; i: number }) {
  if (forma(p.tipo) === 'orden') return <span className="w-5 flex-shrink-0 pt-0.5 text-right text-[12px] tabular-nums text-muted-foreground">{i + 1}.</span>;
  const una = forma(p.tipo) === 'una' || forma(p.tipo) === 'matriz_una';
  return <span className={`mt-[5px] h-3 w-3 flex-shrink-0 border border-[#71717A] ${una ? 'rounded-full' : 'rounded-[3px]'}`} />;
}

function FilaOpcion({ s, p, o, i, total, bloqueada }: { s: Seccion; p: Pregunta; o: Opcion; i: number; total: number; bloqueada: boolean }) {
  const { def, aplicar, quitar, nuevo, setNuevo, elegida, ponerImagenDeEnlace, crearImagenConIA } = useDoc();
  const [enlace, setEnlace] = useState(false);
  const [conIA, setConIA] = useState(false);
  const destino: Destino = { tipo: 'opcion', pregunta: p.id, opcion: o.id };
  const zona = useZonaImagen(destino, { tipo: 'pregunta', pregunta: p.id });
  const { input, elegir } = useElegirImagen(destino);
  const deOpciones = esDeOpciones(p.tipo);
  const varias = forma(p.tipo) === 'varias';
  const cambiar = (cambio: Partial<Omit<Opcion, 'id'>>) => aplicar((d) => cambiarOpcion(d, p.id, o.id, cambio));
  const lineas = logicaDeOpcion(def, p, o);
  const puedeImagen = !!tipoConImagen(p);

  const pedirQuitar = () => {
    const usos = usosDeOpcion(def, p.id, o.id);
    const hacer = () => aplicar((d) => quitarOpcion(d, p.id, o.id));
    if (usos.length) quitar({ que: `la opción «${o.label}»`, usos, hacer }); else hacer();
  };

  return (
    <li
      {...zona.props}
      className={`group/o relative -mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 ${zona.encima ? 'bg-[#1795D3]/10 ring-2 ring-[#1795D3]/50' : 'hover:bg-muted/40'}`}
    >
      {input}
      <Marca p={p} i={i} />
      {(o.imagen || zona.cargando) && (
        <span className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded border bg-muted">
          {o.imagen && <img src={o.imagen} alt="" className="h-full w-full object-cover" />}
          {zona.cargando && <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="h-4 w-4 animate-spin text-[#0F3D4D]" /></span>}
        </span>
      )}
      <div className="min-w-0 flex-1 text-[14px] leading-snug">
        {bloqueada ? o.label : (
          <TextoEditable
            valor={o.label} linea obligatorio etiqueta="Opción"
            abrir={nuevo === o.id} onCerrar={() => nuevo === o.id && setNuevo(null)}
            onGuardar={(v) => cambiar({ label: v })}
          />
        )}
        {/* Elegida la pregunta, la lógica completa (con el motivo editable); si no, solo sus etiquetas. */}
        {elegida === p.id && <Logica lineas={lineas} className="mt-0.5" onMotivo={bloqueada ? undefined : (campo, v) => cambiar({ [campo]: v })} />}
        {enlace && <EnlaceImagen onPoner={(url) => ponerImagenDeEnlace(destino, url)} onCerrar={() => setEnlace(false)} />}
        {conIA && <PedidoImagenIA inicial={o.label} onCrear={(pedido) => crearImagenConIA(destino, pedido)} onCerrar={() => setConIA(false)} />}
      </div>
      {elegida !== p.id && <EtiquetasLogica lineas={lineas} />}
      {!bloqueada && (
        <div className={`flex-shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover/o:opacity-100 sm:focus-within:opacity-100 ${elegida === p.id ? 'flex' : 'hidden'}`}>
          <BotonIcono titulo="Subir" disabled={i === 0} onClick={() => aplicar((d) => moverOpcion(d, p.id, o.id, -1))}><ArrowUp className="h-3.5 w-3.5" /></BotonIcono>
          <BotonIcono titulo="Bajar" disabled={i === total - 1} onClick={() => aplicar((d) => moverOpcion(d, p.id, o.id, 1))}><ArrowDown className="h-3.5 w-3.5" /></BotonIcono>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Más de esta opción" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#0F3D4D]">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
              {deOpciones && (
                <DropdownMenuCheckboxItem checked={!!o.termina} onCheckedChange={(v) => cambiar({ termina: v ? `Marcó «${o.label}»` : undefined, cortar: undefined })}>
                  No califica (lo deja fuera)
                </DropdownMenuCheckboxItem>
              )}
              {deOpciones && o.termina && (
                <DropdownMenuCheckboxItem checked={!!o.cortar} onCheckedChange={(v) => cambiar({ cortar: v || undefined })}>
                  Y cortar el filtro aquí
                </DropdownMenuCheckboxItem>
              )}
              {deOpciones && s.repetirPor && (
                <DropdownMenuCheckboxItem checked={!!o.descarta} onCheckedChange={(v) => cambiar({ descarta: v ? `Marcó «${o.label}»` : undefined })}>
                  No cuenta este bloque
                </DropdownMenuCheckboxItem>
              )}
              {varias && (
                <DropdownMenuCheckboxItem checked={!!o.exclusiva} onCheckedChange={(v) => cambiar({ exclusiva: v || undefined })}>
                  Quita las demás (tipo «Ninguno»)
                </DropdownMenuCheckboxItem>
              )}
              {deOpciones && (
                <DropdownMenuCheckboxItem checked={!!o.otra} onCheckedChange={(v) => cambiar({ otra: v || undefined })}>
                  Pide escribir cuál
                </DropdownMenuCheckboxItem>
              )}
              {p.aleatorio && (
                <DropdownMenuCheckboxItem checked={!!o.fija} onCheckedChange={(v) => cambiar({ fija: v || undefined })}>
                  Fija al final con el orden aleatorio
                </DropdownMenuCheckboxItem>
              )}
              {puedeImagen && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={elegir}><ImagePlus className="mr-2 h-4 w-4" />{o.imagen ? 'Cambiar imagen…' : 'Poner imagen…'}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => setConIA(true), 0)}><Sparkles className="mr-2 h-4 w-4" />Crear imagen con IA…</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => setEnlace(true), 0)}><Link2 className="mr-2 h-4 w-4" />Pegar enlace de imagen…</DropdownMenuItem>
                  {o.imagen && <DropdownMenuItem onSelect={() => cambiar({ imagen: undefined })}>Quitar imagen</DropdownMenuItem>}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <BotonIcono titulo="Quitar opción" peligro disabled={total <= 1 && !p.opcionesDe} onClick={pedirQuitar}><X className="h-3.5 w-3.5" /></BotonIcono>
        </div>
      )}
    </li>
  );
}

/** Opciones de una pregunta (o columnas de una matriz). Si salen de otra pregunta, aquí solo van las que se agregan al final. */
export function ListaOpciones({ s, p, bloqueada, titulo }: { s: Seccion; p: Pregunta; bloqueada: boolean; titulo?: string }) {
  const { aplicar, setNuevo, elegida } = useDoc();
  const lista = (p.opcionesDe ? p.opcionesExtra : p.opciones) ?? [];
  const agregar = () => {
    let id = '';
    aplicar((d) => { const r = agregarOpcion(d, p.id); id = r.id; return r.def; });
    setNuevo(id);
  };
  return (
    <div className="mt-2">
      {titulo && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>}
      <ul className="space-y-0.5">
        {lista.map((o, i) => <FilaOpcion key={o.id} s={s} p={p} o={o} i={i} total={lista.length} bloqueada={bloqueada} />)}
      </ul>
      {!bloqueada && elegida === p.id && (
        <button type="button" onClick={agregar} className="mt-1 flex items-center gap-1 rounded px-1 py-0.5 text-[12.5px] font-medium text-[#0F3D4D]/80 hover:bg-[#0F3D4D]/5 hover:text-[#0F3D4D]">
          <Plus className="h-3.5 w-3.5" />{p.opcionesDe ? 'Opción al final' : esDeOpciones(p.tipo) || p.tipo === 'ordenar' ? 'Opción' : 'Columna'}
        </button>
      )}
    </div>
  );
}

/** Filas de una matriz: su id es la clave de su columna en el tablero, así que solo se corrige el texto. */
export function ListaFilas({ p }: { p: Pregunta }) {
  const { aplicar, quitar, nuevo, setNuevo, elegida } = useDoc();
  const activa = elegida === p.id;
  const filas = p.filas ?? [];
  return (
    <div className="mt-2">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filas</p>
      <ul className="space-y-0.5">
        {filas.map((f, i) => (
          <li key={f.id} className="group/o -mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/40">
            <span className="mt-[7px] h-px w-3 flex-shrink-0 bg-[#71717A]" />
            <div className="min-w-0 flex-1 text-[14px]">
              <TextoEditable valor={f.label} linea obligatorio etiqueta="Fila" abrir={nuevo === f.id} onCerrar={() => nuevo === f.id && setNuevo(null)} onGuardar={(v) => aplicar((d) => cambiarFila(d, p.id, f.id, v))} />
            </div>
            <div className={`flex-shrink-0 items-center sm:opacity-0 sm:group-hover/o:opacity-100 ${activa ? 'flex' : 'hidden'}`}>
              <BotonIcono titulo="Subir" disabled={i === 0} onClick={() => aplicar((d) => moverFila(d, p.id, f.id, -1))}><ArrowUp className="h-3.5 w-3.5" /></BotonIcono>
              <BotonIcono titulo="Bajar" disabled={i === filas.length - 1} onClick={() => aplicar((d) => moverFila(d, p.id, f.id, 1))}><ArrowDown className="h-3.5 w-3.5" /></BotonIcono>
              <BotonIcono
                titulo="Quitar fila" peligro disabled={filas.length <= 1}
                onClick={() => {
                  const hacer = () => aplicar((d) => quitarFila(d, p.id, f.id));
                  if (p.reglasMatriz?.some((r) => r.fila === f.id)) quitar({ que: `la fila «${f.label}»`, usos: ['una regla de la matriz'], hacer }); else hacer();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </BotonIcono>
            </div>
          </li>
        ))}
      </ul>
      {activa && (
        <button
          type="button"
          onClick={() => { let id = ''; aplicar((d) => { const r = agregarFila(d, p.id); id = r.id; return r.def; }); setNuevo(id); }}
          className="mt-1 flex items-center gap-1 rounded px-1 py-0.5 text-[12.5px] font-medium text-[#0F3D4D]/80 hover:bg-[#0F3D4D]/5 hover:text-[#0F3D4D]"
        >
          <Plus className="h-3.5 w-3.5" />Fila
        </button>
      )}
    </div>
  );
}

/** Al poner imagen a una opción de una pregunta que no las muestra, la pregunta pasa al selector con imágenes. */
export function conImagenEnOpcion(p: Pregunta, opcionId: string, url: string) {
  const tipo = tipoConImagen(p);
  return (d: Parameters<typeof cambiarOpcion>[0]) => {
    const conImagen = cambiarOpcion(d, p.id, opcionId, { imagen: url });
    return tipo && tipo !== p.tipo ? cambiarTipo(conImagen, p.id, tipo) : conImagen;
  };
}
