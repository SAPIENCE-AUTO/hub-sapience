import { GetTasksOutputType } from 'zite-endpoints-sdk';

export type Task = GetTasksOutputType['tasks'][0];
export type CalEvent = GetTasksOutputType['calendarEvents'][0];

export type GanttScale = 'days' | 'weeks' | 'months';

export type BoardGanttGroup = { id: string; name: string; colorId?: string; tasks: Task[]; };

/** Board identity object — used to pass UUID + display name together */
export interface BoardObj {
  id: string;        // UUID from Boards table
  name: string;      // boardName (display label)
  boardType: string; // 'pm' | 'calendar' | 'recruitment'
  boardOrder?: number;
}
