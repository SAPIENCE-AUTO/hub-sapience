import { useCallback, useRef, useState } from 'react';
import { api, describeApiError } from '../../api';
import { TIPO_GUIA_LABEL, type BloqueGuia, type EstadoGuia, type Pregunta, type SeccionGuia } from '../../../shared/guias';
import { Button, ErrorBox, Modal } from '../ui';
import EditableText from './EditableText';

type Update = (fn: (s: EstadoGuia) => EstadoGuia) => void;
export type BlockStatus = Record<number, 'writing' | { error: string }>;

/**
 * La escritura con IA: de dos en dos bloques; cada uno aparece en cuanto está listo y, si
 * falla, se queda con «Reintentar» sin detener a los demás. Vive en la página del editor para
 * no perderse al cambiar de paso.
 */
export function useGuideWriter(guideId: string, getState: () => EstadoGuia | null, update: Update) {
  const [status, setStatus] = useState<BlockStatus>({});
  const running = useRef(0);
  const set = (i: number, v: BlockStatus[number] | null) =>
    setStatus((m) => { const n = { ...m }; if (v === null) delete n[i]; else n[i] = v; return n; });

  const writeOne = useCallback(async (i: number, previo?: BloqueGuia | null, comentario?: string) => {
    const st = getState();
    if (!st?.bloques[i]) return;
    set(i, 'writing');
    running.current++;
    try {
      const out = await api<BloqueGuia>(`/api/guias/${guideId}/escribir`, {
        method: 'POST', body: { state: st, indice: i, ...(previo ? { previo, comentario: comentario ?? '' } : {}) },
      });
      update((s) => ({ ...s, guia: s.bloques.map((_, j) => (j === i ? out : s.guia[j] ?? null)) }));
      set(i, null);
    } catch (e) {
      set(i, { error: describeApiError(e) });
    } finally {
      running.current--;
    }
  }, [guideId, getState, update]);

  const writeMany = useCallback(async (indices: number[]) => {
    const queue = [...indices];
    const worker = async () => { while (queue.length) await writeOne(queue.shift()!); };
    await Promise.all([worker(), worker()]);
  }, [writeOne]);

  const writing = Object.values(status).some((v) => v === 'writing');
  return { status, writing, writeOne, writeMany };
}

/** La guía en texto, para copiar y pegar. */
export function guiaTexto(title: string, st: EstadoGuia) {
  const lines = [title, `${TIPO_GUIA_LABEL[st.tipo]} · ${st.duracion} min.`, ''];
  if (st.tema.trim()) lines.push(`Tema: ${st.tema.trim()}`, '');
  st.bloques.forEach((b, i) => {
    lines.push(`${i + 1}. ${b.nombre} (${b.minutos} min.)`);
    const g = st.guia[i];
    if (!g) { lines.push('(por escribir)', ''); return; }
    if (g.moderador) lines.push(`Moderador: ${g.moderador}`);
    for (const s of g.secciones) {
      if (s.subtema) lines.push('', s.subtema);
      if (s.intro) lines.push(s.intro);
      for (const q of s.preguntas) {
        lines.push(`• ${typeof q === 'string' ? q : q.texto}`);
        if (typeof q !== 'string') for (const sb of q.sub) lines.push(`   – ${sb}`);
      }
      for (const n of s.notas) lines.push(`Nota: ${n}`);
    }
    lines.push('');
  });
  lines.push('Cierre y agradecimientos.');
  return lines.join('\n').replace(/\*\*/g, '');
}

