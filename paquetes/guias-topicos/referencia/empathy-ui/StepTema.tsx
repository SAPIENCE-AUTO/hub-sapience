import type { SessionDTO } from '../../../shared/api';
import { DURACION_GUIA, TIPO_GUIA_LABEL, TIPOS_GUIA, tipoGuiaDe, type EstadoGuia, type TipoGuia } from '../../../shared/guias';
import { Button, Field, Segmented } from '../ui';

type Update = (fn: (s: EstadoGuia) => EstadoGuia) => void;

/** Paso 1: para qué sesiones es, el tema, la duración y (si hay) estímulos y notas. */
export default function StepTema({ st, sessions, update, onNext }: {
  st: EstadoGuia; sessions: SessionDTO[]; update: Update; onNext: () => void;
}) {
  // Al elegir sesiones: la muestra sale de sus frases y, si son del mismo formato, el tipo también.
  const toggle = (id: string) => update((s) => {
    const ids = s.sessionIds.includes(id) ? s.sessionIds.filter((x) => x !== id) : [...s.sessionIds, id];
    const chosen = sessions.filter((x) => ids.includes(x.id));
    const tipos = [...new Set(chosen.map((x) => tipoGuiaDe(x.activityType)))];
    const tipo = tipos.length === 1 ? tipos[0] : s.tipo;
    return { ...s, sessionIds: ids, ...withTipo(s, tipo), muestra: chosen.map((x) => x.sentence) };
  });
  // La duración sigue al formato mientras no se haya cambiado a mano.
  const withTipo = (s: EstadoGuia, tipo: TipoGuia) =>
    ({ tipo, duracion: tipo !== s.tipo && s.duracion === DURACION_GUIA[s.tipo] ? DURACION_GUIA[tipo] : s.duracion });

  const duracionOk = st.duracion >= 15 && st.duracion <= 480;

  return (
    <section className="panel stack gd-step-panel">
      <div>
        <h2 className="gd-h">1 · Tema y duración</h2>
        <p className="muted gd-p">Con esto la IA propone los bloques de la sesión y escribe las preguntas.</p>
      </div>

      <Field label="¿Para qué sesiones es esta guía?" hint="De aquí salen el tipo de sesión y la muestra (edades, perfil, consumo y ciudades).">
        <ul className="gd-sessions">
          {sessions.map((s, i) => {
            const on = st.sessionIds.includes(s.id);
            return (
              <li key={s.id}>
                <label className={`gd-session${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                  <span>
                    <span className="small gd-session-kind">Actividad {i + 1} · {s.activityTypeName}</span>
                    <span className="gd-session-text">{s.sentence}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </Field>

      <Field label="Tipo de sesión">
        <Segmented<TipoGuia>
          options={TIPOS_GUIA.map((t) => ({ id: t, label: TIPO_GUIA_LABEL[t] }))}
          value={st.tipo}
          onChange={(t) => update((s) => ({ ...s, ...withTipo(s, t) }))}
        />
      </Field>

      <Field label="Tema: ¿qué quieren entender?" hint="En tus palabras. Entre más concreto, mejores preguntas.">
        <textarea
          className="textarea"
          value={st.tema}
          onChange={(e) => update((s) => ({ ...s, tema: e.target.value }))}
          placeholder="Ej.: cómo viven el momento de jugar videojuegos, qué snacks los acompañan y cómo reaccionan al empaque nuevo de Oreo."
        />
      </Field>

      <Field label="Duración de la sesión" hint={duracionOk ? 'En minutos. Los bloques se reparten este tiempo.' : 'Escribe entre 15 y 480 minutos.'}>
        <div className="gd-dur">
          <input
            className="input"
            inputMode="numeric"
            aria-label="Duración en minutos"
            value={st.duracion || ''}
            onChange={(e) => update((s) => ({ ...s, duracion: Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10) }))}
          />
          <div className="chips">
            {[60, 90, 120].map((m) => (
              <button key={m} type="button" className={`chip${st.duracion === m ? ' on' : ''}`} onClick={() => update((s) => ({ ...s, duracion: m }))}>{m} min</button>
            ))}
          </div>
        </div>
      </Field>

      <Field label="Estímulos (opcional)" hint="Lo que se va a mostrar: empaques, conceptos, comerciales, precios…">
        <textarea className="textarea gd-ta-sm" value={st.estimulos} onChange={(e) => update((s) => ({ ...s, estimulos: e.target.value }))} />
      </Field>

      <Field label="Muestra" hint="Un perfil por renglón; va en la portada del Word.">
        <textarea
          className="textarea gd-ta-sm"
          value={st.muestra.join('\n')}
          onChange={(e) => update((s) => ({ ...s, muestra: e.target.value.split('\n').slice(0, 20) }))}
        />
      </Field>

      <Field label="Notas para la guía (opcional)" hint="Algo que deba cuidar o explorar: hipótesis, temas a evitar, marcas a vigilar…">
        <textarea className="textarea gd-ta-sm" value={st.notas} onChange={(e) => update((s) => ({ ...s, notas: e.target.value }))} />
      </Field>

      <div className="gd-foot">
        <Button onClick={onNext} disabled={!st.tema.trim() || !duracionOk}>Siguiente: bloques →</Button>
        {!st.tema.trim() && <span className="small muted">Escribe el tema para seguir.</span>}
      </div>
    </section>
  );
}
