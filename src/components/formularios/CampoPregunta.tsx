import { useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { uploadFile } from 'zite-file-upload-sdk';
import { seleccion, type PreguntaVisible } from '@/lib/formularios/motor';
import type { FotoSubida, Respuestas, Valor } from '@/lib/formularios/tipos';

const TEAL = '#0F3D4D';
const MAX_FOTOS = 3;

interface Props {
  pv: PreguntaVisible;
  resp: Respuestas;
  error?: string;
  codigo: string;
  onChange: (clave: string, valor: Valor | undefined) => void;
}

/** Una pregunta de la página pública /f/:codigo, pensada para el celular. */
export function CampoPregunta({ pv, resp, error, codigo, onChange }: Props) {
  const { pregunta: p, clave } = pv;
  const valor = resp[clave];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[16px] font-semibold leading-snug" style={{ color: TEAL }}>{pv.texto}</p>
        {pv.ayuda && <p className="mt-1 text-[13px] text-[#6E8388]">{pv.ayuda}</p>}
        {p.tipo === 'multiple' && <p className="mt-1 text-[12px] text-[#6E8388]">{p.maxOpciones ? `Marca hasta ${p.maxOpciones}` : 'Puedes marcar varias'}</p>}
      </div>

      {(p.tipo === 'texto' || p.tipo === 'telefono' || p.tipo === 'correo') && (
        <input
          className={inputClass}
          type={p.tipo === 'telefono' ? 'tel' : p.tipo === 'correo' ? 'email' : 'text'}
          inputMode={p.tipo === 'telefono' ? 'tel' : p.tipo === 'correo' ? 'email' : p.patron?.includes('\\d') ? 'numeric' : undefined}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onChange(clave, e.target.value)}
          autoComplete={p.tipo === 'telefono' ? 'tel' : p.tipo === 'correo' ? 'email' : 'off'}
        />
      )}
      {p.tipo === 'texto_largo' && (
        <textarea className={`${inputClass} min-h-[96px]`} value={typeof valor === 'string' ? valor : ''} onChange={(e) => onChange(clave, e.target.value)} />
      )}
      {p.tipo === 'numero' && (
        <input
          className={`${inputClass} max-w-[140px]`}
          inputMode="numeric"
          value={typeof valor === 'number' ? String(valor) : ''}
          onChange={(e) => {
            const limpio = e.target.value.replace(/\D/g, '');
            onChange(clave, limpio === '' ? undefined : Number(limpio));
          }}
        />
      )}

      {(p.tipo === 'unica' || p.tipo === 'multiple') && (
        <div className="space-y-2">
          {pv.opciones.map((o) => {
            const marcadas = seleccion(valor);
            const activa = marcadas.includes(o.id);
            const elegir = () => {
              if (p.tipo === 'unica') return onChange(clave, o.id);
              if (activa) return onChange(clave, marcadas.filter((x) => x !== o.id));
              if (o.exclusiva) return onChange(clave, [o.id]);
              const exclusivas = new Set(pv.opciones.filter((x) => x.exclusiva).map((x) => x.id));
              onChange(clave, [...marcadas.filter((x) => !exclusivas.has(x)), o.id]);
            };
            return (
              <div key={o.id}>
                <button
                  type="button"
                  onClick={elegir}
                  className={`flex w-full items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left text-[15px] transition-colors ${
                    activa ? 'border-[#0F3D4D] bg-[#0F3D4D]/[0.06] font-medium' : 'border-[#D5E2E5] bg-white'
                  }`}
                  style={{ color: TEAL }}
                >
                  <span
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center border-[1.5px] ${p.tipo === 'unica' ? 'rounded-full' : 'rounded-md'} ${
                      activa ? 'border-[#0F3D4D] bg-[#0F3D4D] text-white' : 'border-[#A9BCC1]'
                    }`}
                  >
                    {activa && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  {o.label}
                </button>
                {o.otra && activa && (
                  <input
                    className={`${inputClass} mt-2`}
                    placeholder="¿Cuál?"
                    value={typeof resp[`${clave}#otra`] === 'string' ? (resp[`${clave}#otra`] as string) : ''}
                    onChange={(e) => onChange(`${clave}#otra`, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {p.tipo === 'matriz' && (
        <div className="space-y-3">
          {(p.filas ?? []).map((f) => {
            const filas = (valor as Record<string, string> | undefined) ?? {};
            return (
              <div key={f.id} className="rounded-xl border border-[#D5E2E5] bg-white p-3">
                <p className="mb-2 text-[14px] font-medium" style={{ color: TEAL }}>{f.label}</p>
                <div className="flex flex-wrap gap-2">
                  {pv.opciones.map((o) => {
                    const activa = filas[f.id] === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => onChange(clave, { ...filas, [f.id]: o.id })}
                        className={`rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition-colors ${
                          activa ? 'border-[#0F3D4D] bg-[#0F3D4D] text-white' : 'border-[#D5E2E5] text-[#0F3D4D]'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {p.tipo === 'foto' && <CampoFoto valor={(valor as FotoSubida[] | undefined) ?? []} codigo={codigo} onChange={(v) => onChange(clave, v)} />}

      {error && <p className="text-[13px] font-medium text-[#D32222]">{error}</p>}
    </div>
  );
}

const inputClass = 'w-full rounded-xl border-[1.5px] border-[#D5E2E5] bg-white px-4 py-3 text-[16px] text-[#0F3D4D] outline-none focus:border-[#0F3D4D]';

function CampoFoto({ valor, codigo, onChange }: { valor: FotoSubida[]; codigo: string; onChange: (v: FotoSubida[]) => void }) {
  const [subiendo, setSubiendo] = useState(false);
  const [falla, setFalla] = useState('');
  const [vistas, setVistas] = useState<Record<string, string>>({});

  const subir = async (archivo: File) => {
    setSubiendo(true);
    setFalla('');
    try {
      const { fileUrl } = await uploadFile({ data: archivo, filename: archivo.name, formularioCodigo: codigo });
      setVistas((v) => ({ ...v, [fileUrl]: URL.createObjectURL(archivo) }));
      onChange([...valor, { ruta: fileUrl, nombre: archivo.name }]);
    } catch (err) {
      setFalla((err as Error).message || 'No se pudo subir la foto. Intenta otra vez.');
    }
    setSubiendo(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {valor.map((f) => (
          <div key={f.ruta} className="relative h-24 w-24 overflow-hidden rounded-xl border border-[#D5E2E5] bg-[#E8F0F2]">
            {vistas[f.ruta]
              ? <img src={vistas[f.ruta]} alt="" className="h-full w-full object-cover" />
              : <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-[#6E8388]"><Check className="mr-1 h-3 w-3" />Foto subida</div>}
            <button
              type="button"
              onClick={() => onChange(valor.filter((x) => x.ruta !== f.ruta))}
              className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white"
              aria-label="Quitar foto"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {valor.length < MAX_FOTOS && (
        <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[#A9BCC1] bg-white px-4 py-4 text-[15px] font-medium text-[#0F3D4D] ${subiendo ? 'opacity-60' : ''}`}>
          {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {subiendo ? 'Subiendo…' : valor.length ? 'Agregar otra foto' : 'Tomar o elegir foto'}
          <input
            type="file" accept="image/*" className="hidden" disabled={subiendo}
            onChange={(e) => { const a = e.target.files?.[0]; e.target.value = ''; if (a) subir(a); }}
          />
        </label>
      )}
      {falla && <p className="text-[13px] text-[#D32222]">{falla}</p>}
    </div>
  );
}
