import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useProject } from '../context/ProjectContext';
import { useRealtimeBoardEvents, BoardFieldUpdatedPayload } from '../hooks/useRealtimeBoardEvents';
import { useProjectPresence } from '../hooks/useProjectPresence';
import { ProjectPresenceAvatars } from '../components/ProjectPresenceAvatars';
import { getTasks, saveTask, deleteTask, saveCalendarEvent, deleteCalendarEvent, reorderTasks, GetTasksOutputType, duplicateGroup, sendTimelineToWebhook, saveBoard, deleteBoard, duplicateBoard, saveCellValue, getRecruitmentGroups, GetRecruitmentGroupsOutputType, syncOutlookInvite, getCalendarBoardStatus, getTimelineBoardStatus, getProjects, saveProject, getTeamMembers, GetTeamMembersOutputType, renameBoard, createBoardWithTemplate, publishRecruitmentGroupsChanged, publishRecruitmentRowsChanged, getTaskById, getCalendarEventById } from 'zite-endpoints-sdk';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, isSameMonth, isSameYear } from 'date-fns';
import { es } from 'date-fns/locale/es';

import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, Square as Gantt, List, CalendarDays, CornerDownRight, FolderPlus, ZoomIn, ZoomOut, X, GripVertical, ArrowUpDown, Eye, EyeOff, ClipboardCopy, BarChart2, Loader2, ExternalLink, RefreshCw, Copy, ChevronsDownUp, ChevronsUpDown, Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useDynamicColumns, renameBoardCache, preSeedBoardCache } from '../hooks/useDynamicColumns';
import { DynamicColumnHeaders, DynamicColumnCells, type DynCols } from '../components/DynamicColumns';
import type { DynColumn } from '../hooks/useDynamicColumns';
import { useTableFilters } from '../hooks/useTableFilters';
import { ColumnFilterPopover } from '../components/ColumnFilterPopover';
import { AdvancedFilterSheet } from '../components/AdvancedFilterSheet';
import { dynColToFilterCol, cellDisplayValue } from '../components/table/tableUtils';
import { InlineInput } from '../components/table/InlineInput';
import { GroupSectionHeader } from '../components/table/GroupSectionHeader';
import { ChildSubTable } from '../components/table/ChildSubTable';
import { TimelinePreviewDialog } from '../components/TimelinePreviewDialog';
import { useDebouncedCallback } from 'use-debounce';
import WeeklyCalendar, { type CalEventItem } from '../components/WeeklyCalendar';
import { CalendarExcelDialog } from '../components/CalendarExcelDialog';

import { Task, CalEvent, GanttScale, BoardGanttGroup, BoardObj } from '../components/pm/pmTypes';
import { TASK_COLS, EVENT_COLS, BOARD_GANTT_STATUS_COLORS } from '../components/pm/pmConstants';
import { EventDetailDialog } from '../components/pm/EventDetailDialog';
import { InvitePreviewDialog } from '../components/pm/InvitePreviewDialog';
import { BoardTabsBar } from '../components/pm/BoardTabsBar';
import { TeamSection } from '../components/pm/TeamSection';
import { TeamEditDialog } from '../components/pm/TeamEditDialog';
import { fmtDate, fmt, toISO, normalizeRange } from '../components/pm/pmDateUtils';
import { TimelineCell } from '../components/pm/TimelineCell';
import { GanttView } from '../components/pm/GanttView';
import { TaskList } from '../components/pm/TaskList';
import { EventsTable } from '../components/pm/EventsTable';

