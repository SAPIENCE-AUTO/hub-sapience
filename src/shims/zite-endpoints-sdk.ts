// Reemplazo de 'zite-endpoints-sdk'.
// Zite generaba un cliente tipado con una función por endpoint. Esto lo replica:
// cada función hace POST a /api/<nombre> y devuelve el JSON.
//
// Los tipos *OutputType se declaran como `any` por ahora. Cuando el servidor
// esté en pie, conviene generarlos de los outputSchema zod de cada endpoint
// para recuperar el tipado real que tenías en Zite.

import { supabase } from '@/lib/supabaseClient';

export const BASE = import.meta.env.VITE_API_URL ?? '/api';

/** Preserva el `code` del servidor (p.ej. NOT_PROVISIONED) para que la UI lo distinga de un error genérico. */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function call<T = any>(name: string, input?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;

  const res = await fetch(`${BASE}/${name}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(input ?? {}),
  });
  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch { /* respuesta no JSON */ }
    throw new ApiError(body?.message ?? `${name} falló (${res.status})`, res.status, body?.code);
  }
  return res.json() as Promise<T>;
}

/**
 * Para endpoints con `streaming: true` en el compat layer (ver
 * server/compat/endpoint.ts + server/index.ts, que los transmite por SSE).
 * Devuelve un objeto que es AMBAS cosas a la vez:
 *   - thenable: `await checkNewSubmissions(...)` funciona igual que `call()`,
 *     resuelve al resultado final — no rompe a quien no necesita progreso.
 *   - async-iterable: `for await (const chunk of checkNewSubmissions(...))`
 *     entrega cada chunk de progreso conforme llega.
 * El fetch arranca de inmediato (no espera a que alguien itere), así que
 * `await` por sí solo también dispara la llamada real y resuelve al final.
 */
function callStreaming<T = any>(name: string, input?: unknown): Promise<T> & AsyncIterable<any> {
  let resolveResult!: (v: T) => void;
  let rejectResult!: (e: unknown) => void;
  const result = new Promise<T>((res, rej) => { resolveResult = res; rejectResult = rej; });

  const queue: any[] = [];
  const waiters: Array<(r: IteratorResult<any>) => void> = [];
  let done = false;

  const pushChunk = (chunk: any) => {
    const waiter = waiters.shift();
    if (waiter) waiter({ value: chunk, done: false });
    else queue.push(chunk);
  };
  const finish = () => {
    done = true;
    while (waiters.length) waiters.shift()!({ value: undefined, done: true });
  };

  (async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;

      const res = await fetch(`${BASE}/${name}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(input ?? {}),
      });
      if (!res.ok || !res.body) {
        let body: any = {};
        try { body = await res.json(); } catch { /* respuesta no JSON */ }
        throw new ApiError(body?.message ?? `${name} falló (${res.status})`, res.status, body?.code);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const raw = dataLine.slice(5).trim();
          if (!raw) continue;
          let parsed: any;
          try { parsed = JSON.parse(raw); } catch { continue; }
          if (parsed.type === 'progress') pushChunk(parsed);
          else if (parsed.type === 'done') resolveResult(parsed.result);
          else if (parsed.type === 'error') throw new ApiError(parsed.message ?? `${name} falló`, 500, parsed.code);
        }
      }
    } catch (err) {
      rejectResult(err);
    } finally {
      finish();
    }
  })();

  const iterator: AsyncIterator<any> = {
    next: () => {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (done) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => waiters.push(resolve));
    },
  };

  return {
    [Symbol.asyncIterator]: () => iterator,
    then: (onFulfilled?: any, onRejected?: any) => result.then(onFulfilled, onRejected),
    catch: (onRejected?: any) => result.catch(onRejected),
    finally: (onFinally?: any) => result.finally(onFinally),
  } as Promise<T> & AsyncIterable<any>;
}

export const getMe = (input?: any): Promise<any> => call('getMe', input);

