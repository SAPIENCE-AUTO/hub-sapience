import { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Lock, MoreHorizontal, Trash2, X } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logicaDePregunta } from '@/lib/formularios/palabras';
import { GRUPOS_TIPOS, cambiarPregunta, cambiarTipo, esDelNse, moverPregunta, quitarPregunta, sePuedeMover, usosDePregunta } from '@/lib/formularios/editar';
import { rango } from '@/lib/formularios/motor';
import { nombreCampoDireccion } from '@/lib/formularios/paises';
import { nombreDePregunta } from '@/lib/formularios/tabla';
import { TEAL } from '@/lib/toolColors';
import { CAMPOS_DIRECCION, TIPOS, esDeOpciones, esMatriz, forma, type Pregunta, type Seccion } from '@/lib/formularios/tipos';
import { BotonIcono, Logica, useAlCerrarMenu, useDoc } from './comun';
import { EditorCondicion, EditorMaximo, EditorRango } from './Ajustes';
import { ListaFilas, ListaOpciones, useElegirImagen, useZonaImagen } from './Opciones';
import { TextoEditable } from './TextoEditable';
import { PropuestaIA } from '../generador/PropuestaIA';
import { MarcaIA } from '../generador/comun';

type Abierto = 'condicion' | 'rango' | 'maximo' | 'ayuda' | 'nota' | 'ia' | null;

/** Cómo se ve la respuesta en el documento cuando no es de opciones (como en el Word: una línea, los campos…). */
function Respuesta({ p }: { p: Pregunta }) {
  const { def, aplicar } = useDoc();
  const linea = (texto: string) => <p className="mt-1.5 border-b border-dashed border-[#A1A1AA] pb-1 text-[12.5px] text-muted-foreground">{texto}</p>;
  switch (p.tipo) {
    case 'texto': return linea(p.patronMensaje ? `Respuesta corta · ${p.patronMensaje}` : 'Respuesta corta');
    case 'texto_largo': return linea('Respuesta larga');
    case 'numero': return linea('Número');
    case 'telefono': return linea('Celular de 10 dígitos');
    case 'correo': return linea('Correo');
    case 'direccion': return linea(CAMPOS_DIRECCION.map((c) => nombreCampoDireccion(def.pais, c)).join(' · '));
    case 'foto': return linea('Foto desde el celular (hasta 3)');
    case 'casilla': return <p className="mt-1.5 flex items-center gap-2 text-[12.5px] text-muted-foreground"><span className="h-3 w-3 rounded-[3px] border border-[#71717A]" />Casilla que se marca</p>;
    case 'interruptor': return <p className="mt-1.5 text-[12.5px] text-muted-foreground">Sí · No (arranca en No)</p>;
    case 'escala': case 'estrellas': case 'deslizador': {
      const r = rango(p);
      const etiqueta = (lado: 'min' | 'max') => (
        <TextoEditable
          valor={p.etiquetas?.[lado] ?? ''} linea etiqueta={lado === 'min' ? 'Extremo bajo' : 'Extremo alto'}
          placeholder={lado === 'min' ? 'Texto del extremo bajo' : 'Texto del extremo alto'}
          onGuardar={(v) => aplicar((d) => cambiarPregunta(d, p.id, { etiquetas: { ...p.etiquetas, [lado]: v || undefined } }))}
        />
      );
      return (
        <div className="mt-1.5 text-[12.5px] text-muted-foreground">
          <p>{p.tipo === 'estrellas' ? `De 1 a ${r.max} estrellas` : `De ${r.min} a ${r.max}${p.tipo === 'deslizador' && r.paso !== 1 ? `, de ${r.paso} en ${r.paso}` : ''}`}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-4">
            <span>{r.min}: {etiqueta('min')}</span>
            <span>{r.max}: {etiqueta('max')}</span>
          </p>
        </div>
      );
    }
    default: return null;
  }
}