// ── Main PMPage ───────────────────────────────────────────────────────────────
export default function PMPage({ initialSection = 'timelines' }: { initialSection?: 'timelines' | 'calendarios' } = {}) {
  const { user } = useAuth();
  const { selectedProject, projects } = useProject();
  const presence = useProjectPresence({ projectCode: selectedProject, pageName: 'pm', enabled: !!selectedProject && !!user, user: user ?? undefined });
  const [tasks,  setTasks]  = useState<Task[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [boards, setBoards] = useState<string[]>([]);
  const [activeBoardId, setActiveBoardId] = useState('');
  const [boardObjects, setBoardObjects] = useState<BoardObj[]>([]);
  const [calBoardObjects, setCalBoardObjects] = useState<BoardObj[]>([]);
  const [addingBoard, setAddingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [deletingBoard, setDeletingBoard] = useState<string | null>(null);
  const [deletingBoardId, setDeletingBoardId] = useState('');
  const [duplicatingBoard, setDuplicatingBoard] = useState<string | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicatingLoading, setDuplicatingLoading] = useState(false);

  // ── Calendar boards state ─────────────────────────────────────────────────
  const [calBoards, setCalBoards] = useState<string[]>([]);
  const [activeCalBoardId, setActiveCalBoardId] = useState('');
  const [addingCalBoard, setAddingCalBoard] = useState(false);
  const [newCalBoardName, setNewCalBoardName] = useState('');
  const [deletingCalBoard, setDeletingCalBoard] = useState<string | null>(null);
  const [deletingCalBoardId, setDeletingCalBoardId] = useState('');
  const [duplicatingCalBoard, setDuplicatingCalBoard] = useState<string | null>(null);
  const [duplicateCalName, setDuplicateCalName] = useState('');
  const [duplicatingCalLoading, setDuplicatingCalLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [openTask,  setOpenTask]  = useState(false);
  const [openEvent, setOpenEvent] = useState(false);
  const [editingTask,  setEditingTask]  = useState<Task | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [deletingTask,  setDeletingTask]  = useState<string | null>(null);
  const [bulkDeletingIds, setBulkDeletingIds] = useState<string[]>([]);
  const [bulkDeletingEventIds, setBulkDeletingEventIds] = useState<string[]>([]);
  const [deletingEvent, setDeletingEvent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [taskNotes,  setTaskNotes]  = useState('');
  const PRESET_LOCS = ['Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C', 'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F', 'Sala 6-G', 'Sala 6-H', 'Otro'];
  type RecGroup = GetRecruitmentGroupsOutputType['groups'][0];
  const [recGroups, setRecGroups] = useState<RecGroup[]>([]);
  const [recGroupsLoading, setRecGroupsLoading] = useState(false);
  const [linkingGroup, setLinkingGroup] = useState(false);
  const [taskSearch,  setTaskSearch]  = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [taskHiddenColumns, setTaskHiddenColumns] = useState<Set<string>>(new Set());
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [boardTimelineStates, setBoardTimelineStates] = useState<Record<string, { status?: string; url?: string; version?: number }>>({})
  const [timelineVersionDialog, setTimelineVersionDialog] = useState(false);
  const [timelineVersionInput, setTimelineVersionInput] = useState('1');
  const [timelineVersionLoading, setTimelineVersionLoading] = useState(false);
  const [timelinePreview, setTimelinePreview] = useState<{ open: boolean; fileUrl: string; projectName: string }>({ open: false, fileUrl: '', projectName: '' });
  const [calBoardExcelStates, setCalBoardExcelStates] = useState<Record<string, { status?: string; url?: string; version?: number }>>({});
  const [calExcelPreview, setCalExcelPreview] = useState<{ open: boolean; fileUrl: string; projectName: string }>({ open: false, fileUrl: '', projectName: '' });
  const [calExcelDialogOpen, setCalExcelDialogOpen] = useState(false);
  const [outlookSyncing, setOutlookSyncing] = useState(false);
  const [htmlPreviewOpen, setHtmlPreviewOpen] = useState(false);
  const [invitePreviewOpen, setInvitePreviewOpen] = useState(false);

  // ── Team state ────────────────────────────────────────────────────────────
  type UserItem = GetTeamMembersOutputType['members'][0];
  const [teamUsers, setTeamUsers] = useState<UserItem[]>([]);
  const [teamExpanded, setTeamExpanded] = useState(false);
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamLider, setTeamLider] = useState<string[]>([]);
  const [teamAnalistas, setTeamAnalistas] = useState<string[]>([]);
  const [teamModeradores, setTeamModeradores] = useState<string[]>([]);
  const [teamAsistentes, setTeamAsistentes] = useState<string[]>([]);
  // Current saved values (for display)
  const [savedTeam, setSavedTeam] = useState<{ lider: string[]; analistas: string[]; moderadores: string[]; asistentes: string[] }>({ lider: [], analistas: [], moderadores: [], asistentes: [] });

  // ── In-flight guard for getTasks ────────────────────────────────────────────
  const getTasksInFlightRef = useRef(new Map<string, Promise<any>>());
  const guardedGetTasks = (projectCode: string, opts?: { only?: 'tasks' | 'events'; boardId?: string; boardName?: string }) => {
    const key = `${projectCode}::${opts?.only ?? 'all'}::${opts?.boardId ?? ''}`;
    const existing = getTasksInFlightRef.current.get(key);
    if (existing) return existing;
    const promise = getTasks({ projectCode, only: opts?.only, boardId: opts?.boardId, boardName: opts?.boardName })
      .finally(() => { getTasksInFlightRef.current.delete(key); });
    getTasksInFlightRef.current.set(key, promise);
    return promise;
  };

  // [board-debug] Temporary diagnostic logging — remove after validation
  useEffect(() => {
    if (!activeBoardId) return;
    const obj = boardObjects.find(b => b.id === activeBoardId);
    console.log('[board-debug] tab switched', {
      activeBoardId,
      boardName: obj?.name,
      boardOrder: obj?.boardOrder,
      boardTasksCount: tasks.filter(t => t.boardId === activeBoardId).length,
      totalTasksInState: tasks.length,
    });
  }, [activeBoardId]);

  // Derive board names from boardObjects (UUID-native)
  const activeBoardName = useMemo(() => boardObjects.find(b => b.id === activeBoardId)?.name ?? '', [boardObjects, activeBoardId]);
  const activeCalBoardName = useMemo(() => calBoardObjects.find(b => b.id === activeCalBoardId)?.name ?? '', [calBoardObjects, activeCalBoardId]);

  // Board-scoped IDs (UUID-first with legacy fallback)
  const legacyTaskBoardId = (selectedProject && activeBoardName) ? `pm-${selectedProject}-${activeBoardName}` : '';
  const taskBoardId       = activeBoardId || legacyTaskBoardId;
  // legacyCalBoardId is a temporary fallback using the composite 'cal-{project}-{name}' format.
  // In normal operation activeCalBoardId (UUID from Boards table) should always be set.
  // This fallback exists only for edge cases where calBoardObjects haven't loaded yet.
  const legacyCalBoardId  = (selectedProject && activeCalBoardName) ? `cal-${selectedProject}-${activeCalBoardName}` : '';
  const calBoardId        = activeCalBoardId || legacyCalBoardId;
  const taskChildBoardId  = taskBoardId ? `${taskBoardId}::children` : '';
  const calChildBoardId   = calBoardId ? `${calBoardId}::children` : '';
  const taskGroupBoardId  = taskBoardId ? `${taskBoardId}::groups` : '';
  const calGroupBoardId   = calBoardId ? `${calBoardId}::groups` : '';

  const [taskChildLabel,  setTaskChildLabel]  = useState('Sub-tarea');
  const [eventChildLabel, setEventChildLabel] = useState('Sub-evento');

  useEffect(() => {
    if (!selectedProject) return;
    setTaskChildLabel(localStorage.getItem(`pm-child-label-${selectedProject}`) ?? 'Sub-tarea');
    setEventChildLabel(localStorage.getItem(`events-child-label-${selectedProject}`) ?? 'Sub-evento');
  }, [selectedProject]);

  const taskDynCols        = useDynamicColumns(taskBoardId);
  // Mapping of calendar dynamic column names → native CalendarEvents fields
  const CAL_NATIVE_MAP: Record<string, keyof CalEvent> = {
    'Fecha y hora': 'eventDate',
    'Duración (hrs)': 'durationHours',
    'Ubicación (interna)': 'location',
    'Ubicación Interna': 'location',
    'Espacio': 'location',
    'Moderador': 'attendees',
    'Persona/Moderador': 'attendees',
  };

  const calDynCols         = useDynamicColumns(calBoardId, undefined, {
    onCellSaved: (rowId, result) => {
      if (result.inviteStatusChanged) {
        setEvents(prev => prev.map(e => e.id === rowId ? { ...e, inviteStatus: 'Por actualizar' } : e));
      }
      // Update events state when a native-synced column is saved
      if (result.columnId && result.value) {
        const col = calDynCols.columns.find(c => c.id === result.columnId);
        if (col?.columnName) {
          const nativeField = CAL_NATIVE_MAP[col.columnName];
          if (nativeField) {
            setEvents(prev => prev.map(e => {
              if (e.id !== rowId) return e;
              const update: Partial<CalEvent> = {};
              if (nativeField === 'eventDate' && result.value!.dateValue !== undefined) {
                update.eventDate = result.value!.dateValue ?? undefined;
              } else if (nativeField === 'durationHours' && result.value!.numberValue !== undefined) {
                update.durationHours = result.value!.numberValue ?? undefined;
              } else if ((nativeField === 'location' || nativeField === 'attendees') && result.value!.textValue !== undefined) {
                update[nativeField] = result.value!.textValue ?? undefined;
              }
              return { ...e, ...update };
            }));
          }
        }
      }
    },
  });
  const taskChildDynCols   = useDynamicColumns(taskChildBoardId);
  const calChildDynCols    = useDynamicColumns(calChildBoardId);
  const taskGroupDynCols   = useDynamicColumns(taskGroupBoardId);
  const calGroupDynCols    = useDynamicColumns(calGroupBoardId);

  const isLoading = loading || taskDynCols.loading || calDynCols.loading || taskChildDynCols.loading || calChildDynCols.loading || taskGroupDynCols.loading || calGroupDynCols.loading || taskGroupDynCols.cellsLoading || calGroupDynCols.cellsLoading;

  // Only tasks belonging to the active board (UUID-strict: never fall back to name when UUID is available)
  const boardTasks = useMemo(() => tasks.filter(t => {
    if (activeBoardId) return t.boardId === activeBoardId;
    return t.boardName === activeBoardName;
  }), [tasks, activeBoardId, activeBoardName]);

  const taskGroupNames  = useMemo(() => [...taskGroupDynCols.columns.map(g => g.columnName ?? ''), 'Sin grupo'], [taskGroupDynCols.columns]);
  const eventGroupNames = useMemo(() => [...calGroupDynCols.columns.map(g => g.columnName ?? ''), 'Sin grupo'], [calGroupDynCols.columns]);

  const taskAllCols = useMemo(() => [
    ...TASK_COLS,
    { key: '_group', label: 'Fase', type: 'select' as const, options: taskGroupNames },
    ...taskDynCols.columns.map(dynColToFilterCol),
  ], [taskGroupNames, taskDynCols.columns]);

  const eventAllCols = useMemo(() => [
    ...EVENT_COLS,
    { key: '_group', label: 'Grupo', type: 'select' as const, options: eventGroupNames },
    ...calDynCols.columns.map(dynColToFilterCol),
  ], [eventGroupNames, calDynCols.columns]);

  const boardTasksWithGroup = useMemo(() => boardTasks.map(task => {
    const g = taskGroupDynCols.columns.find(g => taskGroupDynCols.getCellVal(task.id, g.id)?.textValue === '1');
    const dynValues: Record<string, string> = {};
    for (const col of taskDynCols.columns) {
      const val = cellDisplayValue(taskDynCols.getCellVal(task.id, col.id), col.columnType);
      if (val) dynValues[col.id] = val;
    }
    return { ...task, _group: g?.columnName ?? 'Sin grupo', ...dynValues };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [boardTasks, taskGroupDynCols.columns, taskGroupDynCols.getCellVal, taskDynCols.columns, taskDynCols.getCellVal]);

  const calEvents = useMemo(() => {
    if (!activeCalBoardId) return [];
    return events.filter(e => {
      if (activeCalBoardId) return e.boardId === activeCalBoardId;
      return e.calendarName === activeCalBoardName;
    });
  }, [events, activeCalBoardId, activeCalBoardName]);

  const eventsWithGroup = useMemo(() => calEvents.map(ev => {
    const g = calGroupDynCols.columns.find(g => calGroupDynCols.getCellVal(ev.id, g.id)?.textValue === '1');
    const dynValues: Record<string, string> = {};
    for (const col of calDynCols.columns) {
      const val = cellDisplayValue(calDynCols.getCellVal(ev.id, col.id), col.columnType);
      if (val) dynValues[col.id] = val;
    }
    return { ...ev, _group: g?.columnName ?? 'Sin grupo', ...dynValues };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [calEvents, calGroupDynCols.columns, calGroupDynCols.getCellVal, calDynCols.columns, calDynCols.getCellVal]);

  const taskFilters  = useTableFilters(boardTasksWithGroup, taskAllCols);
  const eventFilters = useTableFilters(eventsWithGroup, eventAllCols);

  const filteredTasks = useMemo(() => {
    if (!taskSearch && taskFilters.activeFilterCount === 0) return boardTasks;
    if (!taskSearch) return taskFilters.filteredData as Task[];
    const q = taskSearch.toLowerCase();
    return (taskFilters.filteredData as Task[]).filter(t => t.taskName?.toLowerCase().includes(q));
  }, [boardTasks, taskFilters.filteredData, taskFilters.activeFilterCount, taskSearch]);

  const filteredEvents = useMemo(() => {
    if (!eventSearch && eventFilters.activeFilterCount === 0) return calEvents;
    if (!eventSearch) return eventFilters.filteredData as CalEvent[];
    const q = eventSearch.toLowerCase();
    return (eventFilters.filteredData as CalEvent[]).filter(e => e.eventName?.toLowerCase().includes(q));
  }, [calEvents, eventFilters.filteredData, eventFilters.activeFilterCount, eventSearch]);

  // ── Ably realtime: listen for deletes from other users ───────────────────
  useRealtimeBoardEvents({
    projectCode: selectedProject,
    userEmail: user?.email ?? '',
    enabled: !!selectedProject && !!user,
    onTaskDeleted: (payload) => {
      setTasks(prev => prev.filter(t => t.id !== payload.id && t.parentTaskId !== payload.id));
    },
    onEventDeleted: (payload) => {
      setEvents(prev => prev.filter(e => e.id !== payload.id && e.parentEventId !== payload.id));
    },
    onRecruitmentGroupsChanged: (payload) => {
      const eventBoardId = (payload as any)?.boardId;
      // 5B-3E: dual-match for group board IDs
      const matchesTaskGroup = !eventBoardId || eventBoardId === taskGroupBoardId || (activeBoardId && (eventBoardId === `${activeBoardId}::groups`));
      const matchesCalGroup  = !eventBoardId || eventBoardId === calGroupBoardId  || (activeCalBoardId && (eventBoardId === `${activeCalBoardId}::groups`));
      if ((payload as any)?.changeType === 'membership') {
        if (matchesTaskGroup) taskGroupDynCols.softReload();
        if (matchesCalGroup) calGroupDynCols.softReload();
        return;
      }
      if (matchesTaskGroup) taskGroupDynCols.refreshColumns();
      if (matchesCalGroup) calGroupDynCols.refreshColumns();
    },
    onRecruitmentRowsChanged: async (payload) => {
      console.log('[pm] rows changed via Ably', payload);
      const entityType = (payload as any)?.entityType;
      const rowId      = (payload as any)?.rowId;
      const groupId    = (payload as any)?.groupId;
      const changeType = (payload as any)?.changeType;
      const eventBoardId = (payload as any)?.boardId;

      // Fast path: single task created
      if (entityType === 'task' && rowId && changeType === 'created') {
        if (groupId) {
          taskGroupDynCols.setLocalCellVal(rowId, groupId, { textValue: '1' });
        }
        const d = await getTaskById({ id: rowId });
        if (!d.task) {
          console.warn('[pm] getTaskById returned null, falling back to task refresh', { rowId });
          const freshTasks = await fetchTasksOnly();
          setTasks(freshTasks);
          return;
        }
        const normalizedTask = {
          ...d.task!,
          boardId: d.task!.boardId ?? eventBoardId ?? activeBoardId,
        };
        setTasks(prev => {
          if (prev.some(t => t.id === normalizedTask.id)) {
            return prev.map(t =>
              t.id === normalizedTask.id
                ? { ...t, ...normalizedTask, boardId: normalizedTask.boardId ?? t.boardId }
                : t
            );
          }
          return [...prev, normalizedTask];
        });
        return;
      }

      // Fast path: single event created
      if (entityType === 'event' && rowId && changeType === 'created') {
        if (groupId) {
          calGroupDynCols.setLocalCellVal(rowId, groupId, { textValue: '1' });
        }
        const d = await getCalendarEventById({ id: rowId });
        if (!d.calendarEvent) {
          console.warn('[pm] getCalendarEventById returned null, falling back to event refresh', { rowId });
          const freshEvents = await fetchEventsOnly();
          setEvents(freshEvents);
          return;
        }
        const normalizedEvent = {
          ...d.calendarEvent!,
          boardId: d.calendarEvent!.boardId ?? eventBoardId ?? activeCalBoardId,
        };
        setEvents(prev => {
          if (prev.some(e => e.id === normalizedEvent.id)) {
            return prev.map(e =>
              e.id === normalizedEvent.id
                ? { ...e, ...normalizedEvent, boardId: normalizedEvent.boardId ?? e.boardId }
                : e
            );
          }
          return [...prev, normalizedEvent];
        });
        return;
      }

      // Fallback: refresh específico
      // 5B-3E: dual-match — accept UUID boardIds too
      if (entityType === 'task' || eventBoardId === taskBoardId || (activeBoardId && eventBoardId === activeBoardId)) {
        const [, freshTasks] = await Promise.all([
          taskGroupDynCols.softReload(),
          fetchTasksOnly(),
        ]);
        setTasks(freshTasks);
        return;
      }

      if (entityType === 'event' || eventBoardId === calBoardId || (activeCalBoardId && eventBoardId === activeCalBoardId)) {
        const [, freshEvents] = await Promise.all([
          calGroupDynCols.softReload(),
          fetchEventsOnly(),
        ]);
        setEvents(freshEvents);
        return;
      }

      // Ultimate fallback
      await Promise.all([
        taskGroupDynCols.softReload(),
        calGroupDynCols.softReload(),
      ]);
      await silentReload();
    },
    onBoardFieldUpdated: (payload: BoardFieldUpdatedPayload) => {
      if (payload.fieldType === 'dynamic' && payload.columnId && payload.value) {
        const bid = payload.boardId;
        // 5B-3E: dual-match — accept both legacy composite and UUID boardIds
        const isTaskBoard      = bid === taskBoardId      || (activeBoardId    && bid === activeBoardId);
        const isCalBoard       = bid === calBoardId       || (activeCalBoardId && bid === activeCalBoardId);
        const isTaskGroupBoard = bid === taskGroupBoardId  || (activeBoardId    && bid === `${activeBoardId}::groups`);
        const isCalGroupBoard  = bid === calGroupBoardId   || (activeCalBoardId && bid === `${activeCalBoardId}::groups`);
        const isTaskChildBoard = bid === taskChildBoardId  || (activeBoardId    && bid === `${activeBoardId}::children`);
        const isCalChildBoard  = bid === calChildBoardId   || (activeCalBoardId && bid === `${activeCalBoardId}::children`);

        if (isTaskBoard) taskDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
        else if (isCalBoard) {
          calDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
          // Also update events state if this column maps to a native CalendarEvents field
          const col = calDynCols.columns.find(c => c.id === payload.columnId);
          const pv = payload.value;
          if (col?.columnName && pv) {
            const nativeField = CAL_NATIVE_MAP[col.columnName];
            if (nativeField) {
              setEvents(prev => prev.map(e => {
                if (e.id !== payload.rowId) return e;
                const update: Partial<CalEvent> = {};
                if (nativeField === 'eventDate' && pv.dateValue !== undefined) {
                  update.eventDate = pv.dateValue ?? undefined;
                } else if (nativeField === 'durationHours' && pv.numberValue !== undefined) {
                  update.durationHours = pv.numberValue ?? undefined;
                } else if ((nativeField === 'location' || nativeField === 'attendees') && pv.textValue !== undefined) {
                  update[nativeField] = pv.textValue ?? undefined;
                }
                return { ...e, ...update };
              }));
            }
          }
        }
        else if (isTaskGroupBoard) taskGroupDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
        else if (isCalGroupBoard) calGroupDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
        else if (isTaskChildBoard) taskChildDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
        else if (isCalChildBoard) calChildDynCols.setLocalCellVal(payload.rowId, payload.columnId, payload.value);
      } else if (payload.fieldType === 'fixed' && payload.fields) {
        if (payload.entityType === 'task') {
          setTasks(prev => prev.map(t =>
            t.id === payload.rowId ? { ...t, ...payload.fields } : t
          ));
        } else if (payload.entityType === 'event') {
          setEvents(prev => prev.map(e =>
            e.id === payload.rowId ? { ...e, ...payload.fields } : e
          ));
        }
      }
    },
  });

  const silentReload = () => {
    return guardedGetTasks(selectedProject ?? '')
      .then(d => {
        setTasks(d.tasks);
        setEvents(d.calendarEvents);
        setCalBoards(d.calendarBoards ?? []);
        setBoardObjects(prev => {
          const next: BoardObj[] = (d as any).boardObjects ?? [];
          const prevIds = new Set(prev.map(b => b.id));
          const nextIds = new Set(next.map(b => b.id));
          // Same set of boards — preserve local order, merge name changes only
          if (prevIds.size === nextIds.size && [...prevIds].every(id => nextIds.has(id))) {
            const nextMap = new Map(next.map(b => [b.id, b]));
            const merged = prev.map(b => {
              const fresh = nextMap.get(b.id);
              return fresh ? { ...b, name: fresh.name } : b;
            });
            if (merged.every((b, i) => b.name === prev[i].name)) return prev;
            return merged;
          }
          // Boards added or removed — accept server array
          return next;
        });
        setCalBoardObjects(prev => {
          const next: BoardObj[] = (d as any).calendarBoardObjects ?? [];
          const prevIds = new Set(prev.map(b => b.id));
          const nextIds = new Set(next.map(b => b.id));
          if (prevIds.size === nextIds.size && [...prevIds].every(id => nextIds.has(id))) {
            const nextMap = new Map(next.map(b => [b.id, b]));
            const merged = prev.map(b => {
              const fresh = nextMap.get(b.id);
              return fresh ? { ...b, name: fresh.name } : b;
            });
            if (merged.every((b, i) => b.name === prev[i].name)) return prev;
            return merged;
          }
          return next;
        });
      })
      .catch(err => {
        console.warn('[silentReload] getTasks failed:', err);
      });
  };

  const debouncedSilentReload = useDebouncedCallback(() => {
    silentReload();
  }, 300);

  const refreshTasksSilently = () => {
    return guardedGetTasks(selectedProject ?? '', { only: 'tasks' })
      .then(d => { setTasks(d.tasks); })
      .catch(err => { console.warn('[refreshTasksSilently] failed:', err); });
  };

  const refreshEventsSilently = () => {
    return guardedGetTasks(selectedProject ?? '', { only: 'events' })
      .then(d => { setEvents(d.calendarEvents); })
      .catch(err => { console.warn('[refreshEventsSilently] failed:', err); });
  };

  const fetchTasksOnly = () => {
    return guardedGetTasks(selectedProject ?? '', { only: 'tasks' })
      .then(d => d.tasks)
      .catch(err => { console.warn('[fetchTasksOnly] failed:', err); return tasks; });
  };

  const fetchEventsOnly = () => {
    return guardedGetTasks(selectedProject ?? '', { only: 'events' })
      .then(d => d.calendarEvents)
      .catch(err => { console.warn('[fetchEventsOnly] failed:', err); return events; });
  };

  const toIdArr = (v: string | string[] | null | undefined): string[] => {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
  };

  // Load users and project team data
  useEffect(() => {
    if (!user?.email) return;
    getTeamMembers({}).then(d => setTeamUsers(d.members)).catch(err => console.warn('[PMPage] getTeamMembers failed:', err));
  }, [user?.email]);

  useEffect(() => {
    if (!selectedProject) return;
    getProjects({ search: selectedProject }).then(d => {
      const p = d.projects.find(x => x.projectCode === selectedProject);
      if (p) {
        const team = {
          lider: toIdArr(p.lider),
          analistas: toIdArr(p.analistas),
          moderadores: toIdArr(p.moderadores),
          asistentes: toIdArr(p.asistentes),
        };
        setSavedTeam(team);
        setTeamLider(team.lider);
        setTeamAnalistas(team.analistas);
        setTeamModeradores(team.moderadores);
        setTeamAsistentes(team.asistentes);
      }
    }).catch(() => {});
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) return;
    setLoading(true);
    setActiveBoardId('');
    setBoards([]);
    guardedGetTasks(selectedProject).then(d => {
      setTasks(d.tasks);
      setEvents(d.calendarEvents);
      setBoards(d.boards);
      const pmObjs: BoardObj[] = (d as any).boardObjects ?? [];
      setBoardObjects(prev => {
        if (prev.length === pmObjs.length && prev.every((b, i) => b.id === pmObjs[i]?.id && b.name === pmObjs[i]?.name)) return prev;
        return pmObjs;
      });
      const calObjsRaw: BoardObj[] = (d as any).calendarBoardObjects ?? [];
      setCalBoardObjects(prev => {
        if (prev.length === calObjsRaw.length && prev.every((b, i) => b.id === calObjsRaw[i]?.id && b.name === calObjsRaw[i]?.name)) return prev;
        return calObjsRaw;
      });
      setActiveBoardId(prev => {
        if (prev && pmObjs.some(b => b.id === prev)) return prev;
        return pmObjs.length > 0 ? pmObjs[0].id : '';
      });
      const cbs = d.calendarBoards ?? [];
      if (cbs.length === 0 && selectedProject) {
        // Auto-crear "Calendario 1" con columnas predefinidas
        const name = 'Calendario 1';
        setCalBoards([name]);
        setLoading(false);
        saveBoard({ boardName: name, projectCode: selectedProject, boardOrder: 0, boardType: 'calendar', forceCreate: true })
          .then((res) => {
            if ((res as any).columns?.length) preSeedBoardCache(res.id, (res as any).columns as any);
            setCalBoardObjects([{ id: res.id, name: res.boardName, boardType: 'calendar' }]);
            setActiveCalBoardId(res.id);
          })
          .catch(() => {});
      } else {
        setCalBoards(cbs);
        const calObjs: BoardObj[] = (d as any).calendarBoardObjects ?? [];
        setActiveCalBoardId(prev => {
          if (prev && calObjs.some(b => b.id === prev)) return prev;
          return calObjs.length > 0 ? calObjs[0].id : '';
        });
        setLoading(false);
      }
    }).catch(err => {
      console.warn('[PMPage] getTasks initial load failed:', err);
      setLoading(false);
    });
  }, [selectedProject]);

  // ── Data helpers ─────────────────────────────────────────────────────────────
  const saveName = async (id: string, name: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, taskName: name } : t));
    try { await saveTask({ id, taskName: name }); } catch { toast.error('Error al guardar'); debouncedSilentReload(); }
  };

  const quickCreateTask = async (name: string, parentId?: string, groupId?: string) => {
    if (!activeBoardId) { toast.error('Error: no hay un timeline activo con UUID. No se puede crear la tarea.'); return; }
    const tempId = 'temp-' + Date.now();

    // Calculate order: max order of existing tasks in the same group + 1000
    const topLevelBoardTasks = boardTasks.filter(t => !t.parentTaskId);
    const tasksInTargetGroup = topLevelBoardTasks.filter(t => {
      if (groupId) return taskGroupDynCols.getCellVal(t.id, groupId)?.textValue === '1';
      return !taskGroupDynCols.columns.some(g => taskGroupDynCols.getCellVal(t.id, g.id)?.textValue === '1');
    });
    const maxOrder = tasksInTargetGroup.length > 0 ? Math.max(...tasksInTargetGroup.map(t => t.order ?? 0)) : 0;
    const newOrder = maxOrder + 1000;

    setTasks(prev => [...prev, { id: tempId, taskName: name, projectCode: selectedProject ?? '', boardName: activeBoardName, boardId: activeBoardId, parentTaskId: parentId ?? '', status: 'Pendiente', order: newOrder } as Task]);
    if (groupId) taskGroupDynCols.setCellVal(tempId, groupId, { textValue: '1' });
    try {
      const res = await saveTask({ taskName: name, projectCode: selectedProject ?? undefined, boardName: activeBoardName, boardId: activeBoardId || undefined, parentTaskId: parentId ?? '', order: newOrder });
      // Replace temp ID with real ID immediately so cell edits use the correct record
      if (res.id) setTasks(prev => prev.map(t => t.id === tempId ? { ...t, id: res.id, boardId: res.boardId ?? activeBoardId } : t));
      if (res.id && selectedProject) {
        publishRecruitmentRowsChanged({ projectCode: selectedProject, boardId: activeBoardId || taskBoardId, rowId: res.id, changeType: 'created', entityType: 'task', groupId: groupId ?? '' }).catch(() => {});
      }
      if (groupId && res.id) taskGroupDynCols.setCellVal(res.id, groupId, { textValue: '1' });
    } catch { toast.error('Error al crear'); setTasks(prev => prev.filter(t => t.id !== tempId)); }
  };

  const doSaveTask = async () => {
    if (!editingTask) return; setSaving(true);
    try { await saveTask({ id: editingTask.id, notes: taskNotes }); toast.success('Guardado'); setOpenTask(false); debouncedSilentReload(); }
    catch { toast.error('Error al guardar'); }
    setSaving(false);
  };

  const doDeleteTask = async () => {
    if (!deletingTask) return;
    const taskId = deletingTask;
    const prev = tasks;
    setTasks(t => t.filter(x => x.id !== taskId && x.parentTaskId !== taskId));
    setDeletingTask(null);
    toast.success('Tarea eliminada');
    try {
      await deleteTask({ id: taskId });
    } catch {
      setTasks(prev);
      toast.error('Error al eliminar la tarea');
    }
  };

  const createTaskGroup = async () => {
    const n = taskGroupDynCols.columns.length;
    // Cycle across families first (one color per family per round), then go darker
    const families = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    const family = families[n % families.length];
    const shade = Math.floor(n / families.length) % 5 + 1;
    await taskGroupDynCols.addColumn(`Fase ${n + 1}`, `${family}-${shade}`);
    setTimeout(() => {
      if (selectedProject) publishRecruitmentGroupsChanged({ projectCode: selectedProject, boardId: taskGroupBoardId, changeType: 'structure' }).catch(() => {});
    }, 1500);
  };

  const saveEventName = async (id: string, name: string) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, eventName: name } : e));
    try {
      const res = await saveCalendarEvent({ id, eventName: name });
      if (res.inviteStatusChanged) setEvents(prev => prev.map(e => e.id === id ? { ...e, inviteStatus: 'Por actualizar' } : e));
    } catch { toast.error('Error al guardar'); debouncedSilentReload(); }
  };

  const quickCreateEvent = async (name: string, parentId?: string, groupId?: string) => {
    const tempId = 'temp-' + Date.now();
    setEvents(prev => [...prev, { id: tempId, eventName: name, projectCode: selectedProject ?? '', calendarName: activeCalBoardName, boardId: activeCalBoardId, parentEventId: parentId ?? '' } as CalEvent]);
    if (groupId) calGroupDynCols.setCellVal(tempId, groupId, { textValue: '1' });
    try {
      const res = await saveCalendarEvent({ eventName: name, projectCode: selectedProject ?? undefined, calendarName: activeCalBoardName || undefined, boardId: activeCalBoardId || undefined, parentEventId: parentId ?? '' });
      // Replace temp ID with real ID immediately so cell edits (e.g. Datetime) use the correct CalendarEvents record
      if (res.id) setEvents(prev => prev.map(e => e.id === tempId ? { ...e, id: res.id, boardId: activeCalBoardId } : e));
      if (res.id && selectedProject) {
        publishRecruitmentRowsChanged({ projectCode: selectedProject, boardId: calBoardId, rowId: res.id, changeType: 'created', entityType: 'event', groupId: groupId ?? '' }).catch(() => {});
      }
      if (groupId && res.id) calGroupDynCols.setCellVal(res.id, groupId, { textValue: '1' });
    } catch { toast.error('Error al crear'); setEvents(prev => prev.filter(e => e.id !== tempId)); }
  };



  const doDeleteEvent = async () => {
    if (!deletingEvent) return;
    const eventId = deletingEvent;
    const prev = events;
    setEvents(e => e.filter(x => x.id !== eventId && x.parentEventId !== eventId));
    setDeletingEvent(null);
    toast.success('Evento eliminado');
    try {
      await deleteCalendarEvent({ id: eventId });
    } catch {
      setEvents(prev);
      toast.error('Error al eliminar el evento');
    }
  };

  const handleOutlookSync = async (action: 'create' | 'update' | 'cancel') => {
    if (!editingEvent || outlookSyncing) return;
    setOutlookSyncing(true);
    try {
      const result = await syncOutlookInvite({ eventId: editingEvent.id, action });
      if (result.success) {
        toast.success(action === 'cancel' ? 'Invitación cancelada en Outlook' : 'Sincronizado con Outlook ✓');
        const updated = {
          ...editingEvent,
          inviteStatus: result.inviteStatus ?? editingEvent.inviteStatus,
          outlookEventId: action === 'cancel' ? editingEvent.outlookEventId : (result.outlookEventId ?? editingEvent.outlookEventId),
          outlookEventLink: action === 'cancel' ? editingEvent.outlookEventLink : (result.outlookEventLink ?? editingEvent.outlookEventLink),
          inviteBodyHtml: result.inviteBodyHtml ?? editingEvent.inviteBodyHtml,
        };
        setEditingEvent(updated);
        setEvents(prev => prev.map(e => e.id === editingEvent.id ? { ...e, inviteStatus: updated.inviteStatus, outlookEventId: updated.outlookEventId, outlookEventLink: updated.outlookEventLink, inviteBodyHtml: updated.inviteBodyHtml } : e));
      } else {
        toast.error('Error al sincronizar con Outlook');
      }
    } catch { toast.error('Error al sincronizar con Outlook'); }
    finally { setOutlookSyncing(false); }
  };

  const saveTeam = async () => {
    if (!selectedProject) return;
    setTeamSaving(true);
    try {
      const { projects } = await getProjects({ search: selectedProject });
      const proj = projects.find(p => p.projectCode === selectedProject);
      if (!proj) { toast.error('Proyecto no encontrado'); setTeamSaving(false); return; }
      await saveProject({
        id: proj.id,
        projectCode: selectedProject,
        lider: teamLider[0] ?? '',
        analistas: teamAnalistas,
        moderadores: teamModeradores,
        asistentes: teamAsistentes,
      });
      setSavedTeam({ lider: teamLider, analistas: teamAnalistas, moderadores: teamModeradores, asistentes: teamAsistentes });
      toast.success('Equipo guardado');
      setTeamEditOpen(false);
    } catch { toast.error('Error al guardar equipo'); }
    setTeamSaving(false);
  };

  const createEventGroup = async () => {
    const n = calGroupDynCols.columns.length;
    const families = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
    const family = families[n % families.length];
    const shade = Math.floor(n / families.length) % 5 + 1;
    await calGroupDynCols.addColumn(`Grupo ${n + 1}`, `${family}-${shade}`);
    setTimeout(() => {
      if (selectedProject) publishRecruitmentGroupsChanged({ projectCode: selectedProject, boardId: calGroupBoardId, changeType: 'structure' }).catch(() => {});
    }, 1500);
  };

  // ── Calendar board management ─────────────────────────────────────────────
  const reorderCalBoards = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = [...calBoardObjects];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setCalBoardObjects(reordered);
    setCalBoards(reordered.map(b => b.name));
    reordered.forEach((obj, i) => {
      saveBoard({ boardId: obj.id, boardName: obj.name, projectCode: selectedProject ?? '', boardOrder: i, boardType: 'calendar' }).catch(() => {});
    });
  };

  const addCalBoard = async () => {
    if (!newCalBoardName.trim() || !selectedProject) return;
    const name = newCalBoardName.trim();
    setCalBoards(prev => [...prev, name]);
    setAddingCalBoard(false);
    setNewCalBoardName('');
    try {
      const res = await saveBoard({ boardName: name, projectCode: selectedProject, boardOrder: calBoardObjects.length > 0 ? Math.max(...calBoardObjects.map(b => b.boardOrder ?? 0)) + 1 : 0, boardType: 'calendar', forceCreate: true });
      if ((res as any).columns?.length) preSeedBoardCache(res.id, (res as any).columns as any);
      setCalBoardObjects(prev => {
        const nextOrder = prev.length > 0 ? Math.max(...prev.map(b => b.boardOrder ?? 0)) + 1 : 0;
        return [...prev, { id: res.id, name: res.boardName, boardType: 'calendar', boardOrder: nextOrder }];
      });
      setActiveCalBoardId(res.id);
    } catch {
      toast.error('Error al crear el calendario');
    }
  };

  const confirmDeleteCalBoard = () => {
    if (!deletingCalBoard || !selectedProject) return;
    const bId = deletingCalBoardId;
    const boardLabel = deletingCalBoard;
    const remaining = calBoards.filter(b => b !== boardLabel);
    setCalBoards(remaining);
    const remainingObjs = calBoardObjects.filter(b => b.id !== bId);
    setCalBoardObjects(remainingObjs);
    setActiveCalBoardId(remainingObjs[0]?.id ?? '');
    setDeletingCalBoard(null);
    setDeletingCalBoardId('');
    deleteBoard({ boardId: bId, boardName: boardLabel, projectCode: selectedProject, boardType: 'calendar' })
      .then(() => toast.success(`Calendario "${boardLabel}" eliminado`))
      .catch(() => toast.error('Error al eliminar el calendario'));
  };

  const handleDuplicateCalBoard = async () => {
    if (!duplicatingCalBoard || !duplicateCalName.trim() || !selectedProject) return;
    const trimmedName = duplicateCalName.trim();
    setDuplicatingCalLoading(true);
    try {
      const res = await duplicateBoard({ projectCode: selectedProject, boardName: duplicatingCalBoard, newBoardName: duplicateCalName.trim() });
      setCalBoards(prev => [...prev, res.newBoardName]);
      // 5B-3A: use UUID for cache key; fall back to legacy composite if unavailable
      const newCalBoardId = res.uuidBoardId ?? `cal-${selectedProject}-${res.newBoardName}`;
      if (res.taskColumnsCreated) preSeedBoardCache(newCalBoardId, res.taskColumnsCreated as any, res.taskCellValuesCreated as any);
      if (res.groupColumnsCreated) preSeedBoardCache(`${newCalBoardId}::groups`, res.groupColumnsCreated as any, res.groupCellValuesCreated as any);
      // 5B-3B: optimistic calBoardObjects so activeCalBoardId resolves on next render
      setCalBoardObjects(prev => [...prev, { id: newCalBoardId, name: res.newBoardName, boardType: 'calendar' }]);
      setActiveCalBoardId(newCalBoardId);
      debouncedSilentReload();
      setDuplicatingCalBoard(null);
      setDuplicateCalName('');
      toast.success(`Calendario duplicado`);
    } catch {
      toast.error('Error al duplicar el calendario');
    } finally {
      setDuplicatingCalLoading(false);
    }
  };

  // ── Board management ─────────────────────────────────────────────────────────
  const handleRenameBoard = async (boardId: string, newName: string) => {
    if (!selectedProject) return;
    const oldName = boardObjects.find(b => b.id === boardId)?.name ?? '';
    if (oldName === newName) return;

    // UUID doesn't change on rename — no cache migration needed for UUID-keyed boards
    // But legacy composite caches still need migration for compatibility
    const oldLegacyId = `pm-${selectedProject}-${oldName}`;
    const newLegacyId = `pm-${selectedProject}-${newName}`;
    renameBoardCache(oldLegacyId, newLegacyId);
    // Optimistic UI update
    setBoardObjects(prev => prev.map(b => b.id === boardId ? { ...b, name: newName } : b));
    setBoards(prev => prev.map(b => b === oldName ? newName : b));
    setTasks(prev => prev.map(t => t.boardName === oldName ? { ...t, boardName: newName } : t));
    try {
      await renameBoard({ boardId, oldBoardName: oldName, newBoardName: newName, projectCode: selectedProject });
    } catch {
      toast.error('Error al renombrar el tablero');
      renameBoardCache(newLegacyId, oldLegacyId);
      setBoardObjects(prev => prev.map(b => b.id === boardId ? { ...b, name: oldName } : b));
      setBoards(prev => prev.map(b => b === newName ? oldName : b));
      setTasks(prev => prev.map(t => t.boardName === newName ? { ...t, boardName: oldName } : t));
    }
  };

  const handleRenameCalBoard = async (boardId: string, newName: string) => {
    if (!selectedProject) return;
    const oldName = calBoardObjects.find(b => b.id === boardId)?.name ?? boardId;
    if (oldName === newName) return;

    // UUID doesn't change on rename — no cache migration needed
    setCalBoardObjects(prev => prev.map(b => b.id === boardId ? { ...b, name: newName } : b));
    setCalBoards(prev => prev.map(b => b === oldName ? newName : b));
    setEvents(prev => prev.map(e => e.calendarName === oldName ? { ...e, calendarName: newName } : e));

    try {
      await renameBoard({ boardId, oldBoardName: oldName, newBoardName: newName, projectCode: selectedProject });
    } catch {
      toast.error('Error al renombrar el calendario');
      setCalBoardObjects(prev => prev.map(b => b.id === boardId ? { ...b, name: oldName } : b));
      setCalBoards(prev => prev.map(b => b === newName ? oldName : b));
      setEvents(prev => prev.map(e => e.calendarName === newName ? { ...e, calendarName: oldName } : e));
    }
  };

  const reorderBoards = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = [...boardObjects];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setBoardObjects(reordered);
    setBoards(reordered.map(b => b.name));
    reordered.forEach((obj, i) => {
      saveBoard({ boardId: obj.id, boardName: obj.name, projectCode: selectedProject ?? '', boardOrder: i, boardType: 'pm' }).catch(() => {});
    });
  };

  const addBoard = async () => {
    if (!newBoardName.trim() || !selectedProject) return;
    const name = newBoardName.trim();

    setBoards(prev => [...prev, name]);
    setAddingBoard(false);
    setNewBoardName('');
    try {
      // createBoardWithTemplate creates the Board + 3 default columns + 7 standard tasks
      // + color CellValues in a single call, so the new timeline is fully populated instantly.
      const res = await createBoardWithTemplate({
        projectCode: selectedProject,
        boardName: name,
        boardOrder: boardObjects.length > 0 ? Math.max(...boardObjects.map(b => b.boardOrder ?? 0)) + 1 : 0,
        boardType: 'pm',
      });
      // Pre-seed column and cell caches so useDynamicColumns renders instantly
      const newUUID = res.uuidBoardId ?? res.boardId;
      preSeedBoardCache(newUUID, res.columns as any, res.cellValues as any);
      setBoardObjects(prev => {
        const nextOrder = prev.length > 0 ? Math.max(...prev.map(b => b.boardOrder ?? 0)) + 1 : 0;
        return [...prev, { id: newUUID, name, boardType: 'pm', boardOrder: nextOrder }];
      });
      setActiveBoardId(newUUID);
      // Add template tasks to local state immediately (no reload needed)
      setTasks(prev => [
        ...prev,
        ...res.tasks.map(t => ({
          id: t.id,
          taskName: t.name,
          projectCode: selectedProject,
          boardName: name,
          boardId: newUUID,
          parentTaskId: '',
          status: 'Pendiente',
          order: t.order,
        } as Task)),
      ]);
    } catch {
      toast.error('Error al crear el tablero');
    }
  };

  const confirmDeleteBoard = () => {
    if (!deletingBoard || !selectedProject) return;
    const bId = deletingBoardId;
    const boardLabel = deletingBoard;
    const remaining = boards.filter(b => b !== boardLabel);
    setBoards(remaining);
    const remainingObjs = boardObjects.filter(b => b.id !== bId);
    setBoardObjects(remainingObjs);
    setActiveBoardId(remainingObjs[0]?.id ?? '');
    setDeletingBoard(null);
    setDeletingBoardId('');
    deleteBoard({ boardId: bId, boardName: boardLabel, projectCode: selectedProject })
      .then(() => toast.success(`Tablero "${boardLabel}" eliminado`))
      .catch(() => toast.error('Error al eliminar el tablero'));
  };

  const handleDuplicateBoard = async () => {
    if (!duplicatingBoard || !duplicateName.trim() || !selectedProject) return;
    const trimmedDupName = duplicateName.trim();

    setDuplicatingLoading(true);
    try {
      const res = await duplicateBoard({ projectCode: selectedProject, boardName: duplicatingBoard, newBoardName: duplicateName.trim() });
      setBoards(prev => [...prev, res.newBoardName]);
      const newUUID = res.uuidBoardId ?? `pm-${selectedProject}-${res.newBoardName}`;
      if (res.taskColumnsCreated) preSeedBoardCache(newUUID, res.taskColumnsCreated as any, res.taskCellValuesCreated as any);
      if (res.groupColumnsCreated) preSeedBoardCache(`${newUUID}::groups`, res.groupColumnsCreated as any, res.groupCellValuesCreated as any);
      setBoardObjects(prev => [...prev, { id: newUUID, name: res.newBoardName, boardType: 'pm' }]);
      setActiveBoardId(newUUID);
      debouncedSilentReload();
      setDuplicatingBoard(null);
      setDuplicateName('');
      toast.success(`Tablero duplicado con ${res.taskCount} tarea${res.taskCount !== 1 ? 's' : ''}`);
    } catch {
      toast.error('Error al duplicar el tablero');
    } finally {
      setDuplicatingLoading(false);
    }
  };

  const handleCalExcelSuccess = (result: { status?: string; fileUrl?: string; eventCount: number; version?: string }) => {
    setCalBoardExcelStates(prev => ({
      ...prev,
      [activeCalBoardId]: {
        status: result.status,
        url: result.fileUrl,
        version: result.version ? Number(result.version) : prev[activeCalBoardId]?.version,
      },
    }));
  };

  // Load persistent calendar Excel status from DB when switching boards
  useEffect(() => {
    if (!selectedProject || !activeCalBoardId || !activeCalBoardName) return;
    // Skip if we already have status for this board
    if (calBoardExcelStates[activeCalBoardId]) return;
    getCalendarBoardStatus({ projectCode: selectedProject, calendarName: activeCalBoardName, boardId: activeCalBoardId })
      .then(res => {
        if (res.version !== null || res.fileUrl !== null) {
          setCalBoardExcelStates(prev => ({
            ...prev,
            [activeCalBoardId]: {
              // Merge DB values but don't overwrite a fresher in-memory status
              status: prev[activeCalBoardId]?.status ?? (res.fileUrl ? 'Listo' : undefined),
              url: prev[activeCalBoardId]?.url ?? res.fileUrl ?? undefined,
              version: prev[activeCalBoardId]?.version ?? res.version ?? undefined,
            },
          }));
        }
      })
      .catch(() => { /* silent */ });
  }, [selectedProject, activeCalBoardId, activeCalBoardName]);

  // ── Restore saved timeline state from project record when board/project changes ──
  useEffect(() => {
    if (!selectedProject || !activeBoardId) return;
    // Only seed if we don't already have a state for this board (avoids overwriting fresh results)
    if (boardTimelineStates[activeBoardId]) return;
    const project = projects.find(p => p.projectCode === selectedProject) as any;
    if (project?.timelineStatus === 'Listo' && project?.timelineUrl) {
      setBoardTimelineStates(prev => ({
        ...prev,
        [activeBoardId]: { status: project.timelineStatus, url: project.timelineUrl },
      }));
    }
  }, [selectedProject, activeBoardId, projects]);

  const boardTimeline = boardTimelineStates[activeBoardId] ?? {};

  const openTimelineDialog = async () => {
    // Pre-fill with stored version + 1 (optimistic); then correct from DB
    const stored = boardTimelineStates[activeBoardId]?.version;
    setTimelineVersionInput(stored !== undefined ? String(stored + 1) : '1');
    setTimelineVersionDialog(true);
    if (!selectedProject || !activeBoardName) return;
    setTimelineVersionLoading(true);
    try {
      const status = await getTimelineBoardStatus({ projectCode: selectedProject, boardName: activeBoardName, boardId: activeBoardId });
      if (status.currentVersion !== null) {
        setTimelineVersionInput(String(status.currentVersion + 1));
        setBoardTimelineStates(prev => ({ ...prev, [activeBoardId]: { ...prev[activeBoardId], version: status.currentVersion! } }));
      }
    } catch { /* keep default */ }
    finally { setTimelineVersionLoading(false); }
  };

  const handleSendTimeline = async () => {
    const version = timelineVersionInput.trim();
    if (!version || !selectedProject || !activeBoardName) return;
    setTimelineVersionDialog(false);
    setTimelineLoading(true);
    try {
      const res = await sendTimelineToWebhook({ projectCode: selectedProject, boardName: activeBoardName, boardId: activeBoardId, version });
      const savedVersion = parseInt(version, 10) || undefined;
      setBoardTimelineStates(prev => ({ ...prev, [activeBoardId]: { status: res.timelineStatus, url: res.fileUrl, version: savedVersion } }));
      if (res.timelineStatus === 'Listo') {
        toast.success(`✅ Timeline V${version} listo — ${res.taskCount} tarea${res.taskCount !== 1 ? 's' : ''}`);
      } else {
        toast.error('El timeline se procesó pero n8n reportó un error.');
      }
    } catch {
      setBoardTimelineStates(prev => ({ ...prev, [activeBoardId]: { ...prev[activeBoardId], status: 'Error' } }));
      toast.error('Error al enviar el timeline');
    } finally {
      setTimelineLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!selectedProject) return (
    <div className="flex flex-col items-center justify-center h-full text-center p-12">
      <div className="text-4xl mb-4">📋</div>
      <h3 className="text-lg font-semibold mb-2">Selecciona un proyecto</h3>
      <p className="text-muted-foreground text-sm">Las actividades están organizadas por proyecto.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* ── Top-level section tabs ───────────────────────────────────────────── */}
      <Tabs defaultValue={initialSection} className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center px-4 pt-3 border-b border-border bg-card flex-shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="timelines" className="gap-1.5 text-xs h-7"><BarChart2 className="w-3.5 h-3.5" /> Timelines</TabsTrigger>
            <TabsTrigger value="calendarios" className="gap-1.5 text-xs h-7"><CalendarDays className="w-3.5 h-3.5" /> Calendarios</TabsTrigger>
          </TabsList>
          <ProjectPresenceAvatars members={presence.members} />
          {/* ── Team section ── */}
          <TeamSection
            teamUsers={teamUsers}
            savedTeam={savedTeam}
            expanded={teamExpanded}
            setExpanded={setTeamExpanded}
            onEditOpen={() => {
              setTeamLider(savedTeam.lider);
              setTeamAnalistas(savedTeam.analistas);
              setTeamModeradores(savedTeam.moderadores);
              setTeamAsistentes(savedTeam.asistentes);
              setTeamEditOpen(true);
            }}
          />
        </div>



        {/* ── TIMELINES ── */}
        <TabsContent value="timelines" className="flex flex-col flex-1 overflow-hidden mt-0 min-h-0 data-[state=inactive]:hidden">
          {/* ── Board tabs ─────────────────────────────────────────────────────── */}
          <BoardTabsBar
            boards={boards}
            boardObjects={boardObjects}
            activeBoard={activeBoardId}
            onActiveBoardChange={setActiveBoardId}
            adding={addingBoard}
            setAdding={setAddingBoard}
            newBoardName={newBoardName}
            setNewBoardName={setNewBoardName}
            onAddBoard={addBoard}
            onDuplicateBoard={b => { setDuplicatingBoard(b); setDuplicateName(`${b} (copia)`); }}
            onDeleteBoard={id => {
              const name = boardObjects.find(bo => bo.id === id)?.name ?? '';
              setDeletingBoard(name);
              setDeletingBoardId(id);
            }}
            onRenameBoard={handleRenameBoard}
            onReorder={reorderBoards}
            addLabel="Nuevo timeline"
            inputPlaceholder="Nombre del timeline"
          />

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto flex flex-col">
        {loading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !activeBoardId ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center p-12">
            <div className="text-5xl mb-4">📊</div>
            <h3 className="text-lg font-semibold mb-2">Crea tu primer timeline</h3>
            <p className="text-muted-foreground text-sm mb-5 max-w-xs">
              Cada timeline es un tablero con fases y tareas. Las fechas de inicio y fin son columnas integradas.
            </p>
            <Button onClick={() => setAddingBoard(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Nuevo timeline
            </Button>
          </div>
        ) : (
          <div className="p-6">
            <Tabs defaultValue="list">
              {/* Tabs header + timeline button */}
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <TabsList>
                    <TabsTrigger value="list"     className="gap-1.5"><List className="w-3.5 h-3.5" /> Lista</TabsTrigger>
                    <TabsTrigger value="gantt"    className="gap-1.5"><Gantt className="w-3.5 h-3.5" /> Gantt</TabsTrigger>

                  </TabsList>
                  <p className="text-xs text-muted-foreground hidden sm:block">
                    <span className="font-semibold text-foreground">{boardTasks.filter(t => t.status === 'Completada').length}</span>
                    /{boardTasks.filter(t => !t.parentTaskId).length} completadas
                  </p>
                </div>

                {/* Timeline Excel button */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {boardTimeline.status === 'Listo' && boardTimeline.url ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1.5 h-8 border-emerald-400/50 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20">
                          <BarChart2 className="w-3.5 h-3.5" />
                          Timeline Excel
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 p-1.5">
                        <DropdownMenuItem onClick={() => window.open(boardTimeline.url!, '_blank')} className="gap-2 text-xs cursor-pointer">
                          <ExternalLink className="w-3.5 h-3.5" /> Ver archivo
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setTimelinePreview({ open: true, fileUrl: boardTimeline.url!, projectName: `${selectedProject} — ${activeBoardName}` })}
                          className="gap-2 text-xs cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" /> Preview
                        </DropdownMenuItem>
                        <div className="my-1 border-t border-border/40" />
                        <DropdownMenuItem onClick={() => openTimelineDialog()} disabled={timelineLoading} className="gap-2 text-xs cursor-pointer">
                          <RefreshCw className="w-3.5 h-3.5" /> Actualizar timeline
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className={`gap-1.5 h-8 ${boardTimeline.status === 'Error' ? 'border-destructive/40 text-destructive hover:bg-destructive/5' : ''}`}
                      disabled={timelineLoading}
                      onClick={() => openTimelineDialog()}
                    >
                      {timelineLoading
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <BarChart2 className="w-3.5 h-3.5" />}
                      {timelineLoading ? 'Procesando...' : boardTimeline.status === 'Error' ? 'Reintentar timeline' : 'Crear timeline Excel'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Lista */}
              <TabsContent value="list">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Input className="w-48 h-8 text-sm" placeholder="Buscar tareas..." value={taskSearch} onChange={e => setTaskSearch(e.target.value)} />
                  <AdvancedFilterSheet
                    columns={taskAllCols}
                    rules={taskFilters.advancedFilters}
                    onRulesChange={taskFilters.setAdvancedFilters}
                    filterMode={taskFilters.filterMode}
                    onFilterModeChange={taskFilters.setFilterMode}
                    colUniqueValues={taskFilters.colUniqueValues}
                    columnFilters={taskFilters.columnFilters}
                    onClearColumnFilter={key => taskFilters.setColFilter(key, new Set())}
                    activeFilterCount={taskFilters.activeFilterCount}
                  />
                  {taskDynCols.columns.length > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant={taskHiddenColumns.size > 0 ? 'default' : 'outline'} className="gap-1.5 h-8">
                          {taskHiddenColumns.size > 0 ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          Columnas
                          {taskHiddenColumns.size > 0 && (
                            <span className="ml-0.5 bg-background/30 text-inherit text-[10px] font-semibold px-1.5 rounded-full">
                              {taskHiddenColumns.size} oculta{taskHiddenColumns.size !== 1 ? 's' : ''}
                            </span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-56 p-3">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Columnas</p>
                          <div className="flex items-center rounded-md border border-border overflow-hidden">
                            <button onClick={() => setTaskHiddenColumns(new Set())} className="px-2 py-0.5 text-[11px] font-medium text-foreground bg-card hover:bg-muted transition-colors border-r border-border">Todas</button>
                            <button onClick={() => setTaskHiddenColumns(new Set(taskDynCols.columns.map(c => c.id)))} className="px-2 py-0.5 text-[11px] font-medium text-muted-foreground bg-card hover:bg-muted hover:text-foreground transition-colors">Ninguna</button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {[...taskDynCols.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0)).map(col => (
                            <label key={col.id} className="flex items-center gap-2.5 cursor-pointer group">
                              <Checkbox checked={!taskHiddenColumns.has(col.id)} onCheckedChange={() => setTaskHiddenColumns(prev => { const n = new Set(prev); n.has(col.id) ? n.delete(col.id) : n.add(col.id); return n; })} className="h-3.5 w-3.5" />
                              <span className="text-sm text-foreground group-hover:text-primary transition-colors truncate">{col.columnName}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {(taskFilters.activeFilterCount + (taskSearch ? 1 : 0)) > 0 && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary text-xs rounded-lg font-medium border border-primary/20">
                      <span>{taskFilters.activeFilterCount + (taskSearch ? 1 : 0)} filtro{(taskFilters.activeFilterCount + (taskSearch ? 1 : 0)) !== 1 ? 's' : ''} activo{(taskFilters.activeFilterCount + (taskSearch ? 1 : 0)) !== 1 ? 's' : ''}</span>
                      <button onClick={() => { taskFilters.clearAllFilters(); setTaskSearch(''); }} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
                {isLoading ? <Skeleton className="h-64 w-full" /> : (
                  <TaskList
                    tasks={filteredTasks}
                    onEdit={t => { setEditingTask(t); setTaskNotes(t.notes ?? ''); setOpenTask(true); }}
                    onDelete={setDeletingTask}
                    onSaveName={saveName}
                    onQuickCreate={quickCreateTask}
                    onCreateGroup={createTaskGroup}
                    dynCols={taskDynCols}
                    childDynCols={taskChildDynCols}
                    groupDynCols={taskGroupDynCols}
                    childLabel={taskChildLabel}
                    onChildLabelChange={l => { setTaskChildLabel(l); if (selectedProject) localStorage.setItem(`pm-child-label-${selectedProject}`, l); }}
                    columnFilters={taskFilters.columnFilters}
                    setColFilter={taskFilters.setColFilter}
                    colUniqueValues={taskFilters.colUniqueValues}
                    hiddenColumns={taskHiddenColumns}
                    onTasksChange={setTasks}
                    sortColumn={taskFilters.sortColumn}
                    sortDirection={taskFilters.sortDirection}
                    toggleSort={taskFilters.toggleSort}
                    onRefresh={debouncedSilentReload}
                    onBulkDelete={ids => setBulkDeletingIds(ids)}
                    onDuplicateGroup={async (groupId) => {
                      try {
                        const res = await duplicateGroup({ groupColumnId: groupId, tableType: 'task' });
                        toast.success(`Grupo duplicado con ${res.duplicatedRows} tarea${res.duplicatedRows !== 1 ? 's' : ''}`);
                        debouncedSilentReload();
                        taskGroupDynCols.reload();
                      } catch { toast.error('Error al duplicar grupo'); }
                    }}
                    onGroupStructureChanged={() => {
                      if (selectedProject) publishRecruitmentGroupsChanged({ projectCode: selectedProject, boardId: taskGroupBoardId, changeType: 'structure' }).catch(() => {});
                    }}
                  />
                )}
              </TabsContent>

              {/* Gantt */}
              <TabsContent value="gantt">
                {isLoading ? <Skeleton className="h-64 w-full" /> : (
                  <GanttView tasks={boardTasks} dynCols={taskDynCols} childDynCols={taskChildDynCols} groupDynCols={taskGroupDynCols} boardId={taskBoardId} />
                )}
              </TabsContent>


            </Tabs>
          </div>
        )}
        </div>
        </TabsContent>

        {/* ── CALENDARIOS ── */}
        <TabsContent value="calendarios" className="flex flex-col flex-1 overflow-hidden mt-0 min-h-0 data-[state=inactive]:hidden">
          {/* Calendar board tabs */}
          <BoardTabsBar
            boards={calBoards}
            boardObjects={calBoardObjects}
            activeBoard={activeCalBoardId}
            onActiveBoardChange={setActiveCalBoardId}
            adding={addingCalBoard}
            setAdding={setAddingCalBoard}
            newBoardName={newCalBoardName}
            setNewBoardName={setNewCalBoardName}
            onAddBoard={addCalBoard}
            onDuplicateBoard={name => { setDuplicatingCalBoard(name); setDuplicateCalName(`${name} (copia)`); }}
            onDeleteBoard={id => {
              const name = calBoardObjects.find(bo => bo.id === id)?.name ?? '';
              setDeletingCalBoard(name);
              setDeletingCalBoardId(id);
            }}
            onRenameBoard={handleRenameCalBoard}
            onReorder={reorderCalBoards}
            addLabel="Nuevo calendario"
            inputPlaceholder="Nombre del calendario"
            getBadge={id => calBoardExcelStates[id]}
          />

          {/* Content */}
          <div className="flex-1 overflow-auto flex flex-col">
            {loading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : !activeCalBoardId ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center p-12">
                <div className="text-5xl mb-4">📅</div>
                <h3 className="text-lg font-semibold mb-2">Crea tu primer calendario</h3>
                <p className="text-muted-foreground text-sm mb-5 max-w-xs">
                  Cada calendario tiene sus propias actividades con fecha, duración, moderador, ubicación y más.
                </p>
                <Button onClick={() => setAddingCalBoard(true)} className="gap-2">
                  <Plus className="w-4 h-4" /> Nuevo calendario
                </Button>
              </div>
            ) : (
              <div className="p-6">
                <Tabs defaultValue="lista">
                  {/* Tab bar + Excel button */}
                  {(() => {
                    const calBoard = calBoardExcelStates[activeCalBoardId] ?? {};
                    return (
                      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                        <TabsList className="h-8">
                          <TabsTrigger value="lista" className="gap-1.5 text-xs h-7"><List className="w-3.5 h-3.5" /> Lista</TabsTrigger>
                          <TabsTrigger value="calendario" className="gap-1.5 text-xs h-7"><CalendarDays className="w-3.5 h-3.5" /> Calendario</TabsTrigger>
                        </TabsList>
                        <div className="flex-shrink-0">
                          {calBoard.status === 'Listo' && calBoard.url ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="gap-1.5 h-8 border-emerald-400/50 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20">
                                  <CalendarDays className="w-3.5 h-3.5" />
                                  Calendario Excel
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48 p-1.5">
                                <DropdownMenuItem onClick={() => window.open(calBoard.url!, '_blank')} className="gap-2 text-xs cursor-pointer">
                                  <ExternalLink className="w-3.5 h-3.5" /> Ver archivo
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setCalExcelPreview({ open: true, fileUrl: calBoard.url!, projectName: `${selectedProject} — ${activeCalBoardName}` })}
                                  className="gap-2 text-xs cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" /> Preview
                                </DropdownMenuItem>
                                <div className="my-1 border-t border-border/40" />
                                <DropdownMenuItem onClick={() => setCalExcelDialogOpen(true)} className="gap-2 text-xs cursor-pointer">
                                  <RefreshCw className="w-3.5 h-3.5" /> Actualizar Excel
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className={`gap-1.5 h-8 ${calBoard.status === 'Error' ? 'border-destructive/40 text-destructive hover:bg-destructive/5' : ''}`}
                              onClick={() => setCalExcelDialogOpen(true)}
                            >
                              <CalendarDays className="w-3.5 h-3.5" />
                              {calBoard.status === 'Error' ? 'Reintentar Excel' : 'Crear calendario Excel'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Lista tab */}
                  <TabsContent value="lista" className="mt-0">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <Input className="w-48 h-8 text-sm" placeholder="Buscar eventos..." value={eventSearch} onChange={e => setEventSearch(e.target.value)} />
                      <AdvancedFilterSheet
                        columns={eventAllCols}
                        rules={eventFilters.advancedFilters}
                        onRulesChange={eventFilters.setAdvancedFilters}
                        filterMode={eventFilters.filterMode}
                        onFilterModeChange={eventFilters.setFilterMode}
                        colUniqueValues={eventFilters.colUniqueValues}
                        columnFilters={eventFilters.columnFilters}
                        onClearColumnFilter={key => eventFilters.setColFilter(key, new Set())}
                        activeFilterCount={eventFilters.activeFilterCount}
                      />
                      {(eventFilters.activeFilterCount + (eventSearch ? 1 : 0)) > 0 && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary text-xs rounded-lg font-medium border border-primary/20">
                          <span>{eventFilters.activeFilterCount + (eventSearch ? 1 : 0)} filtro{(eventFilters.activeFilterCount + (eventSearch ? 1 : 0)) !== 1 ? 's' : ''} activo{(eventFilters.activeFilterCount + (eventSearch ? 1 : 0)) !== 1 ? 's' : ''}</span>
                          <button onClick={() => { eventFilters.clearAllFilters(); setEventSearch(''); }} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                    {isLoading ? <Skeleton className="h-64 w-full mb-4" /> : (
                      <div className="mb-4">
                    <EventsTable
                      events={filteredEvents}
                      onEdit={e => {
                        setEditingEvent(e);
                        setOpenEvent(true);
                        if (selectedProject) {
                          setRecGroupsLoading(true);
                          getRecruitmentGroups({ projectCode: selectedProject })
                            .then(d => setRecGroups(d.groups))
                            .catch(() => {})
                            .finally(() => setRecGroupsLoading(false));
                        }
                      }}
                      onOpenInvite={e => { setEditingEvent(e); setInvitePreviewOpen(true); }}
                      onDelete={setDeletingEvent}
                      onSaveEventName={saveEventName}
                      onQuickCreate={quickCreateEvent}
                      onCreateGroup={createEventGroup}
                      dynCols={calDynCols}
                      childDynCols={calChildDynCols}
                      groupDynCols={calGroupDynCols}
                      boardId={calBoardId}
                      childLabel={eventChildLabel}
                      onChildLabelChange={l => { setEventChildLabel(l); if (selectedProject) localStorage.setItem(`events-child-label-${selectedProject}`, l); }}
                      columnFilters={eventFilters.columnFilters}
                      setColFilter={eventFilters.setColFilter}
                      colUniqueValues={eventFilters.colUniqueValues}
                      onRefresh={debouncedSilentReload}
                      onBulkDelete={ids => setBulkDeletingEventIds(ids)}
                      onEventsUpdate={(evId, field, value) => {
                        setEvents(prev => prev.map(e =>
                          e.id === evId ? { ...e, [field]: value || undefined } : e
                        ));
                      }}
                      onInviteStatusChanged={(evId) => {
                        setEvents(prev => prev.map(e => e.id === evId ? { ...e, inviteStatus: 'Por actualizar' } : e));
                      }}
                      onGroupStructureChanged={() => {
                        if (selectedProject) publishRecruitmentGroupsChanged({ projectCode: selectedProject, boardId: calGroupBoardId, changeType: 'structure' }).catch(() => {});
                      }}
                    />
                  </div>
                )}
                  </TabsContent>

                  {/* Calendario tab */}
                  <TabsContent value="calendario" className="mt-0">
                {/* Weekly calendar */}
                {(() => {
                  const dateCol   = calDynCols.columns.find(c => c.columnName === 'Fecha y hora');
                  const durCol    = calDynCols.columns.find(c => c.columnName === 'Duración (hrs)');
                  const locCol    = calDynCols.columns.find(c => c.columnName === 'Ubicación Interna') ?? calDynCols.columns.find(c => c.columnName === 'Ubicación (interna)') ?? calDynCols.columns.find(c => c.columnName === 'Espacio');
                  const personCol = calDynCols.columns.find(c => c.columnName === 'Moderador') ?? calDynCols.columns.find(c => c.columnName === 'Persona/Moderador');
                  return isLoading ? <Skeleton className="h-64 w-full" /> : (
                    <div className="rounded-xl border border-border/30">
                    <WeeklyCalendar
                      events={filteredEvents.map(e => {
                        // Native-first: CalendarEvents is source of truth.
                        // CellValue only used as fallback when native is empty.
                        let eventDate     = e.eventDate;
                        let durationHours = e.durationHours ?? undefined as number | undefined;
                        let location      = e.location;
                        let attendees     = e.attendees;
                        if (!eventDate && dateCol) {
                          const val = calDynCols.getCellVal(e.id, dateCol.id);
                          if (val?.dateValue) eventDate = val.dateValue;
                        }
                        if (durationHours == null && durCol) {
                          const val = calDynCols.getCellVal(e.id, durCol.id);
                          if (val?.numberValue != null) durationHours = val.numberValue;
                        }
                        if (!location && locCol) {
                          const val = calDynCols.getCellVal(e.id, locCol.id);
                          if (val?.textValue) location = val.textValue;
                        }
                        if (!attendees && personCol) {
                          const val = calDynCols.getCellVal(e.id, personCol.id);
                          if (val?.textValue) attendees = val.textValue;
                        }
                        return {
                          id: e.id,
                          eventName: e.eventName ?? '',
                          projectCode: e.projectCode ?? selectedProject ?? undefined,
                          eventDate: eventDate ?? undefined,
                          durationHours,
                          location: location ?? undefined,
                          attendees: attendees ?? undefined,
                          notes: e.notes ?? undefined,
                        } satisfies CalEventItem;
                      })}
                      onEventUpdate={async (id, newEventDate) => {
                        // Optimistically update local state so the visual stays in place
                        setEvents(prev => prev.map(e => e.id === id ? { ...e, eventDate: newEventDate } : e));
                        // Also update the CellValue for "Fecha y hora" so the calendar re-reads the correct date
                        const dateCol = calDynCols.columns.find(c => c.columnName === 'Fecha y hora');
                        if (dateCol) {
                          calDynCols.setCellVal(id, dateCol.id, { dateValue: newEventDate });
                        }
                        try {
                          await saveCalendarEvent({ id, eventDate: newEventDate });
                          if (dateCol) {
                            await saveCellValue({ boardId: calBoardId, rowId: id, columnId: dateCol.id, dateValue: newEventDate });
                          }
                          debouncedSilentReload();
                        } catch {
                          // Revert optimistic update on failure
                          debouncedSilentReload();
                          toast.error('Error al mover el evento');
                        }
                      }}
                      onEventResize={async (id, newDurationHours) => {
                        const durCol = calDynCols.columns.find(c => c.columnName === 'Duración (hrs)');
                        if (durCol) {
                          calDynCols.setCellVal(id, durCol.id, { numberValue: newDurationHours });
                        }
                        try {
                          if (durCol) {
                            await saveCellValue({ boardId: calBoardId, rowId: id, columnId: durCol.id, numberValue: newDurationHours });
                          }
                          await saveCalendarEvent({ id, durationHours: newDurationHours });
                          debouncedSilentReload();
                        } catch {
                          debouncedSilentReload();
                          toast.error('Error al cambiar la duración');
                        }
                      }}
                      onEventCreate={async (eventName, eventDate) => {
                        const tempId = 'temp-' + Date.now();
                        setEvents(prev => [...prev, { id: tempId, eventName, projectCode: selectedProject ?? '', calendarName: activeCalBoardName, boardId: activeCalBoardId, parentEventId: '', eventDate } as CalEvent]);
                        try {
                          const res = await saveCalendarEvent({ eventName, projectCode: selectedProject ?? undefined, calendarName: activeCalBoardName || undefined, boardId: activeCalBoardId || undefined, eventDate, durationHours: 1 });
                          if (res.id) {
                            setEvents(prev => prev.map(e => e.id === tempId ? { ...e, id: res.id, boardId: activeCalBoardId } : e));
                            const dateCol = calDynCols.columns.find(c => c.columnName === 'Fecha y hora');
                            const durCol  = calDynCols.columns.find(c => c.columnName === 'Duración (hrs)');
                            const rId = res.id;
                            if (dateCol) { calDynCols.setCellVal(rId, dateCol.id, { dateValue: eventDate }); await saveCellValue({ boardId: calBoardId, rowId: rId, columnId: dateCol.id, dateValue: eventDate }); }
                            if (durCol)  { calDynCols.setCellVal(rId, durCol.id, { numberValue: 1 }); await saveCellValue({ boardId: calBoardId, rowId: rId, columnId: durCol.id, numberValue: 1 }); }
                            if (selectedProject) {
                              publishRecruitmentRowsChanged({ projectCode: selectedProject, boardId: calBoardId, rowId: rId, changeType: 'created', entityType: 'event' }).catch(() => {});
                            }
                          }
                        } catch { toast.error('Error al crear evento'); setEvents(prev => prev.filter(e => e.id !== tempId)); }
                      }}
                      onEventDelete={id => setDeletingEvent(id)}
                      onEventClick={e => {
                        const full = events.find(ev => ev.id === e.id);
                        if (!full) return;
                        setEditingEvent(full);
                        setOpenEvent(true);
                        if (selectedProject) {
                          setRecGroupsLoading(true);
                          getRecruitmentGroups({ projectCode: selectedProject })
                            .then(d => setRecGroups(d.groups))
                            .catch(() => {})
                            .finally(() => setRecGroupsLoading(false));
                        }
                      }}
                    />
                    </div>
                  );
                })()}
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        </TabsContent>


      </Tabs>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      <Dialog open={openTask} onOpenChange={setOpenTask}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{editingTask?.taskName}</DialogTitle></DialogHeader>
          <div className="space-y-1"><Label>Notas</Label><Textarea rows={5} placeholder="Notas, contexto, links..." value={taskNotes} onChange={e => setTaskNotes(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenTask(false)}>Cancelar</Button>
            <Button onClick={doSaveTask} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EventDetailDialog
        open={openEvent}
        onOpenChange={setOpenEvent}
        editingEvent={editingEvent}
        calBoardId={calBoardId}
        presetLocs={PRESET_LOCS}
        calDynCols={calDynCols}
        recGroups={recGroups}
        recGroupsLoading={recGroupsLoading}
        linkingGroup={linkingGroup}
        setLinkingGroup={setLinkingGroup}
        outlookSyncing={outlookSyncing}
        htmlPreviewOpen={htmlPreviewOpen}
        setHtmlPreviewOpen={setHtmlPreviewOpen}
        onOutlookSync={handleOutlookSync}
        onRecGroupsRefresh={() => {
          if (selectedProject) {
            setRecGroupsLoading(true);
            getRecruitmentGroups({ projectCode: selectedProject })
              .then(d => setRecGroups(d.groups))
              .catch(() => {})
              .finally(() => setRecGroupsLoading(false));
          }
        }}
        onInviteStatusChanged={(evId) => {
          setEvents(prev => prev.map(e => e.id === evId ? { ...e, inviteStatus: 'Por actualizar' } : e));
          setEditingEvent(prev => prev?.id === evId ? { ...prev, inviteStatus: 'Por actualizar' } : prev);
        }}
        onSaved={debouncedSilentReload}
      />

      <InvitePreviewDialog
        open={invitePreviewOpen}
        onOpenChange={setInvitePreviewOpen}
        event={editingEvent}
        outlookSyncing={outlookSyncing}
        onOutlookSync={handleOutlookSync}
      />

      <AlertDialog open={!!deletingTask} onOpenChange={o => !o && setDeletingTask(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar tarea?</AlertDialogTitle><AlertDialogDescription>Se eliminarán también los elementos hijos.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={doDeleteTask} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeletingIds.length > 0} onOpenChange={o => !o && setBulkDeletingIds([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {bulkDeletingIds.length} tarea{bulkDeletingIds.length !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán también los elementos hijos de cada tarea.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              const ids = [...bulkDeletingIds];
              const prev = tasks;
              const idsSet = new Set(ids);
              setTasks(t => t.filter(x => !idsSet.has(x.id) && !idsSet.has(x.parentTaskId ?? '')));
              setBulkDeletingIds([]);
              toast.success(`${ids.length} tarea${ids.length !== 1 ? 's' : ''} eliminada${ids.length !== 1 ? 's' : ''}`);
              let failed = false;
              for (const id of ids) {
                try { await deleteTask({ id }); } catch { failed = true; }
              }
              if (failed) {
                setTasks(prev);
                debouncedSilentReload();
                toast.error('Algunas tareas no se pudieron eliminar');
              }
            }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingEvent} onOpenChange={o => !o && setDeletingEvent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>¿Eliminar evento?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={doDeleteEvent} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeletingEventIds.length > 0} onOpenChange={o => !o && setBulkDeletingEventIds([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {bulkDeletingEventIds.length} evento{bulkDeletingEventIds.length !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán también los sub-eventos hijos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              const ids = [...bulkDeletingEventIds];
              const prev = events;
              const idsSet = new Set(ids);
              setEvents(e => e.filter(x => !idsSet.has(x.id) && !idsSet.has(x.parentEventId ?? '')));
              setBulkDeletingEventIds([]);
              toast.success(`${ids.length} evento${ids.length !== 1 ? 's' : ''} eliminado${ids.length !== 1 ? 's' : ''}`);
              let failed = false;
              for (const id of ids) {
                try { await deleteCalendarEvent({ id }); } catch { failed = true; }
              }
              if (failed) {
                setEvents(prev);
                debouncedSilentReload();
                toast.error('Algunos eventos no se pudieron eliminar');
              }
            }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Duplicate board dialog ── */}
      <Dialog open={!!duplicatingBoard} onOpenChange={o => { if (!o) { setDuplicatingBoard(null); setDuplicateName(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Duplicar tablero "{duplicatingBoard}"</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se copiarán todas las tareas, columnas, grupos y valores de celda.</p>
          <div className="space-y-1">
            <Label>Nombre del nuevo tablero</Label>
            <Input
              value={duplicateName}
              onChange={e => setDuplicateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDuplicateBoard(); }}
              autoFocus
              placeholder="Nombre del tablero duplicado"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDuplicatingBoard(null); setDuplicateName(''); }}>Cancelar</Button>
            <Button onClick={handleDuplicateBoard} disabled={!duplicateName.trim() || duplicatingLoading} className="gap-1.5">
              {duplicatingLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Duplicando...</> : <><Copy className="w-3.5 h-3.5" /> Duplicar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingBoard} onOpenChange={o => !o && setDeletingBoard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar timeline "{deletingBoard}"?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán las columnas y datos del tablero. Las tareas asociadas no se borran automáticamente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteBoard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Duplicate cal board dialog ── */}
      <Dialog open={!!duplicatingCalBoard} onOpenChange={o => { if (!o) { setDuplicatingCalBoard(null); setDuplicateCalName(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Duplicar calendario "{duplicatingCalBoard}"</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se copiarán todas las actividades, columnas, grupos y valores de celda.</p>
          <div className="space-y-1">
            <Label>Nombre del nuevo calendario</Label>
            <Input
              value={duplicateCalName}
              onChange={e => setDuplicateCalName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDuplicateCalBoard(); }}
              autoFocus
              placeholder="Nombre del calendario duplicado"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDuplicatingCalBoard(null); setDuplicateCalName(''); }}>Cancelar</Button>
            <Button onClick={handleDuplicateCalBoard} disabled={!duplicateCalName.trim() || duplicatingCalLoading} className="gap-1.5">
              {duplicatingCalLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Duplicando...</> : <><Copy className="w-3.5 h-3.5" /> Duplicar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingCalBoard} onOpenChange={o => !o && setDeletingCalBoard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar calendario "{deletingCalBoard}"?</AlertDialogTitle>
            <AlertDialogDescription>Se eliminarán las columnas y datos del calendario. Las actividades asociadas no se borran automáticamente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCalBoard} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* ── Timeline version dialog ── */}
      <Dialog open={timelineVersionDialog} onOpenChange={o => { if (!o) setTimelineVersionDialog(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              Generar timeline Excel
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const proj = projects.find(p => p.projectCode === selectedProject);
            const fullName = proj?.fullName ?? selectedProject ?? '';
            const tematica = (proj as any)?.tematica ?? '';
            const parts = [fullName, tematica, activeBoardName].filter(Boolean);
            const preview = `${parts.join(' - ')} - V${timelineVersionInput || '?'}`;
            return (
              <div className="space-y-3">
                <div className="rounded-lg bg-muted px-3 py-2.5 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Vista previa del nombre
                  </p>
                  <p className="text-[13px] font-mono text-foreground break-all leading-snug">
                    📄 {preview}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-2">
                    Versión
                    {timelineVersionLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                  </Label>
                  <Input
                    value={timelineVersionInput}
                    onChange={e => setTimelineVersionInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && timelineVersionInput.trim()) handleSendTimeline(); }}
                    placeholder="Ej: 1, 2, 1.1..."
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTimelineVersionDialog(false)}>Cancelar</Button>
            <Button
              size="sm"
              onClick={() => { if (timelineVersionInput.trim()) handleSendTimeline(); }}
              disabled={!timelineVersionInput.trim() || timelineLoading}
              className="gap-1.5"
            >
              {timelineLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Procesando...</> : <><BarChart2 className="w-3.5 h-3.5" /> Generar V{timelineVersionInput}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TeamEditDialog
        open={teamEditOpen}
        onOpenChange={setTeamEditOpen}
        teamUsers={teamUsers}
        teamLider={teamLider}
        setTeamLider={setTeamLider}
        teamAnalistas={teamAnalistas}
        setTeamAnalistas={setTeamAnalistas}
        teamModeradores={teamModeradores}
        setTeamModeradores={setTeamModeradores}
        teamAsistentes={teamAsistentes}
        setTeamAsistentes={setTeamAsistentes}
        saving={teamSaving}
        onSave={saveTeam}
      />

      <TimelinePreviewDialog
        open={timelinePreview.open}
        onOpenChange={open => setTimelinePreview(prev => ({ ...prev, open }))}
        fileUrl={timelinePreview.fileUrl}
        projectName={timelinePreview.projectName}
      />

      <TimelinePreviewDialog
        open={calExcelPreview.open}
        onOpenChange={open => setCalExcelPreview(prev => ({ ...prev, open }))}
        fileUrl={calExcelPreview.fileUrl}
        projectName={calExcelPreview.projectName}
      />

      {selectedProject && activeCalBoardId && (
        <CalendarExcelDialog
          open={calExcelDialogOpen}
          onOpenChange={setCalExcelDialogOpen}
          projectCode={selectedProject}
          calendarName={activeCalBoardName}
          boardId={activeCalBoardId}
          projectFullName={projects.find(p => p.projectCode === selectedProject)?.fullName ?? ''}
          projectTematica={(projects.find(p => p.projectCode === selectedProject) as any)?.tematica ?? ''}
          onSuccess={handleCalExcelSuccess}
        />
      )}
    </div>
  );
}