export const addExpenseComment = (input?: any): Promise<any> => call('addExpenseComment', input);
export const analizarPreworkEstudio = (input?: any): Promise<any> => call('analizarPreworkEstudio', input);
export const analizarPreworkRespuesta = (input?: any): Promise<any> => call('analizarPreworkRespuesta', input);
export const analyzeRecruitmentStatus = (input?: any): Promise<any> => call('analyzeRecruitmentStatus', input);
export const approveDeal = (input?: any): Promise<any> => call('approveDeal', input);
export const approveExpense = (input?: any): Promise<any> => call('approveExpense', input);
export const approvePurchaseOrder = (input?: any): Promise<any> => call('approvePurchaseOrder', input);
export const approveSelectedCotizaciones = (input?: any): Promise<any> => call('approveSelectedCotizaciones', input);
export const backfillExchangeRates = (input?: any): Promise<any> => call('backfillExchangeRates', input);
export const bulkDeletePayments = (input?: any): Promise<any> => call('bulkDeletePayments', input);
export const bulkUpdatePayments = (input?: any): Promise<any> => call('bulkUpdatePayments', input);
export const cancelPurchaseOrder = (input?: any): Promise<any> => call('cancelPurchaseOrder', input);
export const chatDealsAnalysis = (input?: any): Promise<any> => call('chatDealsAnalysis', input);
export const checkImageWeb = (input?: any): Promise<any> => call('checkImageWeb', input);
export const checkNewSubmissions = (input?: any): Promise<any> & AsyncIterable<any> => callStreaming('checkNewSubmissions', input);
export const cleanupDuplicateCellValues = (input?: any): Promise<any> => call('cleanupDuplicateCellValues', input);
export const cleanupPJT001 = (input?: any): Promise<any> => call('cleanupPJT001', input);
export const countFilloutSubmissions = (input?: any): Promise<any> => call('countFilloutSubmissions', input);
export const createBoardWithTemplate = (input?: any): Promise<any> => call('createBoardWithTemplate', input);
export const createEjesIdea = (input?: any): Promise<any> => call('createEjesIdea', input);
export const createEjesIdeasBulk = (input?: any): Promise<any> => call('createEjesIdeasBulk', input);
export const createEjesSesion = (input?: any): Promise<any> => call('createEjesSesion', input);
export const createEjesTablero = (input?: any): Promise<any> => call('createEjesTablero', input);
export const createObservationStream = (input?: any): Promise<any> => call('createObservationStream', input);
export const createPreworkEstudio = (input?: any): Promise<any> => call('createPreworkEstudio', input);
export const createPreworkMision = (input?: any): Promise<any> => call('createPreworkMision', input);
export const createPreworkSeguimiento = (input?: any): Promise<any> => call('createPreworkSeguimiento', input);
export const createSharedView = (input?: any): Promise<any> => call('createSharedView', input);
export const createSwipeCapitulo = (input?: any): Promise<any> => call('createSwipeCapitulo', input);
export const createSwipeIdea = (input?: any): Promise<any> => call('createSwipeIdea', input);
export const createSwipeIdeasBulk = (input?: any): Promise<any> => call('createSwipeIdeasBulk', input);
export const createSwipeSesion = (input?: any): Promise<any> => call('createSwipeSesion', input);
export const createTeamsChannel = (input?: any): Promise<any> => call('createTeamsChannel', input);
export const deleteBoard = (input?: any): Promise<any> => call('deleteBoard', input);
export const deleteBoardColumn = (input?: any): Promise<any> => call('deleteBoardColumn', input);
export const deleteCRMItem = (input?: any): Promise<any> => call('deleteCRMItem', input);
export const deleteCalendarEvent = (input?: any): Promise<any> => call('deleteCalendarEvent', input);
export const deleteChatConversation = (input?: any): Promise<any> => call('deleteChatConversation', input);
export const deleteCommercialView = (input?: any): Promise<any> => call('deleteCommercialView', input);
export const deleteCotizacion = (input?: any): Promise<any> => call('deleteCotizacion', input);
export const deleteDeal = (input?: any): Promise<any> => call('deleteDeal', input);
export const deleteDealDocument = (input?: any): Promise<any> => call('deleteDealDocument', input);
export const deleteDocBlock = (input?: any): Promise<any> => call('deleteDocBlock', input);
export const deleteEjesSesion = (input?: any): Promise<any> => call('deleteEjesSesion', input);
export const deleteExpense = (input?: any): Promise<any> => call('deleteExpense', input);
export const deleteInternalView = (input?: any): Promise<any> => call('deleteInternalView', input);
export const deleteObservationChatMessage = (input?: any): Promise<any> => call('deleteObservationChatMessage', input);
export const deleteMisPendiente = (input?: any): Promise<any> => call('deleteMisPendiente', input);
export const deleteParticipant = (input?: any): Promise<any> => call('deleteParticipant', input);
export const deletePayment = (input?: any): Promise<any> => call('deletePayment', input);
export const deletePoAttachment = (input?: any): Promise<any> => call('deletePoAttachment', input);
export const deleteProject = (input?: any): Promise<any> => call('deleteProject', input);
export const deletePurchaseOrder = (input?: any): Promise<any> => call('deletePurchaseOrder', input);
export const deleteRecruitmentRow = (input?: any): Promise<any> => call('deleteRecruitmentRow', input);
export const deleteSharedView = (input?: any): Promise<any> => call('deleteSharedView', input);
export const deleteSwipeCapitulo = (input?: any): Promise<any> => call('deleteSwipeCapitulo', input);
export const deleteSwipeIdea = (input?: any): Promise<any> => call('deleteSwipeIdea', input);
export const deleteSwipeSesion = (input?: any): Promise<any> => call('deleteSwipeSesion', input);
export const deleteTask = (input?: any): Promise<any> => call('deleteTask', input);
export const deleteUser = (input?: any): Promise<any> => call('deleteUser', input);
export const detectDuplicateSuppliers = (input?: any): Promise<any> => call('detectDuplicateSuppliers', input);
export const duplicateBoard = (input?: any): Promise<any> => call('duplicateBoard', input);
export const duplicateCotizacion = (input?: any): Promise<any> => call('duplicateCotizacion', input);
export const duplicateGroup = (input?: any): Promise<any> => call('duplicateGroup', input);
export const duplicateSwipeCapitulo = (input?: any): Promise<any> => call('duplicateSwipeCapitulo', input);
export const duplicateSwipeIdea = (input?: any): Promise<any> => call('duplicateSwipeIdea', input);
export const duplicateRows = (input?: any): Promise<any> => call('duplicateRows', input);
export const ensurePendienteNotasBlock = (input?: any): Promise<any> => call('ensurePendienteNotasBlock', input);
export const executeButtonAction = (input?: any): Promise<any> => call('executeButtonAction', input);
export const exportConfigBackup = (input?: any): Promise<any> => call('exportConfigBackup', input);
export const exportObservationAttendance = (input?: any): Promise<any> => call('exportObservationAttendance', input);
export const filloutNativeWebhook = (input?: any): Promise<any> => call('filloutNativeWebhook', input);
export const filloutWebhook = (input?: any): Promise<any> => call('filloutWebhook', input);
export const fixCellData = (input?: any): Promise<any> => call('fixCellData', input);
export const fixOrphanedCellValues = (input?: any): Promise<any> => call('fixOrphanedCellValues', input);
export const generatePoPdf = (input?: any): Promise<any> => call('generatePoPdf', input);
export const generateSupplierToken = (input?: any): Promise<any> => call('generateSupplierToken', input);
export const getAblyToken = (input?: any): Promise<any> => call('getAblyToken', input);
export const getAdminData = (input?: any): Promise<any> => call('getAdminData', input);
export const getAllCalendarEvents = (input?: any): Promise<any> => call('getAllCalendarEvents', input);
export const getAppSettings = (input?: any): Promise<any> => call('getAppSettings', input);
export const getApprovalLimits = (input?: any): Promise<any> => call('getApprovalLimits', input);
export const getApprovalPreview = (input?: any): Promise<any> => call('getApprovalPreview', input);
export const getBoardColumns = (input?: any): Promise<any> => call('getBoardColumns', input);
export const getBoardDuplicateBadges = (input?: any): Promise<any> => call('getBoardDuplicateBadges', input);
export const getBoardGroups = (input?: any): Promise<any> => call('getBoardGroups', input);
export const getCRMItems = (input?: any): Promise<any> => call('getCRMItems', input);
export const getCalendarBoardStatus = (input?: any): Promise<any> => call('getCalendarBoardStatus', input);
export const getCalendarEventById = (input?: any): Promise<any> => call('getCalendarEventById', input);
export const getCalendarExcelColumns = (input?: any): Promise<any> => call('getCalendarExcelColumns', input);
export const getCalendarExcelPreview = (input?: any): Promise<any> => call('getCalendarExcelPreview', input);
export const getCellValues = (input?: any): Promise<any> => call('getCellValues', input);
export const getChatConversations = (input?: any): Promise<any> => call('getChatConversations', input);
export const getCommercialViews = (input?: any): Promise<any> => call('getCommercialViews', input);
export const getCotizacionLineItems = (input?: any): Promise<any> => call('getCotizacionLineItems', input);
export const getCotizaciones = (input?: any): Promise<any> => call('getCotizaciones', input);
export const getCotizacionesAdmin = (input?: any): Promise<any> => call('getCotizacionesAdmin', input);
export const getDashboardData = (input?: any): Promise<any> => call('getDashboardData', input);
export const getDealDocuments = (input?: any): Promise<any> => call('getDealDocuments', input);
export const getDeals = (input?: any): Promise<any> => call('getDeals', input);
export const getDocBlock = (input?: any): Promise<any> => call('getDocBlock', input);
export const getDocBlocks = (input?: any): Promise<any> => call('getDocBlocks', input);
export const getEjesEstado = (input?: any): Promise<any> => call('getEjesEstado', input);
export const getEjesEvaluacionesDeIdea = (input?: any): Promise<any> => call('getEjesEvaluacionesDeIdea', input);
export const getEjesIdeas = (input?: any): Promise<any> => call('getEjesIdeas', input);
export const getEjesResultadosSesion = (input?: any): Promise<any> => call('getEjesResultadosSesion', input);
export const getEjesResultadosTablero = (input?: any): Promise<any> => call('getEjesResultadosTablero', input);
export const getEjesSesionDetail = (input?: any): Promise<any> => call('getEjesSesionDetail', input);
export const getEjesSesiones = (input?: any): Promise<any> => call('getEjesSesiones', input);
export const getExpenseAuditLog = (input?: any): Promise<any> => call('getExpenseAuditLog', input);
export const getExpenseComments = (input?: any): Promise<any> => call('getExpenseComments', input);
export const getExpenseLineItems = (input?: any): Promise<any> => call('getExpenseLineItems', input);
export const getExpenses = (input?: any): Promise<any> => call('getExpenses', input);
export const getFilloutForms = (input?: any): Promise<any> => call('getFilloutForms', input);
export const getInternalViews = (input?: any): Promise<any> => call('getInternalViews', input);
export const getInviteTemplate = (input?: any): Promise<any> => call('getInviteTemplate', input);
export const getInvoiceWidgetData = (input?: any): Promise<any> => call('getInvoiceWidgetData', input);
export const getLastAnalysis = (input?: any): Promise<any> => call('getLastAnalysis', input);
export const getLinkedEventsInfo = (input?: any): Promise<any> => call('getLinkedEventsInfo', input);
export const getLinkedParticipants = (input?: any): Promise<any> => call('getLinkedParticipants', input);
export const getMessages = (input?: any): Promise<any> => call('getMessages', input);
export const getMisPendientes = (input?: any): Promise<any> => call('getMisPendientes', input);
export const searchMessages = (input?: any): Promise<any> => call('searchMessages', input);
export const getMigrationLogs = (input?: any): Promise<any> => call('getMigrationLogs', input);
export const getMultiProjectCostAnalysis = (input?: any): Promise<any> => call('getMultiProjectCostAnalysis', input);
export const getObservationChatMessages = (input?: any): Promise<any> => call('getObservationChatMessages', input);
export const getObservationChatToken = (input?: any): Promise<any> => call('getObservationChatToken', input);
export const getObservationRoomPublic = (input?: any): Promise<any> => call('getObservationRoomPublic', input);
export const getObservationSessionDetail = (input?: any): Promise<any> => call('getObservationSessionDetail', input);
export const getParticipants = (input?: any): Promise<any> => call('getParticipants', input);
export const getPayments = (input?: any): Promise<any> => call('getPayments', input);
export const getPendienteCorreoBody = (input?: any): Promise<any> => call('getPendienteCorreoBody', input);
export const getPettyCashFunds = (input?: any): Promise<any> => call('getPettyCashFunds', input);
export const getPoAttachments = (input?: any): Promise<any> => call('getPoAttachments', input);
export const getPoAuditLog = (input?: any): Promise<any> => call('getPoAuditLog', input);
export const getPoLineItems = (input?: any): Promise<any> => call('getPoLineItems', input);
export const getPoNotifications = (input?: any): Promise<any> => call('getPoNotifications', input);
export const getPoPdfBase64 = (input?: any): Promise<any> => call('getPoPdfBase64', input);
export const getPresence = (input?: any): Promise<any> => call('getPresence', input);
export const getPreworkEstudios = (input?: any): Promise<any> => call('getPreworkEstudios', input);
export const getPreworkMisiones = (input?: any): Promise<any> => call('getPreworkMisiones', input);
export const getPreworkParticipacionStatus = (input?: any): Promise<any> => call('getPreworkParticipacionStatus', input);
export const getPreworkParticipantesCandidatos = (input?: any): Promise<any> => call('getPreworkParticipantesCandidatos', input);
export const getPreworkPerfilesEstudio = (input?: any): Promise<any> => call('getPreworkPerfilesEstudio', input);
export const getPreworkRespuestas = (input?: any): Promise<any> => call('getPreworkRespuestas', input);
export const getPreworkSeguimientos = (input?: any): Promise<any> => call('getPreworkSeguimientos', input);
export const getPreworkTags = (input?: any): Promise<any> => call('getPreworkTags', input);
export const getProjectBudget = (input?: any): Promise<any> => call('getProjectBudget', input);
export const getProjectCostAnalysis = (input?: any): Promise<any> => call('getProjectCostAnalysis', input);
export const getProjectDocuments = (input?: any): Promise<any> => call('getProjectDocuments', input);
export const getProjectForDeal = (input?: any): Promise<any> => call('getProjectForDeal', input);
export const getProjectTeamsFileLink = (input?: any): Promise<any> => call('getProjectTeamsFileLink', input);
export const getProjectTeamsFiles = (input?: any): Promise<any> => call('getProjectTeamsFiles', input);
export const getProjects = (input?: any): Promise<any> => call('getProjects', input);
export const getPurchaseOrders = (input?: any): Promise<any> => call('getPurchaseOrders', input);
export const getRecruitmentDashboard = (input?: any): Promise<any> => call('getRecruitmentDashboard', input);
export const getRecruitmentGroups = (input?: any): Promise<any> => call('getRecruitmentGroups', input);
export const getRecruitmentRows = (input?: any): Promise<any> => call('getRecruitmentRows', input);
export const getRecruitmentSummary = (input?: any): Promise<any> => call('getRecruitmentSummary', input);
export const getReferenceOptions = (input?: any): Promise<any> => call('getReferenceOptions', input);
export const getRubroAssignments = (input?: any): Promise<any> => call('getRubroAssignments', input);
export const getSharedViewData = (input?: any): Promise<any> => call('getSharedViewData', input);
export const getSharedViews = (input?: any): Promise<any> => call('getSharedViews', input);
export const getStreetViewUrl = (input?: any): Promise<any> => call('getStreetViewUrl', input);
export const getSupplierInvoiceById = (input?: any): Promise<any> => call('getSupplierInvoiceById', input);
export const getSupplierInvoices = (input?: any): Promise<any> => call('getSupplierInvoices', input);
export const getSupplierPortalData = (input?: any): Promise<any> => call('getSupplierPortalData', input);
export const getSwipeCapitulo = (input?: any): Promise<any> => call('getSwipeCapitulo', input);
export const getSwipeEstado = (input?: any): Promise<any> => call('getSwipeEstado', input);
export const getSwipeIdeas = (input?: any): Promise<any> => call('getSwipeIdeas', input);
export const getSwipeResultados = (input?: any): Promise<any> => call('getSwipeResultados', input);
export const getSwipeResultadosSesion = (input?: any): Promise<any> => call('getSwipeResultadosSesion', input);
export const getSwipeSesionDetail = (input?: any): Promise<any> => call('getSwipeSesionDetail', input);
export const getSwipeSesiones = (input?: any): Promise<any> => call('getSwipeSesiones', input);
export const getSwipeVotosDeIdea = (input?: any): Promise<any> => call('getSwipeVotosDeIdea', input);
export const getTaskById = (input?: any): Promise<any> => call('getTaskById', input);
export const getTaskComments = (input?: any): Promise<any> => call('getTaskComments', input);
export const getTasks = (input?: any): Promise<any> => call('getTasks', input);
export const getTasksForGantt = (input?: any): Promise<any> => call('getTasksForGantt', input);
export const getTeamMembers = (input?: any): Promise<any> => call('getTeamMembers', input);
export const getTimelineBoardStatus = (input?: any): Promise<any> => call('getTimelineBoardStatus', input);
export const getTrashItems = (input?: any): Promise<any> => call('getTrashItems', input);
export const getUnreadCounts = (input?: any): Promise<any> => call('getUnreadCounts', input);
export const getUsers = (input?: any): Promise<any> => call('getUsers', input);
export const importCotizacionesFromCsv = (input?: any): Promise<any> => call('importCotizacionesFromCsv', input);
export const importDeals = (input?: any): Promise<any> => call('importDeals', input);
export const importExcelData = (input?: any): Promise<any> => call('importExcelData', input);
export const importOdcFromCsv = (input?: any): Promise<any> => call('importOdcFromCsv', input);
export const importSuppliers = (input?: any): Promise<any> => call('importSuppliers', input);
export const inviteUsers = (input?: any): Promise<any> => call('inviteUsers', input);
export const leaveChatConversation = (input?: any): Promise<any> => call('leaveChatConversation', input);
export const joinEjesSesion = (input?: any): Promise<any> => call('joinEjesSesion', input);
export const joinSwipeSesion = (input?: any): Promise<any> => call('joinSwipeSesion', input);
export const linkFilloutForm = (input?: any): Promise<any> => call('linkFilloutForm', input);
export const linkGroupToEvent = (input?: any): Promise<any> => call('linkGroupToEvent', input);
export const linkProjectDeal = (input?: any): Promise<any> => call('linkProjectDeal', input);
export const listTeamsChannels = (input?: any): Promise<any> => call('listTeamsChannels', input);
export const markNDASent = (input?: any): Promise<any> => call('markNDASent', input);
export const mergeSupplierRecords = (input?: any): Promise<any> => call('mergeSupplierRecords', input);
export const migrateAgeColumns = (input?: any): Promise<any> => call('migrateAgeColumns', input);
export const migrateCellValuesToUUID = (input?: any): Promise<any> => call('migrateCellValuesToUUID', input);
export const migrateProjectToUUID = (input?: any): Promise<any> => call('migrateProjectToUUID', input);
export const moveEjesIdea = (input?: any): Promise<any> => call('moveEjesIdea', input);
export const moveSwipeIdea = (input?: any): Promise<any> => call('moveSwipeIdea', input);
export const normalizeSupplierNames = (input?: any): Promise<any> => call('normalizeSupplierNames', input);
export const parseExcelFile = (input?: any): Promise<any> => call('parseExcelFile', input);
export const parseOdcCsv = (input?: any): Promise<any> => call('parseOdcCsv', input);
export const permanentlyDelete = (input?: any): Promise<any> => call('permanentlyDelete', input);
export const postObserverChatMessage = (input?: any): Promise<any> => call('postObserverChatMessage', input);
export const postObserverHeartbeat = (input?: any): Promise<any> => call('postObserverHeartbeat', input);
export const postProducerChatMessage = (input?: any): Promise<any> => call('postProducerChatMessage', input);
export const preparePoEmail = (input?: any): Promise<any> => call('preparePoEmail', input);
export const previewInviteTemplate = (input?: any): Promise<any> => call('previewInviteTemplate', input);
export const preworkGetAblyToken = (input?: any): Promise<any> => call('preworkGetAblyToken', input);
export const preworkGetFeedSocial = (input?: any): Promise<any> => call('preworkGetFeedSocial', input);
export const preworkGetMisiones = (input?: any): Promise<any> => call('preworkGetMisiones', input);
export const preworkInvitarParticipantes = (input?: any): Promise<any> => call('preworkInvitarParticipantes', input);
export const preworkLogin = (input?: any): Promise<any> => call('preworkLogin', input);
export const preworkReaccionarRespuesta = (input?: any): Promise<any> => call('preworkReaccionarRespuesta', input);
export const preworkSubmitRespuesta = (input?: any): Promise<any> => call('preworkSubmitRespuesta', input);
export const publishDocEvent = (input?: any): Promise<any> => call('publishDocEvent', input);
export const publishPresenceEvent = (input?: any): Promise<any> => call('publishPresenceEvent', input);
export const publishRecruitmentGroupsChanged = (input?: any): Promise<any> => call('publishRecruitmentGroupsChanged', input);
export const publishRecruitmentRowsChanged = (input?: any): Promise<any> => call('publishRecruitmentRowsChanged', input);
export const publishTyping = (input?: any): Promise<any> => call('publishTyping', input);
export const purgeDeletedRows = (input?: any): Promise<any> => call('purgeDeletedRows', input);
export const recalculateDuplicateNotes = (input?: any): Promise<any> => call('recalculateDuplicateNotes', input);
export const registerObserver = (input?: any): Promise<any> => call('registerObserver', input);
export const rejectExpense = (input?: any): Promise<any> => call('rejectExpense', input);
export const rejectPurchaseOrder = (input?: any): Promise<any> => call('rejectPurchaseOrder', input);
export const renameBoard = (input?: any): Promise<any> => call('renameBoard', input);
export const renameChatConversation = (input?: any): Promise<any> => call('renameChatConversation', input);
export const reorderInternalViews = (input?: any): Promise<any> => call('reorderInternalViews', input);
export const reorderRecruitmentRows = (input?: any): Promise<any> => call('reorderRecruitmentRows', input);
export const reorderTasks = (input?: any): Promise<any> => call('reorderTasks', input);
export const restoreFromTrash = (input?: any): Promise<any> => call('restoreFromTrash', input);
export const reviewSupplierInvoice = (input?: any): Promise<any> => call('reviewSupplierInvoice', input);
export const saveAppSettings = (input?: any): Promise<any> => call('saveAppSettings', input);
export const saveApprovalLimit = (input?: any): Promise<any> => call('saveApprovalLimit', input);
export const saveBoard = (input?: any): Promise<any> => call('saveBoard', input);
export const saveBoardColumn = (input?: any): Promise<any> => call('saveBoardColumn', input);
export const saveCRMItem = (input?: any): Promise<any> => call('saveCRMItem', input);
export const saveCalendarEvent = (input?: any): Promise<any> => call('saveCalendarEvent', input);
export const saveCellValue = (input?: any): Promise<any> => call('saveCellValue', input);
export const saveChatConversation = (input?: any): Promise<any> => call('saveChatConversation', input);
export const saveCommercialView = (input?: any): Promise<any> => call('saveCommercialView', input);
export const saveCotizacion = (input?: any): Promise<any> => call('saveCotizacion', input);
export const saveDeal = (input?: any): Promise<any> => call('saveDeal', input);
export const saveDealDocument = (input?: any): Promise<any> => call('saveDealDocument', input);
export const saveDocBlock = (input?: any): Promise<any> => call('saveDocBlock', input);
export const saveExpense = (input?: any): Promise<any> => call('saveExpense', input);
export const saveInternalView = (input?: any): Promise<any> => call('saveInternalView', input);
export const saveInviteTemplate = (input?: any): Promise<any> => call('saveInviteTemplate', input);
export const saveMigrationLog = (input?: any): Promise<any> => call('saveMigrationLog', input);
export const saveMisPendiente = (input?: any): Promise<any> => call('saveMisPendiente', input);
export const saveParticipant = (input?: any): Promise<any> => call('saveParticipant', input);
export const savePayment = (input?: any): Promise<any> => call('savePayment', input);
export const savePettyCashFund = (input?: any): Promise<any> => call('savePettyCashFund', input);
export const savePoAttachment = (input?: any): Promise<any> => call('savePoAttachment', input);
export const saveProject = (input?: any): Promise<any> => call('saveProject', input);
export const savePurchaseOrder = (input?: any): Promise<any> => call('savePurchaseOrder', input);
export const saveQuotationLineItems = (input?: any): Promise<any> => call('saveQuotationLineItems', input);
export const saveRecruitmentRow = (input?: any): Promise<any> => call('saveRecruitmentRow', input);
export const saveRubroAssignment = (input?: any): Promise<any> => call('saveRubroAssignment', input);
export const saveSupplier = (input?: any): Promise<any> => call('saveSupplier', input);
export const saveTask = (input?: any): Promise<any> => call('saveTask', input);
export const saveWidgetLayout = (input?: any): Promise<any> => call('saveWidgetLayout', input);
export const searchParticipantHistory = (input?: any): Promise<any> => call('searchParticipantHistory', input);
export const sendCalendarToWebhook = (input?: any): Promise<any> => call('sendCalendarToWebhook', input);
export const sendMessage = (input?: any): Promise<any> => call('sendMessage', input);
export const sendPaymentReceipt = (input?: any): Promise<any> => call('sendPaymentReceipt', input);
export const sendPoEmail = (input?: any): Promise<any> => call('sendPoEmail', input);
export const sendTimelineToWebhook = (input?: any): Promise<any> => call('sendTimelineToWebhook', input);
export const setEjesIdeaEstado = (input?: any): Promise<any> => call('setEjesIdeaEstado', input);
export const setEjesTableroEstado = (input?: any): Promise<any> => call('setEjesTableroEstado', input);
export const setSwipeCapituloEstado = (input?: any): Promise<any> => call('setSwipeCapituloEstado', input);
export const submitExpense = (input?: any): Promise<any> => call('submitExpense', input);
export const submitPurchaseOrder = (input?: any): Promise<any> => call('submitPurchaseOrder', input);
export const submitEjesEvaluacion = (input?: any): Promise<any> => call('submitEjesEvaluacion', input);
export const submitSwipeVotos = (input?: any): Promise<any> => call('submitSwipeVotos', input);
export const syncCalendarCellValues = (input?: any): Promise<any> => call('syncCalendarCellValues', input);
export const syncExternalView = (input?: any): Promise<any> => call('syncExternalView', input);
export const syncFilloutResponses = (input?: any): Promise<any> => call('syncFilloutResponses', input);
export const syncOutlookInvite = (input?: any): Promise<any> => call('syncOutlookInvite', input);
export const syncZoomMeeting = (input?: any): Promise<any> => call('syncZoomMeeting', input);
export const tagPreworkRespuesta = (input?: any): Promise<any> => call('tagPreworkRespuesta', input);
export const togglePinMessage = (input?: any): Promise<any> => call('togglePinMessage', input);
export const toggleReaction = (input?: any): Promise<any> => call('toggleReaction', input);
export const transcribirPreworkRespuesta = (input?: any): Promise<any> => call('transcribirPreworkRespuesta', input);
export const unlinkExternalView = (input?: any): Promise<any> => call('unlinkExternalView', input);
export const unlinkTeamsChannel = (input?: any): Promise<any> => call('unlinkTeamsChannel', input);
export const updateChatConversationMembers = (input?: any): Promise<any> => call('updateChatConversationMembers', input);
export const updateDashboardTask = (input?: any): Promise<any> => call('updateDashboardTask', input);
export const updatePresence = (input?: any): Promise<any> => call('updatePresence', input);
export const updatePreworkAsignacion = (input?: any): Promise<any> => call('updatePreworkAsignacion', input);
export const updatePreworkEstudio = (input?: any): Promise<any> => call('updatePreworkEstudio', input);
export const updatePreworkMision = (input?: any): Promise<any> => call('updatePreworkMision', input);
export const updatePreworkRespuestaEstado = (input?: any): Promise<any> => call('updatePreworkRespuestaEstado', input);
export const updateSharedView = (input?: any): Promise<any> => call('updateSharedView', input);
export const updateEjesIdea = (input?: any): Promise<any> => call('updateEjesIdea', input);
export const updateSwipeIdea = (input?: any): Promise<any> => call('updateSwipeIdea', input);
export const updateSwipeVoto = (input?: any): Promise<any> => call('updateSwipeVoto', input);
export const updateUser = (input?: any): Promise<any> => call('updateUser', input);
export const uploadProfilePhoto = (input?: any): Promise<any> => call('uploadProfilePhoto', input);
export const uploadSupplierInvoice = (input?: any): Promise<any> => call('uploadSupplierInvoice', input);
export const votePoll = (input?: any): Promise<any> => call('votePoll', input);

