// Indicadores de Reclutamiento: cuenta, proyecto por proyecto, quién entró siendo «no elegible», quién llegó con varias participaciones
// previas y quién está duplicado en su tablero. Es la MISMA regla de los íconos de elegibilidad del tablero (getBoardDuplicateBadges),
// aplicada hacia atrás contra la fecha de inicio de cada proyecto, para no tener dos definiciones de «elegible» ni de «participó».
//
// Es una función pura sobre lo que ya carga getGlobalIdentityData (todas las filas de reclutamiento y sus identidades): no toca la base.
import type { GlobalIdentityData } from '../../lib/globalIdentityCache';
import { buildIdentityClusters, participoEnProyecto, resolveSignals, type IdentityRow, type Signal } from '../../lib/duplicateIdentity';
import type { DatosReclutamiento, ProyectoReclutamiento } from '../../lib/indicadores/reclutamiento';

const norm = (s?: string | null) => (s ?? '').toLowerCase().trim();
const SEPARADOR = '\u0000';
// IdentityRow trae un índice abierto y TypeScript no lo cuenta como «tener status y group»: el cast es solo de tipos.
const participo = (r: IdentityRow) => participoEnProyecto(r as { status?: string | null; group?: string | null });

export function calcularReclutamiento(
  datos: Pick<GlobalIdentityData, 'activeRows' | 'projectMap' | 'globalClusters' | 'rowToGlobalCluster'>,
): DatosReclutamiento {
  const { activeRows, projectMap, globalClusters, rowToGlobalCluster } = datos;
  const filaPorId = new Map<string, IdentityRow>(activeRows.map((r) => [r.id, r]));
  const fechaDe = (codigo: string): Date | null => {
    const f = projectMap.get(codigo)?.startDate;
    return f ? new Date(f) : null;
  };

  const porProyecto = new Map<string, ProyectoReclutamiento>();
  const proyecto = (codigo: string, fecha: Date): ProyectoReclutamiento => {
    let p = porProyecto.get(codigo);
    if (!p) {
      const info = projectMap.get(codigo);
      p = {
        codigo, cliente: info?.client || undefined, fecha: fecha.toISOString().slice(0, 10), inferida: !!info?.startDateInferred,
        participaron: 0, noElegibles: 0, porMismoCliente: 0, marcados: 0, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0,
      };
      porProyecto.set(codigo, p);
    }
    return p;
  };

  const vida = { personas: 0, enAlMenos: { 2: 0, 3: 0, 5: 0, 10: 0 } };
  let sinFecha = 0;

  for (const cluster of globalClusters.values()) {
    const filas = cluster.rowIds.map((id) => filaPorId.get(id)).filter((r): r is IdentityRow => !!r);
    const codigos = new Set(filas.map((r) => r.projectCode as string | undefined).filter((c): c is string => !!c));
    const participaciones = [...codigos]
      .filter((c) => filas.some((r) => r.projectCode === c && participo(r)))
      .map((codigo) => ({ codigo, fecha: fechaDe(codigo) }));

    if (participaciones.length > 0) {
      vida.personas++;
      for (const k of [2, 3, 5, 10] as const) if (participaciones.length >= k) vida.enAlMenos[k]++;
    }

    for (const codigo of codigos) {
      const ref = fechaDe(codigo);
      if (!ref) { sinFecha++; continue; }

      // Lo mismo que getBoardDuplicateBadges, contra la fecha de este proyecto y no contra hoy.
      const seisMeses = new Date(ref);
      seisMeses.setMonth(seisMeses.getMonth() - 6);
      const clienteDelProyecto = norm(projectMap.get(codigo)?.client);
      const senales = new Set<Signal>();
      for (const otra of filas) {
        const codigoOtra = otra.projectCode as string | undefined;
        if (!codigoOtra || codigoOtra === codigo) continue;
        const fechaOtra = fechaDe(codigoOtra);
        if (fechaOtra && fechaOtra > ref) continue;
        const participoOtra = participo(otra);
        const clienteOtra = projectMap.get(codigoOtra)?.client;
        const mismoCliente = !!clienteDelProyecto && !!clienteOtra && norm(clienteOtra) === clienteDelProyecto;
        const reciente = !fechaOtra || fechaOtra > seisMeses;
        if (participoOtra && mismoCliente) senales.add('same_client');
        else if (participoOtra && reciente) senales.add('recent');
        else if (participoOtra) senales.add('old');
        else senales.add('registered_only');
      }
      const { primaryBadge } = resolveSignals(senales);
      const noElegible = primaryBadge === 'same_client' || primaryBadge === 'recent';
      const entro = filas.some((r) => r.projectCode === codigo && participo(r));

      const p = proyecto(codigo, ref);
      if (noElegible) p.marcados++;
      if (!entro) continue;
      p.participaron++;
      if (noElegible) {
        p.noElegibles++;
        if (primaryBadge === 'same_client') p.porMismoCliente++;
      }
      const previas = participaciones.filter((x) => x.codigo !== codigo && x.fecha && x.fecha <= ref).length;
      for (const k of [2, 3, 4, 5] as const) if (previas >= k) p.previas[k]++;
    }
  }

  // Duplicados dentro de un mismo tablero: como en el ícono del tablero, se agrupan SOLO las filas de ese tablero (modo flexible).
  const tableros = new Map<string, IdentityRow[]>();
  for (const r of activeRows) {
    const codigo = r.projectCode as string | undefined;
    const tablero = r.boardName as string | undefined;
    if (!codigo || !tablero || !porProyecto.has(codigo)) continue;
    const clave = `${codigo}${SEPARADOR}${tablero}`;
    const lista = tableros.get(clave);
    if (lista) lista.push(r); else tableros.set(clave, [r]);
  }
  const duplicadas = new Map<string, Set<string>>();
  for (const [clave, filas] of tableros) {
    const codigo = clave.split(SEPARADOR)[0];
    for (const c of buildIdentityClusters(filas).values()) {
      if (c.rowIds.length < 2) continue;
      for (const id of c.rowIds) {
        const fila = filaPorId.get(id);
        const persona = rowToGlobalCluster.get(id);
        if (!fila || !persona || !participo(fila)) continue;
        const conjunto = duplicadas.get(codigo);
        if (conjunto) conjunto.add(persona); else duplicadas.set(codigo, new Set([persona]));
      }
    }
  }
  for (const [codigo, personas] of duplicadas) {
    const p = porProyecto.get(codigo);
    if (p) p.duplicados = personas.size;
  }

  return {
    proyectos: [...porProyecto.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.codigo.localeCompare(b.codigo)),
    vida,
    sinFecha,
  };
}
