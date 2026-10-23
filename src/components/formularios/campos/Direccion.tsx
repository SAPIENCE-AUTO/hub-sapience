import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { getCodigoPostal } from 'zite-endpoints-sdk';
import { PAISES, nombreCampoDireccion } from '@/lib/formularios/paises';
import type { CampoDireccion } from '@/lib/formularios/tipos';
import { SUAVE, etiquetaClass, inputClass, type CampoProps } from './estilo';
import { BuscarDireccion } from './BuscarDireccion';

const AUTOCOMPLETAR: Record<CampoDireccion, string> = {
  calle: 'address-line1', numero: 'address-line2', colonia: 'address-level3', ciudad: 'address-level2', estado: 'address-level1', cp: 'postal-code',
};

interface Cp { encontrado: boolean; catalogo?: boolean; estado?: string; municipio?: string; colonias: string[] }
/** Lo ya buscado, para no volver a pedirlo al ir y venir entre pantallas. */
const buscados = new Map<string, Promise<Cp>>();
const buscar = (pais: string, cp: string) => {
  const clave = `${pais}:${cp}`;
  if (!buscados.has(clave)) {
    buscados.set(clave, (getCodigoPostal({ pais, cp }) as Promise<Cp>).catch(() => { buscados.delete(clave); return { encontrado: false, colonias: [] }; }));
  }
  return buscados.get(clave)!;
};

const OTRA = '__otra__';