/** Un bloque escrito, con cada texto corregible con un clic (vacío = se quita). */
function BlockBody({ g, onChange }: { g: BloqueGuia; onChange: (g: BloqueGuia) => void }) {
  const setSec = (si: number, fn: (s: SeccionGuia) => SeccionGuia) =>
    onChange({ ...g, secciones: g.secciones.map((s, j) => (j === si ? fn(s) : s)) });
  const setQ = (si: number, qi: number, q: Pregunta | null) =>
    setSec(si, (s) => ({ ...s, preguntas: q === null ? s.preguntas.filter((_, k) => k !== qi) : s.preguntas.map((x, k) => (k === qi ? q : x)) }));

  return (
    <div className="gd-block-body">
      <p className="gd-mod">
        <span className="gd-mod-label">Moderador:</span>
        <EditableText label="Frase del moderador" value={g.moderador} placeholder="Frase de transición del moderador" className="gd-italic"
          onChange={(v) => onChange({ ...g, moderador: v })} />
      </p>
      {g.secciones.map((s, si) => (
        <div key={si} className="gd-sec">
          <p className="gd-sub">
            <EditableText label="Subtema" value={s.subtema} placeholder="Subtema"
              onChange={(v) => (v || s.preguntas.length ? setSec(si, (x) => ({ ...x, subtema: v })) : onChange({ ...g, secciones: g.secciones.filter((_, j) => j !== si) }))} />
          </p>
          {(s.intro || '') !== '' && (
            <p className="gd-intro"><EditableText label="Indicación del subtema" value={s.intro ?? ''} className="gd-italic" onChange={(v) => setSec(si, (x) => ({ ...x, intro: v }))} /></p>
          )}
          <ul className="gd-qs">
            {s.preguntas.map((q, qi) => (
              <li key={qi}>
                <EditableText label="Pregunta" value={typeof q === 'string' ? q : q.texto} placeholder="Nueva pregunta"
                  onChange={(v) => setQ(si, qi, v ? (typeof q === 'string' ? v : { ...q, texto: v }) : null)} />
                {typeof q !== 'string' && q.sub.length > 0 && (
                  <ul className="gd-subs">
                    {q.sub.map((sb, k) => (
                      <li key={k}>
                        <EditableText label="Opción" value={sb}
                          onChange={(v) => setQ(si, qi, { ...q, sub: v ? q.sub.map((x, m) => (m === k ? v : x)) : q.sub.filter((_, m) => m !== k) })} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <button className="btn-link gd-add" onClick={() => setSec(si, (x) => ({ ...x, preguntas: [...x.preguntas, ''] }))}>+ pregunta</button>
          {s.notas.map((n, ni) => (
            <p key={ni} className="gd-note">
              <b>Nota: </b>
              <EditableText label="Nota al moderador" value={n}
                onChange={(v) => setSec(si, (x) => ({ ...x, notas: v ? x.notas.map((y, k) => (k === ni ? v : y)) : x.notas.filter((_, k) => k !== ni) }))} />
            </p>
          ))}
        </div>
      ))}
      <p className="small muted gd-tip">Haz clic en cualquier texto para corregirlo; si lo dejas vacío, se quita.</p>
    </div>
  );
}

/** Paso 3: la guía escrita, bloque por bloque. */
export default function StepGuia({ st, update, writer, onBack, onDownload, onCopy }: {
  st: EstadoGuia; update: Update; writer: ReturnType<typeof useGuideWriter>;
  onBack: () => void; onDownload: () => void; onCopy: () => void;
}) {
  const [redo, setRedo] = useState<{ i: number; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const pendientes = st.bloques.map((_, i) => i).filter((i) => !st.guia[i]);
  const written = st.bloques.length - pendientes.length;
  const { status, writing, writeOne, writeMany } = writer;

  return (
    <section className="panel stack gd-step-panel">
      <div className="row-between gd-guia-head">
        <div>
          <h2 className="gd-h">3 · La guía</h2>
          <p className="muted gd-p">{written} de {st.bloques.length} bloques escritos.</p>
        </div>
        <div className="gd-toolbar">
          {pendientes.length > 0 && (
            <Button onClick={() => void writeMany(pendientes)} disabled={writing}>
              {writing ? 'Escribiendo…' : written === 0 ? 'Escribir la guía' : `Escribir los ${pendientes.length} que faltan`}
            </Button>
          )}
          {written > 0 && <Button variant="ghost" size="sm" onClick={() => setConfirmAll(true)} disabled={writing}>Reescribir toda</Button>}
          <Button variant="secondary" size="sm" onClick={onCopy}>Copiar texto</Button>
          <Button variant="accent" size="sm" onClick={onDownload}>Descargar Word</Button>
        </div>
      </div>

      {st.bloques.map((b, i) => {
        const g = st.guia[i];
        const s = status[i];
        return (
          <article key={i} className="gd-block">
            <header className="gd-block-bar">
              <h3>{i + 1}. {b.nombre}<span className="min">({b.minutos} min.)</span></h3>
              {g && s !== 'writing' && (
                <button className="btn-link gd-bar-link" onClick={() => setRedo(redo?.i === i ? null : { i, text: '' })}>Rehacer</button>
              )}
            </header>
            {redo?.i === i && (
              <div className="gd-redo gd-redo-box">
                <input className="input" autoFocus value={redo.text} onChange={(e) => setRedo({ i, text: e.target.value })}
                  placeholder="¿Qué cambio quieres? Ej.: más preguntas sobre precio, menos sobre empaque"
                  onKeyDown={(e) => { if (e.key === 'Enter' && redo.text.trim()) { void writeOne(i, g, redo.text.trim()); setRedo(null); } }} />
                <Button size="sm" disabled={!redo.text.trim()} onClick={() => { void writeOne(i, g, redo.text.trim()); setRedo(null); }}>Rehacer bloque</Button>
              </div>
            )}
            {s === 'writing' ? (
              <p className="gd-writing gd-block-body"><span className="gd-spin" aria-hidden="true" /> Escribiendo este bloque…</p>
            ) : s && typeof s === 'object' ? (
              <div className="gd-block-body">
                <ErrorBox message={s.error} onRetry={() => void writeOne(i)} />
              </div>
            ) : g ? (
              <BlockBody g={g} onChange={(next) => update((x) => ({ ...x, guia: x.bloques.map((_, j) => (j === i ? next : x.guia[j] ?? null)) }))} />
            ) : (
              <div className="gd-block-body">
                <p className="muted small">Objetivos: {b.objetivos.filter((o) => o.trim()).join(' · ') || '—'}</p>
                <div><Button size="sm" variant="secondary" onClick={() => void writeOne(i)}>Escribir este bloque</Button></div>
              </div>
            )}
          </article>
        );
      })}

      <div className="gd-foot">
        <Button variant="ghost" onClick={onBack} disabled={writing}>← Bloques</Button>
      </div>

      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title="¿Reescribir toda la guía?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>Cancelar</Button>
            <Button onClick={() => { setConfirmAll(false); void writeMany(st.bloques.map((_, i) => i)); }}>Sí, reescribir</Button>
          </>
        }
      >
        <p>La IA vuelve a escribir todos los bloques y se pierden las correcciones que hayas hecho.</p>
      </Modal>
    </section>
  );
}
