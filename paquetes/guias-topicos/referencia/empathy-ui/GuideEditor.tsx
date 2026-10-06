import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, apiDownload, describeApiError } from '../api';
import type { SprintDetailResponse } from '../../shared/api';
import type { EstadoGuia, GuiaDTO } from '../../shared/guias';
import { useApp } from '../lib/app-context';
import { useApi } from '../lib/useApi';
import { Button, EmptyState, ErrorBox, Modal, Skeleton } from '../components/ui';
import StepTema from '../components/guias/StepTema';
import StepBloques from '../components/guias/StepBloques';
import StepGuia, { guiaTexto, useGuideWriter } from '../components/guias/StepGuia';
import './guias.css';

type Save = { state: 'saved' | 'pending' | 'saving' | 'error' | 'conflict'; msg?: string };

/**
 * Editor de una guía de tópicos: 1 tema y duración → 2 bloques → 3 la guía (y el Word).
 * Se guarda sola, con un pequeño retraso para no escribir en cada tecla; `version` evita que
 * dos personas se pisen.
 */
export default function GuideEditor() {
  const { id = '', guiaId = '' } = useParams();
  const { withOrg } = useApp();
  const sprint = useApi<SprintDetailResponse>(withOrg(`/api/sprints/${encodeURIComponent(id)}`));
  const [loadError, setLoadError] = useState<{ msg: string; status: number | null } | null>(null);
  const [title, setTitle] = useState('');
  const [st, setSt] = useState<EstadoGuia | null>(null);
  const [save, setSave] = useState<Save>({ state: 'saved' });
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDownload, setConfirmDownload] = useState(false);

  // La fuente de verdad para guardar y para la IA: lo último que se editó.
  const latest = useRef<{ title: string; st: EstadoGuia | null }>({ title: '', st: null });
  const version = useRef(0);
  const seq = useRef(0);
  const savedSeq = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    api<GuiaDTO>(`/api/guias/${encodeURIComponent(guiaId)}`)
      .then((g) => {
        if (!alive) return;
        latest.current = { title: g.title, st: g.state };
        version.current = g.version;
        setTitle(g.title);
        setSt(g.state);
      })
      .catch((e) => alive && setLoadError({ msg: describeApiError(e), status: e instanceof ApiError ? e.status : null }));
    return () => { alive = false; };
  }, [guiaId]);

  const persist = useCallback(() => {
    chain.current = chain.current.then(async () => {
      if (savedSeq.current === seq.current || !latest.current.st) return;
      const mine = seq.current;
      setSave({ state: 'saving' });
      try {
        const res = await api<{ version: number }>(`/api/guias/${guiaId}`, {
          method: 'PUT',
          body: { title: latest.current.title.trim() || 'Guía sin nombre', state: latest.current.st, version: version.current },
        });
        version.current = res.version;
        savedSeq.current = mine;
        setSave({ state: savedSeq.current === seq.current ? 'saved' : 'pending' });
      } catch (e) {
        const conflict = e instanceof ApiError && e.status === 409;
        if (conflict) savedSeq.current = seq.current;   // no se reintenta: hay que recargar
        setSave({ state: conflict ? 'conflict' : 'error', msg: describeApiError(e) });
      }
    });
    return chain.current;
  }, [guiaId]);

  const touched = useCallback(() => {
    seq.current++;
    setSave((s) => (s.state === 'conflict' ? s : { state: 'pending' }));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void persist(); }, 900);
  }, [persist]);

  const update = useCallback((fn: (s: EstadoGuia) => EstadoGuia) => {
    const cur = latest.current.st;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    latest.current = { ...latest.current, st: next };
    setSt(next);
    touched();
  }, [touched]);

  const flush = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    await persist();
  }, [persist]);

  // Avisa antes de salir si hay cambios sin guardar.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (savedSeq.current !== seq.current) { e.preventDefault(); } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);
  // Al salir del editor dentro de la app, guarda lo pendiente.
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); void persist(); } }, [persist]);

  const getState = useCallback(() => latest.current.st, []);
  const writer = useGuideWriter(guiaId, getState, update);

  async function download() {
    setConfirmDownload(false);
    setActionError(null);
    try {
      await flush();
      await apiDownload(`/api/guias/${guiaId}/word`, 'Guía de tópicos.docx');
    } catch (e) {
      setActionError(describeApiError(e));
    }
  }
  const askDownload = () => {
    const missing = st ? st.bloques.filter((_, i) => !st.guia[i]).length : 0;
    if (missing > 0) setConfirmDownload(true);
    else void download();
  };
  async function copy() {
    if (!st) return;
    try {
      await navigator.clipboard.writeText(guiaTexto(title, st));
      setNotice('Texto copiado.');
      window.setTimeout(() => setNotice(null), 3000);
    } catch {
      setActionError('No se pudo copiar. Descarga el Word y copia desde ahí.');
    }
  }

  if (loadError) {
    return (
      <div className="stack gd-editor">
        <Link to={`/sprints/${id}`} className="back-link">← Volver al sprint</Link>
        {loadError.status === 404 ? <EmptyState title="Guía no encontrada" text="Puede que la hayan borrado." /> : <ErrorBox message={loadError.msg} />}
      </div>
    );
  }
  if (!st || !sprint.data) {
    return (
      <div className="stack gd-editor">
        <Skeleton height={44} width="60%" />
        <Skeleton height={120} count={3} />
      </div>
    );
  }

  const sessions = [...sprint.data.sessions].sort((a, b) => a.position - b.position).filter((s) => s.status !== 'cancelada' && s.status !== 'caida');
  const steps: { n: 1 | 2 | 3; label: string; ok: boolean }[] = [
    { n: 1, label: 'Tema y duración', ok: true },
    { n: 2, label: 'Bloques', ok: st.tema.trim() !== '' },
    { n: 3, label: 'Guía', ok: st.bloques.length > 0 && st.bloques.every((b) => b.nombre.trim()) },
  ];
  const go = (paso: 1 | 2 | 3) => update((s) => ({ ...s, paso }));
  const saveText = { saved: 'Guardado', pending: 'Cambios sin guardar…', saving: 'Guardando…', error: 'No se pudo guardar', conflict: 'Otra persona la cambió' }[save.state];

  return (
    <div className="stack gd-editor">
      <Link to={`/sprints/${id}`} className="back-link">← {sprint.data.request.name}</Link>

      <section className="panel gd-head">
        <div className="gd-head-row">
          <input className="gd-title" aria-label="Nombre de la guía" value={title} maxLength={200}
            onChange={(e) => { setTitle(e.target.value); latest.current = { ...latest.current, title: e.target.value }; touched(); }} />
          <span className={`gd-save${save.state === 'error' || save.state === 'conflict' ? ' is-error' : ''}`} role="status">{saveText}</span>
        </div>
        <nav className="gd-steps" aria-label="Pasos">
          {steps.map((s) => (
            <button key={s.n} type="button" className={`gd-step${st.paso === s.n ? ' on' : ''}`} disabled={!s.ok || writer.writing}
              aria-current={st.paso === s.n ? 'step' : undefined} onClick={() => go(s.n)}>
              <span className="n">{s.n}</span>{s.label}
            </button>
          ))}
        </nav>
        {save.state === 'conflict' && (
          <div className="error row-between">
            <span>{save.msg}</span>
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>Recargar</Button>
          </div>
        )}
        {save.state === 'error' && (
          <div className="error row-between">
            <span>{save.msg}</span>
            <Button size="sm" variant="secondary" onClick={() => { seq.current++; void persist(); }}>Reintentar</Button>
          </div>
        )}
        {actionError && <ErrorBox message={actionError} />}
        {notice && <p className="success">{notice}</p>}
      </section>

      {st.paso === 1 && <StepTema st={st} sessions={sessions} update={update} onNext={() => go(2)} />}
      {st.paso === 2 && <StepBloques st={st} guideId={guiaId} update={update} onBack={() => go(1)} onNext={() => go(3)} />}
      {st.paso === 3 && <StepGuia st={st} update={update} writer={writer} onBack={() => go(2)} onDownload={askDownload} onCopy={() => void copy()} />}

      <Modal
        open={confirmDownload}
        onClose={() => setConfirmDownload(false)}
        title="Hay bloques sin escribir"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDownload(false)}>Cancelar</Button>
            <Button onClick={() => void download()}>Descargar así</Button>
          </>
        }
      >
        <p>Los bloques que faltan salen en el Word como «Bloque por escribir». Puedes escribirlos y volver a descargar.</p>
      </Modal>
    </div>
  );
}