export function PreguntaDoc({ s, p }: { s: Seccion; p: Pregunta }) {
  const { def, aplicar, quitar, nuevo, setNuevo, ia } = useDoc();
  const [abierto, setAbierto] = useState<Abierto>(null);
  const { despues, alCerrar } = useAlCerrarMenu();
  const abrirAl = (a: Abierto) => () => despues(() => setAbierto(a));
  const bloqueada = esDelNse(def, p.id);
  const destino = { tipo: 'pregunta' as const, pregunta: p.id };
  const zona = useZonaImagen(destino);
  const { input, elegir } = useElegirImagen(destino);
  const f = forma(p.tipo);
  const cambiar = (cambio: Partial<Omit<Pregunta, 'id' | 'tipo'>>) => aplicar((d) => cambiarPregunta(d, p.id, cambio));
  const usaOpciones = esDeOpciones(p.tipo) || esMatriz(p.tipo) || f === 'orden';
  const ultima = s.preguntas.length === 1;

  const pedirQuitar = () => {
    const usos = usosDePregunta(def, p.id);
    const hacer = () => aplicar((d) => quitarPregunta(d, p.id));
    if (usos.length) quitar({ que: 'esta pregunta', usos, hacer }); else hacer();
  };

  const onMotivo = (campo: string, motivo: string) => {
    if (campo === 'terminaFuera' && p.terminaFuera) cambiar({ terminaFuera: { ...p.terminaFuera, motivo } });
    if (campo === 'terminaSi' && p.terminaSi) cambiar({ terminaSi: { ...p.terminaSi, motivo } });
  };

  return (
    <div
      id={`filtro-p-${p.id}`}
      {...zona.props}
      className={`group/p relative -mx-3 scroll-mt-24 rounded-lg px-3 py-3 transition-colors ${zona.encima ? 'bg-[#1795D3]/[0.07] ring-2 ring-[#1795D3]/40' : 'hover:bg-[#0F3D4D]/[0.025]'}`}
    >
      {input}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {f !== 'ninguna' && (
            <p className="mb-0.5 text-[12px] font-semibold leading-snug" style={{ color: TEAL }} title="Nombre corto: el de su columna en el tablero y en el Excel. El participante no lo ve.">
              {bloqueada ? nombreDePregunta(p) : (
                <TextoEditable
                  valor={p.nombre ?? ''} linea etiqueta="Nombre corto" placeholder="Sin nombre corto"
                  className={p.nombre?.trim() ? '' : '!text-[#8a4b00]'}
                  onGuardar={(v) => cambiar({ nombre: v || undefined })}
                />
              )}
            </p>
          )}
          <p className={`text-[15px] leading-snug text-[#1F1F23] ${p.tipo === 'contenido' ? 'whitespace-pre-line' : 'font-semibold'}`}>
            {bloqueada ? p.texto : (
              <TextoEditable
                valor={p.texto} etiqueta={p.tipo === 'contenido' ? 'Texto' : 'Pregunta'} obligatorio={p.tipo !== 'contenido'}
                placeholder="Sin texto" abrir={nuevo === p.id} onCerrar={() => nuevo === p.id && setNuevo(null)}
                onGuardar={(v) => cambiar({ texto: v })}
              />
            )}
          </p>
          {(p.ayuda || abierto === 'ayuda') && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              <TextoEditable valor={p.ayuda ?? ''} etiqueta="Ayuda" placeholder="Ayuda bajo la pregunta" abrir={abierto === 'ayuda'} onCerrar={() => setAbierto(null)} onGuardar={(v) => cambiar({ ayuda: v || undefined })} />
            </p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
            {TIPOS[p.tipo]?.nombre ?? p.tipo}
            {p.opcional && f !== 'ninguna' && <span className="font-normal normal-case tracking-normal">· opcional</span>}
            {bloqueada && <span className="flex items-center gap-1 font-normal normal-case tracking-normal"><Lock className="h-3 w-3" />cuestionario oficial de NSE</span>}
          </p>
        </div>
        {!bloqueada && (
          <div className="flex flex-shrink-0 items-center opacity-100 transition-opacity sm:opacity-40 sm:group-hover/p:opacity-100 sm:focus-within:opacity-100">
            {ia && <BotonIcono titulo="Pedir un cambio a la IA" onClick={() => setAbierto(abierto === 'ia' ? null : 'ia')}><MarcaIA className="h-4 w-4" /></BotonIcono>}
            <BotonIcono titulo="Subir pregunta" disabled={!sePuedeMover(def, p.id, -1)} onClick={() => aplicar((d) => moverPregunta(d, p.id, -1))}><ArrowUp className="h-4 w-4" /></BotonIcono>
            <BotonIcono titulo="Bajar pregunta" disabled={!sePuedeMover(def, p.id, 1)} onClick={() => aplicar((d) => moverPregunta(d, p.id, 1))}><ArrowDown className="h-4 w-4" /></BotonIcono>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Más de esta pregunta" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#0F3D4D]">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={alCerrar}>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Cambiar tipo</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[70vh] w-60 overflow-y-auto">
                    {GRUPOS_TIPOS.map((g) => (
                      <div key={g.nombre}>
                        <DropdownMenuLabel className="text-[11px] text-muted-foreground">{g.nombre}</DropdownMenuLabel>
                        {g.tipos.map((t) => (
                          <DropdownMenuCheckboxItem key={t} checked={p.tipo === t} onCheckedChange={() => aplicar((d) => cambiarTipo(d, p.id, t))}>
                            {TIPOS[t].nombre}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </div>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                {f !== 'ninguna' && p.tipo !== 'interruptor' && (
                  <DropdownMenuCheckboxItem checked={!p.opcional} onCheckedChange={(v) => cambiar({ opcional: v ? undefined : true })}>Obligatoria</DropdownMenuCheckboxItem>
                )}
                {usaOpciones && !esMatriz(p.tipo) && (
                  <DropdownMenuCheckboxItem checked={!!p.aleatorio} onCheckedChange={(v) => cambiar({ aleatorio: v || undefined })}>Opciones en orden aleatorio</DropdownMenuCheckboxItem>
                )}
                {(f === 'varias' || f === 'orden') && <DropdownMenuItem onSelect={abrirAl('maximo')}>{f === 'orden' ? 'Cuántas ordena…' : 'Cuántas puede marcar…'}</DropdownMenuItem>}
                {f === 'numero' && <DropdownMenuItem onSelect={abrirAl('rango')}>{p.tipo === 'numero' ? 'Qué números acepta…' : 'Rango de la escala…'}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={abrirAl('condicion')}>{p.mostrarSi ? 'Cambiar cuándo aparece…' : 'Mostrar solo si…'}</DropdownMenuItem>
                {!p.ayuda && p.tipo !== 'contenido' && <DropdownMenuItem onSelect={abrirAl('ayuda')}>Agregar ayuda</DropdownMenuItem>}
                {!p.nota && <DropdownMenuItem onSelect={abrirAl('nota')}>Agregar nota para el equipo</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => despues(elegir)}><ImagePlus className="mr-2 h-4 w-4" />{p.imagen ? 'Cambiar imagen…' : p.tipo === 'contenido' ? 'Poner imagen…' : 'Poner imagen arriba…'}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={ultima} className="text-[#D32222] focus:text-[#D32222]" onSelect={pedirQuitar}>
                  <Trash2 className="mr-2 h-4 w-4" />{ultima ? 'Es la única de la sección' : 'Quitar pregunta'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {(p.imagen || zona.cargando) && (
        <div className="relative mt-2 inline-block max-w-full">
          {p.imagen && <img src={p.imagen} alt="" className="max-h-56 max-w-full rounded-md border bg-white" />}
          {zona.cargando && <div className="flex h-24 w-40 items-center justify-center rounded-md border bg-muted/50"><Loader2 className="h-5 w-5 animate-spin text-[#0F3D4D]" /></div>}
          {p.imagen && !bloqueada && (
            <button type="button" aria-label="Quitar imagen" onClick={() => cambiar({ imagen: undefined })} className="absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover/p:opacity-100">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {esMatriz(p.tipo) && <ListaFilas p={p} />}
      {usaOpciones && <ListaOpciones s={s} p={p} bloqueada={bloqueada} titulo={esMatriz(p.tipo) ? 'Columnas' : undefined} />}
      {!usaOpciones && <Respuesta p={p} />}

      <Logica lineas={logicaDePregunta(def, p)} className="mt-2" onMotivo={bloqueada ? undefined : onMotivo} />

      {(p.nota || abierto === 'nota') && (
        <p className="mt-2 text-[12.5px] italic text-[#5B687B]">
          <span className="not-italic font-medium">Nota para el equipo: </span>
          <TextoEditable valor={p.nota ?? ''} etiqueta="Nota para el equipo" placeholder="Lógica o aclaración interna" abrir={abierto === 'nota'} onCerrar={() => setAbierto(null)} onGuardar={(v) => cambiar({ nota: v || undefined })} />
        </p>
      )}

      {abierto === 'condicion' && (
        <EditorCondicion lugar={{ seccion: s.id, pregunta: p.id }} actual={p.mostrarSi} onCerrar={() => setAbierto(null)} onGuardar={(c) => cambiar({ mostrarSi: c })} />
      )}
      {abierto === 'rango' && <EditorRango p={p} onCerrar={() => setAbierto(null)} onGuardar={cambiar} />}
      {abierto === 'maximo' && <EditorMaximo p={p} onCerrar={() => setAbierto(null)} onGuardar={(n) => cambiar({ maxOpciones: n })} />}
      {abierto === 'ia' && <PropuestaIA alcance={{ pregunta: p.id }} onCerrar={() => setAbierto(null)} />}
    </div>
  );
}