// ── Tipos de salida ─────────────────────────────────────────────
// Placeholder tipado laxo; sustituir por los tipos reales cuando el servidor exista.
export type AddExpenseCommentOutputType = any;
export type AnalyzeRecruitmentStatusOutputType = any;
export type ApproveDealOutputType = any;
export type ApproveExpenseOutputType = any;
export type ApprovePurchaseOrderOutputType = any;
export type ApproveSelectedCotizacionesOutputType = any;
export type BackfillExchangeRatesOutputType = any;
export type BulkDeletePaymentsOutputType = any;
export type BulkUpdatePaymentsOutputType = any;
export type CancelPurchaseOrderOutputType = any;
export type CheckNewSubmissionsOutputType = any;
export type CleanupDuplicateCellValuesOutputType = any;
export type CleanupPJT001OutputType = any;
export type CountFilloutSubmissionsOutputType = any;
export type CreateBoardWithTemplateOutputType = any;
export type CreateSharedViewOutputType = any;
export type CreateTeamsChannelOutputType = any;
export type DeleteBoardOutputType = any;
export type DeleteBoardColumnOutputType = any;
export type DeleteCRMItemOutputType = any;
export type DeleteCalendarEventOutputType = any;
export type DeleteCommercialViewOutputType = any;
export type DeleteCotizacionOutputType = any;
export type DeleteDealOutputType = any;
export type DeleteDealDocumentOutputType = any;
export type DeleteDocBlockOutputType = any;
export type DeleteExpenseOutputType = any;
export type DeleteInternalViewOutputType = any;
export type DeleteParticipantOutputType = any;
export type DeletePaymentOutputType = any;
export type DeletePoAttachmentOutputType = any;
export type DeleteProjectOutputType = any;
export type DeletePurchaseOrderOutputType = any;
export type DeleteRecruitmentRowOutputType = any;
export type DeleteSharedViewOutputType = any;
export type DeleteTaskOutputType = any;
export type DeleteUserOutputType = any;
export type DetectDuplicateSuppliersOutputType = any;
export type DuplicateBoardOutputType = any;
export type DuplicateCotizacionOutputType = any;
export type DuplicateGroupOutputType = any;
export type DuplicateRowsOutputType = any;
export type ExecuteButtonActionOutputType = any;
export type ExportConfigBackupOutputType = any;
export type FilloutNativeWebhookOutputType = any;
export type FilloutWebhookOutputType = any;
export type FixCellDataOutputType = any;
export type FixOrphanedCellValuesOutputType = any;
export type GeneratePoPdfOutputType = any;
export type GenerateSupplierTokenOutputType = any;
export type GetAblyTokenOutputType = any;
export type GetAdminDataOutputType = any;
export type GetAllCalendarEventsOutputType = any;
export type GetAppSettingsOutputType = any;
export type GetApprovalLimitsOutputType = any;
export type GetApprovalPreviewOutputType = any;
export type GetBoardColumnsOutputType = any;
export type GetBoardDuplicateBadgesOutputType = any;
export type GetBoardGroupsOutputType = any;
export type GetCRMItemsOutputType = any;
export type GetCalendarBoardStatusOutputType = any;
export type GetCalendarEventByIdOutputType = any;
export type GetCalendarExcelColumnsOutputType = any;
export type GetCellValuesOutputType = any;
export type GetChatConversationsOutputType = any;
export type GetCommercialViewsOutputType = any;
export type GetCotizacionLineItemsOutputType = any;
export type GetCotizacionesOutputType = any;
export type GetCotizacionesAdminOutputType = any;
export type GetDashboardDataOutputType = any;
export type GetDealDocumentsOutputType = any;
export type GetDealsOutputType = any;
export type GetDocBlockOutputType = any;
export type GetDocBlocksOutputType = any;
export type GetExpenseAuditLogOutputType = any;
export type GetExpenseCommentsOutputType = any;
export type GetExpenseLineItemsOutputType = any;
export type GetExpensesOutputType = any;
export type GetFilloutFormsOutputType = any;
export type GetInternalViewsOutputType = any;
export type GetInvoiceWidgetDataOutputType = any;
export type GetLastAnalysisOutputType = any;
export type GetLinkedEventsInfoOutputType = any;
export type GetLinkedParticipantsOutputType = any;
export type GetMessagesOutputType = any;
export type GetMigrationLogsOutputType = any;
export type GetMultiProjectCostAnalysisOutputType = any;
export type GetParticipantsOutputType = any;
export type GetPaymentsOutputType = any;
export type GetPettyCashFundsOutputType = any;
export type GetPoAttachmentsOutputType = any;
export type GetPoAuditLogOutputType = any;
export type GetPoLineItemsOutputType = any;
export type GetPoNotificationsOutputType = any;
export type GetPoPdfBase64OutputType = any;
export type GetPresenceOutputType = any;
export type GetProjectBudgetOutputType = any;
export type GetProjectCostAnalysisOutputType = any;
export type GetProjectDocumentsOutputType = any;
export type GetProjectTeamsFileLinkOutputType = any;
export type GetProjectTeamsFilesOutputType = any;
export type GetProjectsOutputType = any;
export type GetPurchaseOrdersOutputType = any;
export type GetRecruitmentDashboardOutputType = any;
export type GetRecruitmentGroupsOutputType = any;
export type GetRecruitmentRowsOutputType = any;
export type GetReferenceOptionsOutputType = any;
export type GetRubroAssignmentsOutputType = any;
export type GetSharedViewDataOutputType = any;
export type GetSharedViewsOutputType = any;
export type GetStreetViewUrlOutputType = any;
export type GetSupplierInvoiceByIdOutputType = any;
export type GetSupplierInvoicesOutputType = any;
export type GetSupplierPortalDataOutputType = any;
export type GetTaskByIdOutputType = any;
export type GetTaskCommentsOutputType = any;
export type GetTasksOutputType = any;
export type GetTasksForGanttOutputType = any;
export type GetTeamMembersOutputType = any;
export type GetTimelineBoardStatusOutputType = any;
export type GetTrashItemsOutputType = any;
export type GetUnreadCountsOutputType = any;
export type GetUsersOutputType = any;
export type ImportCotizacionesFromCsvOutputType = any;
export type ImportDealsOutputType = any;
export type ImportExcelDataOutputType = any;
export type ImportOdcFromCsvOutputType = any;
export type ImportSuppliersOutputType = any;
export type InviteUsersOutputType = any;
export type LinkFilloutFormOutputType = any;
export type LinkGroupToEventOutputType = any;
export type LinkProjectDealOutputType = any;
export type ListTeamsChannelsOutputType = any;
export type MarkNDASentOutputType = any;
export type MergeSupplierRecordsOutputType = any;
export type MigrateAgeColumnsOutputType = any;
export type MigrateCellValuesToUUIDOutputType = any;
export type MigrateProjectToUUIDOutputType = any;
export type NormalizeSupplierNamesOutputType = any;
export type ParseExcelFileOutputType = any;
export type ParseOdcCsvOutputType = any;
export type PermanentlyDeleteOutputType = any;
export type PreparePoEmailOutputType = any;
export type PublishDocEventOutputType = any;
export type PublishPresenceEventOutputType = any;
export type PublishRecruitmentGroupsChangedOutputType = any;
export type PublishRecruitmentRowsChangedOutputType = any;
export type PublishTypingOutputType = any;
export type PurgeDeletedRowsOutputType = any;
export type RecalculateDuplicateNotesOutputType = any;
export type RejectExpenseOutputType = any;
export type RejectPurchaseOrderOutputType = any;
export type RenameBoardOutputType = any;
export type ReorderInternalViewsOutputType = any;
export type ReorderRecruitmentRowsOutputType = any;
export type ReorderTasksOutputType = any;
export type RestoreFromTrashOutputType = any;
export type ReviewSupplierInvoiceOutputType = any;
export type SaveAppSettingsOutputType = any;
export type SaveApprovalLimitOutputType = any;
export type SaveBoardOutputType = any;
export type SaveBoardColumnOutputType = any;
export type SaveCRMItemOutputType = any;
export type SaveCalendarEventOutputType = any;
export type SaveCellValueOutputType = any;
export type SaveChatConversationOutputType = any;
export type SaveCommercialViewOutputType = any;
export type SaveCotizacionOutputType = any;
export type SaveDealOutputType = any;
export type SaveDealDocumentOutputType = any;
export type SaveDocBlockOutputType = any;
export type SaveExpenseOutputType = any;
export type SaveInternalViewOutputType = any;
export type SaveMigrationLogOutputType = any;
export type SaveParticipantOutputType = any;
export type SavePaymentOutputType = any;
export type SavePettyCashFundOutputType = any;
export type SavePoAttachmentOutputType = any;
export type SaveProjectOutputType = any;
export type SavePurchaseOrderOutputType = any;
export type SaveQuotationLineItemsOutputType = any;
export type SaveRecruitmentRowOutputType = any;
export type SaveRubroAssignmentOutputType = any;
export type SaveSupplierOutputType = any;
export type SaveTaskOutputType = any;
export type SaveWidgetLayoutOutputType = any;
export type SearchParticipantHistoryOutputType = any;
export type SendCalendarToWebhookOutputType = any;
export type SendMessageOutputType = any;
export type SendPaymentReceiptOutputType = any;
export type SendPoEmailOutputType = any;
export type SendTimelineToWebhookOutputType = any;
export type SubmitExpenseOutputType = any;
export type SubmitPurchaseOrderOutputType = any;
export type SyncCalendarCellValuesOutputType = any;
export type SyncExternalViewOutputType = any;
export type SyncFilloutResponsesOutputType = any;
export type SyncOutlookInviteOutputType = any;
export type TogglePinMessageOutputType = any;
export type ToggleReactionOutputType = any;
export type UnlinkExternalViewOutputType = any;
export type UnlinkTeamsChannelOutputType = any;
export type UpdateDashboardTaskOutputType = any;
export type UpdatePresenceOutputType = any;
export type UpdateSharedViewOutputType = any;
export type UpdateUserOutputType = any;
export type UploadProfilePhotoOutputType = any;
export type UploadSupplierInvoiceOutputType = any;