function Select({ valor, opciones, vacio, onChange, autoComplete }: { valor: string; opciones: string[]; vacio: string; onChange: (v: string) => void; autoComplete?: string }) {
  return (
    <div className="relative">
      <select
        className={`${inputClass} appearance-none pr-10 ${valor ? '' : 'text-[#8E8E96]'}`}
        value={valor}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>{vacio}</option>
        {opciones.map((o) => <option key={o} value={o}>{o === OTRA ? 'No está en la lista (la escribo)' : o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#62626B]" />
    </div>
  );
}

/**
 * Dirección por campos, con los nombres y estados del país. Arriba, «Busca tu
 * dirección» (Google): al elegir una sugerencia se llenan los campos y solo se
 * revisan; si no la encuentran, se escribe a mano. Sin Google, los campos van
 * directo. Donde hay catálogo de códigos postales, el código postal llena el
 * estado y el municipio y la colonia se elige de la lista (o se escribe).
 */
export function Direccion({ pv, resp, onChange, pais, codigo }: CampoProps & { pais?: string; codigo?: string }) {
  const d = (resp[pv.clave] as Record<string, string> | undefined) ?? {};
  const config = pais ? PAISES[pais] : undefined;
  const estados = config?.estados;
  const conCp = !!config?.buscaCp && !!pais;
  const [info, setInfo] = useState<Cp | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [otraColonia, setOtraColonia] = useState(false);
  const [sinGoogle, setSinGoogle] = useState(!codigo);
  const [aMano, setAMano] = useState(false);
  // Lo último que se llenó solo: si la persona no lo cambió, un código postal nuevo lo reemplaza.
  const puesto = useRef<{ ciudad?: string; estado?: string }>({});
  const dRef = useRef(d);
  dRef.current = d;

  const poner = (cambio: Partial<Record<CampoDireccion, string>>) => onChange(pv.clave, { ...dRef.current, ...cambio });

  const cp = (d.cp ?? '').trim();
  useEffect(() => {
    if (!conCp || !/^\d{5}$/.test(cp)) { setInfo(null); return; }
    let vigente = true;
    setBuscando(true);
    void buscar(pais!, cp).then((r) => {
      if (!vigente) return;
      setBuscando(false);
      setInfo(r);
      if (!r.encontrado) return;
      const actual = dRef.current;
      const cambio: Partial<Record<CampoDireccion, string>> = {};
      if (r.municipio && (!actual.ciudad || actual.ciudad === puesto.current.ciudad)) cambio.ciudad = r.municipio;
      if (r.estado && (!actual.estado || actual.estado === puesto.current.estado)) cambio.estado = r.estado;
      if (!actual.colonia && r.colonias.length === 1) cambio.colonia = r.colonias[0];
      puesto.current = { ciudad: cambio.ciudad ?? puesto.current.ciudad, estado: cambio.estado ?? puesto.current.estado };
      if (Object.keys(cambio).length) poner(cambio);
    });
    return () => { vigente = false; };
  }, [cp, conCp, pais]); // eslint-disable-line react-hooks/exhaustive-deps

  const etiqueta = (c: CampoDireccion) => <span className={etiquetaClass}>{nombreCampoDireccion(pais, c)}</span>;
  const campo = (c: CampoDireccion, extra?: { numerico?: boolean; maximo?: number }) => (
    <label className="block">
      {etiqueta(c)}
      <input
        className={inputClass}
        value={d[c] ?? ''}
        autoComplete={AUTOCOMPLETAR[c]}
        inputMode={extra?.numerico ? 'numeric' : undefined}
        maxLength={extra?.maximo}
        onChange={(e) => poner({ [c]: extra?.numerico ? e.target.value.replace(/\D/g, '') : e.target.value })}
      />
    </label>
  );
  const estado = estados ? (
    <label className="block">
      {etiqueta('estado')}
      <Select valor={d.estado ?? ''} opciones={estados} vacio="Elige" autoComplete={AUTOCOMPLETAR.estado} onChange={(v) => poner({ estado: v })} />
    </label>
  ) : campo('estado');

  const verCampos = sinGoogle || aMano || Object.values(d).some((v) => v?.trim());
  const buscador = !sinGoogle && codigo && (
    <div>
      <BuscarDireccion
        codigo={codigo}
        onNoDisponible={() => setSinGoogle(true)}
        onElegir={(partes) => {
          puesto.current = { ciudad: partes.ciudad, estado: partes.estado };
          setOtraColonia(false);
          poner(partes);
        }}
      />
      {!verCampos && (
        <button type="button" className="mt-2 text-[13px] underline underline-offset-2" style={{ color: SUAVE }} onClick={() => setAMano(true)}>
          No la encuentro: escribirla a mano
        </button>
      )}
    </div>
  );
  if (!verCampos) return <div className="space-y-3">{buscador}</div>;

  if (!conCp) {
    return (
      <div className="space-y-3">
        {buscador}
        {campo('calle')}
        <div className="grid grid-cols-2 gap-3">
          {campo('numero')}
          {campo('cp', { numerico: true })}
        </div>
        {campo('colonia')}
        {campo('ciudad')}
        {estado}
      </div>
    );
  }

  const colonias = info?.encontrado ? info.colonias : [];
  const escribirColonia = !colonias.length || otraColonia || (!!d.colonia && !colonias.includes(d.colonia));
  return (
    <div className="space-y-3">
      {buscador}
      <div>
        <label className="block max-w-[200px]">
          {etiqueta('cp')}
          <input
            className={`${inputClass} tabular-nums`}
            value={d.cp ?? ''}
            autoComplete={AUTOCOMPLETAR.cp}
            inputMode="numeric"
            maxLength={5}
            onChange={(e) => poner({ cp: e.target.value.replace(/\D/g, '') })}
          />
        </label>
        {buscando && <p className="mt-1 flex items-center gap-1.5 text-[13px]" style={{ color: SUAVE }}><Loader2 className="h-3.5 w-3.5 animate-spin" />Buscando tu código postal…</p>}
        {!buscando && info && !info.encontrado && info.catalogo && <p className="mt-1 text-[13px]" style={{ color: SUAVE }}>No encontramos ese código postal. Revísalo o escribe tu dirección.</p>}
      </div>

      <label className="block">
        {etiqueta('colonia')}
        {escribirColonia ? (
          <input className={inputClass} value={d.colonia ?? ''} autoComplete={AUTOCOMPLETAR.colonia} onChange={(e) => poner({ colonia: e.target.value })} />
        ) : (
          <Select
            valor={d.colonia ?? ''}
            opciones={[...colonias, OTRA]}
            vacio="Elige tu colonia"
            onChange={(v) => { if (v === OTRA) { setOtraColonia(true); poner({ colonia: '' }); } else poner({ colonia: v }); }}
          />
        )}
        {escribirColonia && colonias.length > 0 && (
          <button type="button" className="mt-1 text-[13px] underline underline-offset-2" style={{ color: SUAVE }} onClick={() => { setOtraColonia(false); poner({ colonia: '' }); }}>
            Elegirla de la lista
          </button>
        )}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        {campo('ciudad')}
        {estado}
      </div>
      {campo('calle')}
      {campo('numero')}
    </div>
  );
}
