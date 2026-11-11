import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import {
  buildIdentityClusters, resolveSignals, DuplicateSignalEnum,
  Signal, IdentityRow, participoEnProyecto,
} from '../lib/duplicateIdentity';
import { getGlobalIdentityData } from '../lib/globalIdentityCache';
import { mapaDeTraidasReciente } from '../serverUtils/formularios/traidasMapa';
import { respuestaDe, respuestasEnTablero } from '../lib/respuestaFillout';
import { contarFiltrosLlenados, type ResumenFiltros } from '../lib/filtrosLlenados';

const normClient = (s?: string) => (s ?? '').toLowerCase().trim();

const RowBadgeSchema = z.object({
  signals:              z.array(DuplicateSignalEnum),
  primaryBadge:         DuplicateSignalEnum.nullable(),
  secondaryBadges:      z.array(DuplicateSignalEnum),
  sameBoardCount:       z.number(),
  hasHighRisk:          z.boolean(),
  hasInternalDuplicate: z.boolean(),
  // Los dos motivos de la alerta de elegibilidad, por separado (nov 2026): `signals` los junta en uno solo por prioridad (mismo cliente le gana a reciente),
  // pero una persona puede cumplir los dos y el tablero pinta un ícono por cada motivo.
  /** Ya participó en otro proyecto del mismo cliente, sin importar cuándo. */
  participatedSameClient:  z.boolean(),
  /** Participó en otro proyecto de cualquier cliente en los 6 meses anteriores (incluye a quien participó con el mismo cliente hace poco). */
  participatedLast6Months: z.boolean(),
  // Cuántos filtros ha llenado la persona (nov 2026; ver src/lib/filtrosLlenados.ts). Opcionales: un servidor viejo no los manda y la pantalla los tolera.
  /** Respuestas distintas de la persona en todos los tableros (la misma respuesta copiada a varios cuenta una). `null` si es un contacto compartido. */
  filtrosLlenados: z.number().nullable().optional(),
  /** Filas de la persona sin id de respuesta (a mano o de Excel): no cuentan como filtros llenados. */
  filasSinFiltro: z.number().optional(),
  compartido: z.boolean().optional(),
  /** Qué tan seguro es el número por lo que varían los datos de la persona (teléfono, correo, nombre). */
  confianza: z.enum(['segura', 'probable', 'revisar']).optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Batch compute duplicate/participation badges for all rows in a board — single source of truth for row icons',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName:   z.string(),
  }),
  outputSchema: z.object({
    badges: z.record(z.string(), RowBadgeSchema),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardName } = input;

    // Capas 2/3 ("¿ha llenado otros formularios?" / "¿es elegible?"): contra
    // todo el sistema, en modo strict — un solo dato reusado (teléfono
    // compartido, nombre placeholder) nunca debe fusionar identidades
    // distintas aquí; hace falta que coincidan 2 de 3 señales. Compartido con
    // searchParticipantHistory.ts (modal de historial) — ver globalIdentityCache.ts.
    const { activeRows, projectMap, globalClusters, rowToGlobalCluster } = await getGlobalIdentityData();
    // Una traída (persona traída de un filtro anterior) es la MISMA respuesta que su original: no es otro formulario ni otro filtro llenado (ver respuestaFillout.ts).
    const traidas = await mapaDeTraidasReciente();

    const currentProjData = projectMap.get(projectCode);
    // La fecha de respaldo de un proyecto sin fecha NO se usa como referencia del proyecto actual: se sigue midiendo contra hoy.
    const referenceDate   = currentProjData?.startDate && !currentProjData.startDateInferred ? new Date(currentProjData.startDate) : new Date();
    const sixMonthsAgo   = new Date(referenceDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const currentClientNorm = normClient(currentProjData?.client);

    // ── 2. Rows for the target board — siempre frescas, nunca cacheadas ──────
    const boardRows = activeRows.filter(
      r => r.projectCode === projectCode && r.boardName === boardName,
    );
    if (boardRows.length === 0) return { badges: {} };

    // ── 3. Capa 1 ("¿cuántas veces se llenó ESTE filtro?"): solo con las filas
    // de este tablero — población chica, cierre transitivo total (lenient) es
    // seguro y correcto ahí, y se recalcula siempre fresco (nunca cacheado).
    // Antes se usaba el cluster global para esto también, y por eso un dato
    // reusado en OTRO proyecto podía inflar el conteo "en este tablero" sin
    // que esas filas tuvieran nada que ver con el tablero actual (confirmado
    // en vivo: un participante con 1 sola fila real en su tablero mostraba
    // ×26, encadenado por 8 proyectos ajenos).
    const localClusters = buildIdentityClusters(boardRows);
    const rowToLocalCluster = new Map<string, string>();
    for (const [cid, cluster] of localClusters) {
      for (const rid of cluster.rowIds) rowToLocalCluster.set(rid, cid);
    }

    const rowById = new Map(activeRows.map(r => [r.id, r]));

    // ── 4. Compute signals (cachea por cluster local y global por separado) ─
    const localCountCache = new Map<string, number>();
    const filtrosCache = new Map<string, ResumenFiltros>();
    const globalSignalCache = new Map<string, { signals: Set<Signal>; sameClient: boolean; recent: boolean }>();

    const badges: Record<string, z.infer<typeof RowBadgeSchema>> = {};

    for (const boardRow of boardRows) {
      const localId = rowToLocalCluster.get(boardRow.id);
      let sameBoardCount = 1;
      if (localId) {
        sameBoardCount = localCountCache.get(localId) ?? localClusters.get(localId)!.rowIds.length;
        localCountCache.set(localId, sameBoardCount);
      }

      const globalId = rowToGlobalCluster.get(boardRow.id);
      let signalSet: Set<Signal>;
      let participatedSameClient = false;
      let participatedLast6Months = false;
      if (globalId && globalSignalCache.has(globalId)) {
        const hit = globalSignalCache.get(globalId)!;
        signalSet = new Set(hit.signals);
        participatedSameClient = hit.sameClient;
        participatedLast6Months = hit.recent;
      } else {
        signalSet = new Set<Signal>();
        if (globalId) {
          const cluster = globalClusters.get(globalId)!;
          const peerRows = cluster.rowIds
            .map(id => rowById.get(id))
            .filter((r): r is IdentityRow => !!r);

          // Las respuestas de Fillout que esta persona ya tiene en ESTE tablero: si el mismo formulario está vinculado a varios tableros, su
          // respuesta se copia a cada uno, y esas copias no son «otros formularios» (ver respuestaFillout.ts).
          const respuestasAqui = respuestasEnTablero(peerRows, projectCode, boardName, traidas);

          for (const peer of peerRows) {
            if (!peer.projectCode) continue;

            const isSameBoard = peer.projectCode === projectCode && peer.boardName === boardName;
            if (isSameBoard) continue;

            const isSameProject = peer.projectCode === projectCode;
            if (isSameProject) continue;

            const peerProjData  = projectMap.get(peer.projectCode);
            const peerStartDate = peerProjData?.startDate ? new Date(peerProjData.startDate) : null;
            if (peerStartDate && peerStartDate > referenceDate) continue;

            const rawParticipated = participoEnProyecto(peer);
            // Copia de la misma respuesta en otro proyecto, sin haber participado ahí: no es haber llenado otro filtro, no suma señal.
            // Si participó con esa copia, sí es historial real y sigue contando como siempre.
            const respuestaPeer = respuestaDe(peer, traidas);
            if (!rawParticipated && respuestaPeer && respuestasAqui.has(respuestaPeer)) continue;
            const isSameClient = !!currentClientNorm && !!peerProjData?.client && normClient(peerProjData.client) === currentClientNorm;
            const isRecent = !peerStartDate || peerStartDate > sixMonthsAgo;

            if (rawParticipated && isSameClient) participatedSameClient = true;
            if (rawParticipated && isRecent) participatedLast6Months = true;

            if (rawParticipated && isSameClient) {
              signalSet.add('same_client');
            } else if (rawParticipated && isRecent) {
              signalSet.add('recent');
            } else if (rawParticipated && !isRecent) {
              signalSet.add('old');
            } else if (!rawParticipated) {
              signalSet.add('registered_only');
            }
          }
          globalSignalCache.set(globalId, { signals: new Set(signalSet), sameClient: participatedSameClient, recent: participatedLast6Months });
        }
      }

      if (sameBoardCount > 1) signalSet.add('same_board_duplicate');

      // Cuántos filtros ha llenado: sobre todas las filas de la persona (grupo global, estricto), una vez por persona.
      let filtros = globalId ? filtrosCache.get(globalId) : undefined;
      if (!filtros) {
        const filasDeLaPersona = globalId
          ? globalClusters.get(globalId)!.rowIds.map(id => rowById.get(id)).filter((r): r is IdentityRow => !!r)
          : [boardRow];
        filtros = contarFiltrosLlenados(filasDeLaPersona, traidas);
        if (globalId) filtrosCache.set(globalId, filtros);
      }

      const { signals, primaryBadge, secondaryBadges } = resolveSignals(signalSet);
      badges[boardRow.id] = {
        signals, primaryBadge, secondaryBadges,
        sameBoardCount,
        hasHighRisk:          primaryBadge === 'same_client' || primaryBadge === 'recent',
        hasInternalDuplicate: sameBoardCount > 1,
        participatedSameClient,
        participatedLast6Months,
        filtrosLlenados: filtros.filtrosLlenados,
        filasSinFiltro:  filtros.filasSinFiltro,
        compartido:      filtros.compartido,
        confianza:       filtros.confianza,
      };
    }

    return { badges };
  },
});
