import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeApiError } from '../../api';
import { useApi } from '../../lib/useApi';
import { fmtDate } from '../../lib/format';
import { Button, ErrorBox, Modal } from '../ui';
import { TIPO_GUIA_LABEL, type GuiaDTO, type GuiaListItem, type GuiasResponse } from '../../../shared/guias';
import '../../pages/guias.css';

/**
 * «Guías de tópicos» en el detalle del sprint (desde que se envía la solicitud). Varias por
 * sprint; las arma el cliente o Sapience. Cada una se abre en su propio editor.
 */
export default function GuidesSection({ requestId }: { requestId: string }) {
  const { data, error, reload } = useApi<GuiasResponse>(`/api/sprints/${encodeURIComponent(requestId)}/guias`);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'create' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<GuiaListItem | null>(null);
  const items = data?.items ?? [];

  async function create() {
    setBusy('create');
    setActionError(null);
    try {
      const g = await api<GuiaDTO>(`/api/sprints/${requestId}/guias`, { method: 'POST', body: {} });
      navigate(`/sprints/${requestId}/guias/${g.id}`);
    } catch (e) {
      setActionError(describeApiError(e));
      setBusy(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    setBusy('delete');
    try {
      await api(`/api/guias/${toDelete.id}`, { method: 'DELETE' });
      setToDelete(null);
      await reload();
    } catch (e) {
      setActionError(describeApiError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel gd-section">
      <div className="gd-section-head">
        <h2>Guías de tópicos <span className="sp-count">{items.length}</span></h2>
        <Button onClick={() => void create()} loading={busy === 'create'}>+ Nueva guía</Button>
      </div>
      <p className="muted gd-section-hint">
        Arma la guía de tus sesiones: escribe el tema y la duración, define los bloques y la IA redacta las preguntas.
        Se descarga en Word, lista para el moderador.
      </p>
      {error && <ErrorBox message={error} onRetry={() => void reload()} />}
      {actionError && <ErrorBox message={actionError} />}
      {items.length > 0 && (
        <ul className="gd-list">
          {items.map((g) => (
            <li key={g.id} className="gd-item">
              <Link to={`/sprints/${requestId}/guias/${g.id}`} className="gd-item-main">
                <span className="gd-item-title">{g.title}</span>
                <span className="small muted">
                  {TIPO_GUIA_LABEL[g.tipo]} · {g.duracion} min
                  {g.bloques > 0 ? ` · ${g.escritos} de ${g.bloques} bloques escritos` : ' · sin bloques todavía'}
                </span>
                <span className="small muted">Creada por {g.createdByName} · editada el {fmtDate(g.updatedAt)}</span>
              </Link>
              {g.canDelete && (
                <button className="btn-link gd-item-del" onClick={() => { setActionError(null); setToDelete(g); }} aria-label={`Borrar ${g.title}`}>Borrar</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={toDelete !== null}
        onClose={() => { if (!busy) setToDelete(null); }}
        title="¿Borrar esta guía?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={busy === 'delete'}>No, dejarla</Button>
            <Button variant="danger" onClick={() => void remove()} loading={busy === 'delete'}>Sí, borrarla</Button>
          </>
        }
      >
        <p>Se borra «{toDelete?.title}» con sus bloques y lo que ya se escribió. No se puede deshacer.</p>
      </Modal>
    </section>
  );
}
