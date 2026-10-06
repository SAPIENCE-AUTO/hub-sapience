import { useState } from 'react';
import { api, describeApiError } from '../../api';
import { minutosRoadmap, type BloqueGuia, type BloqueRoadmap, type EstadoGuia, type PropuestaBloques } from '../../../shared/guias';
import { Button, ErrorBox, Modal } from '../ui';

type Update = (fn: (s: EstadoGuia) => EstadoGuia) => void;

const sameBlock = (a: BloqueRoadmap, b: BloqueRoadmap) =>
  a.nombre.trim() === b.nombre.trim() && a.minutos === b.minutos && a.objetivos.join('\n') === b.objetivos.join('\n');

/** Con bloques nuevos, lo ya escrito se conserva solo en los que quedaron igual. */
function realign(s: EstadoGuia, bloques: BloqueRoadmap[]): (BloqueGuia | null)[] {
  return bloques.map((b) => {
    const j = s.bloques.findIndex((old) => sameBlock(old, b));
    return j >= 0 ? s.guia[j] ?? null : null;
  });
}

/** Paso 2: los bloques del roadmap. Los arma quien hace la guía, o los propone la IA. */
export default function StepBloques({ st, guideId, update, onBack, onNext }: {
  st: EstadoGuia; guideId: string; update: Update; onBack: () => void; onNext: () => void;
}) {
  const [busy, setBusy] = useState<'proponer' | 'ajustar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pedido, setPedido] = useState('');
  const [confirm, setConfirm] = useState<{ text: string; run: () => void } | null>(null);
  const written = st.guia.filter(Boolean).length;
  const total = minutosRoadmap(st.bloques);
  const diff = st.duracion - total;

  const set = (i: number, patch: Partial<BloqueRoadmap>) =>
    update((s) => ({ ...s, bloques: s.bloques.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const move = (i: number, dir: -1 | 1) => update((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.bloques.length) return s;
    const bloques = [...s.bloques];
    const guia = s.bloques.map((_, k) => s.guia[k] ?? null);
    [bloques[i], bloques[j]] = [bloques[j], bloques[i]];
    [guia[i], guia[j]] = [guia[j], guia[i]];
    return { ...s, bloques, guia };
  });
  const remove = (i: number) => {
    const run = () => update((s) => ({ ...s, bloques: s.bloques.filter((_, j) => j !== i), guia: s.guia.filter((_, j) => j !== i) }));
    if (st.guia[i]) setConfirm({ text: `El bloque ${i + 1} ya está escrito en la guía; si lo quitas, se borra lo escrito.`, run });
    else run();
  };
  const add = () => update((s) => ({ ...s, bloques: [...s.bloques, { nombre: '', minutos: Math.max(5, Math.min(30, s.duracion - minutosRoadmap(s.bloques))), objetivos: [] }], guia: [...s.bloques.map((_, k) => s.guia[k] ?? null), null] }));
  const manual = () => update((s) => ({
    ...s,
    bloques: [
      { nombre: 'Warm up', minutos: 5, objetivos: ['Entrar en calor', 'Conocer un poco a los participantes', 'Establecer el tono de la conversación'] },
      { nombre: '', minutos: Math.max(5, s.duracion - 5), objetivos: [] },
    ],
    guia: [null, null],
  }));

  async function ask(kind: 'proponer' | 'ajustar') {
    setBusy(kind);
    setError(null);
    try {
      const res = await api<PropuestaBloques>(`/api/guias/${guideId}/bloques/${kind}`, {
        method: 'POST', body: kind === 'proponer' ? { state: st } : { state: st, pedido },
      });
      update((s) => ({ ...s, bloques: res.bloques, supuestos: res.supuestos, guia: realign(s, res.bloques) }));
      if (kind === 'ajustar') setPedido('');
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(null);
    }
  }
  const guarded = (kind: 'proponer' | 'ajustar') => {
    if (written > 0 && kind === 'proponer') setConfirm({ text: 'Se reemplazan los bloques; lo ya escrito de la guía solo se conserva en los bloques que queden igual.', run: () => void ask(kind) });
    else void ask(kind);
  };

  const sinNombre = st.bloques.some((b) => !b.nombre.trim());

  return (
    <section className="panel stack gd-step-panel">
      <div>
        <h2 className="gd-h">2 · Bloques</h2>
        <p className="muted gd-p">El roadmap de la sesión: cada bloque con sus minutos y lo que busca.</p>
      </div>
      {error && <ErrorBox message={error} />}

      {st.bloques.length === 0 ? (
        <div className="gd-options">
          <button type="button" className="gd-option" onClick={manual} disabled={busy !== null}>
            <strong>Los armo yo</strong>
            <span className="muted">Empiezas con el warm up y agregas tus bloques, sus minutos y objetivos.</span>
          </button>
          <button type="button" className="gd-option is-ai" onClick={() => guarded('proponer')} disabled={busy !== null}>
            <strong>{busy === 'proponer' ? 'Armando los bloques…' : 'Propónmelos'}</strong>
            <span className="muted">La IA propone los bloques a partir del tema, con minutos que suman {st.duracion}. Después los ajustas.</span>
          </button>
        </div>
      ) : (
        <>
          <div className="gd-sum" role="status">
            <span>Suman {total} de {st.duracion} min</span>
            {diff === 0 ? <span className="ok">· cuadra</span> : <span className="off">· {diff > 0 ? `faltan ${diff}` : `sobran ${-diff}`} min</span>}
          </div>

          {st.supuestos.length > 0 && (
            <div className="gd-supuestos">
              <strong>La IA decidió esto sin que el tema lo dijera; revísalo:</strong>
              <ul>{st.supuestos.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <button className="btn-link small" onClick={() => update((s) => ({ ...s, supuestos: [] }))}>Ya lo revisé</button>
            </div>
          )}

          <ol className="gd-rows">
            {st.bloques.map((b, i) => (
              <li key={i} className="gd-row">
                <span className="gd-row-n" aria-hidden="true">{i + 1}</span>
                <div className="gd-row-main">
                  <div className="gd-row-top">
                    <input className="input" aria-label={`Nombre del bloque ${i + 1}`} placeholder="Nombre del bloque" value={b.nombre}
                      onChange={(e) => set(i, { nombre: e.target.value })} />
                    <label className="gd-min">
                      <input className="input" inputMode="numeric" aria-label={`Minutos del bloque ${i + 1}`} value={b.minutos || ''}
                        onChange={(e) => set(i, { minutos: Math.min(600, Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10)) })} />
                      <span className="small muted">min</span>
                    </label>
                  </div>
                  {b.minutos % 5 !== 0 && <span className="gd-warn">Conviene en múltiplos de 5 minutos.</span>}
                  <textarea className="textarea gd-ta-sm" aria-label={`Objetivos del bloque ${i + 1}`} placeholder="Objetivos, uno por renglón"
                    value={b.objetivos.join('\n')} onChange={(e) => set(i, { objetivos: e.target.value.split('\n').slice(0, 15) })} />
                  {st.guia[i] && <span className="small muted">Ya está escrito en la guía.</span>}
                </div>
                <div className="gd-row-tools">
                  <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir el bloque ${i + 1}`}>↑</Button>
                  <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === st.bloques.length - 1} aria-label={`Bajar el bloque ${i + 1}`}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(i)} aria-label={`Quitar el bloque ${i + 1}`}>✕</Button>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <Button variant="secondary" size="sm" onClick={add} disabled={st.bloques.length >= 20}>+ Agregar bloque</Button>
          </div>

          <div className="gd-adjust">
            <label className="field-label" htmlFor="gd-pedido">Pedir un ajuste a la IA</label>
            <div className="gd-redo">
              <input id="gd-pedido" className="input" value={pedido} onChange={(e) => setPedido(e.target.value)}
                placeholder="Ej.: junta los dos últimos bloques · dale más tiempo a la evaluación del empaque"
                onKeyDown={(e) => { if (e.key === 'Enter' && pedido.trim() && !busy) guarded('ajustar'); }} />
              <Button variant="secondary" onClick={() => guarded('ajustar')} loading={busy === 'ajustar'} disabled={!pedido.trim() || busy !== null}>Ajustar</Button>
            </div>
            <button className="btn-link small" onClick={() => guarded('proponer')} disabled={busy !== null}>
              {busy === 'proponer' ? 'Proponiendo…' : 'Volver a proponer todos los bloques'}
            </button>
          </div>
        </>
      )}

      <div className="gd-foot">
        <Button variant="ghost" onClick={onBack}>← Tema</Button>
        <Button onClick={onNext} disabled={st.bloques.length === 0 || sinNombre}>Siguiente: la guía →</Button>
        {st.bloques.length > 0 && sinNombre && <span className="small muted">Ponle nombre a cada bloque.</span>}
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="¿Seguro?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button onClick={() => { confirm?.run(); setConfirm(null); }}>Sí, seguir</Button>
          </>
        }
      >
        <p>{confirm?.text}</p>
      </Modal>
    </section>
  );
}
