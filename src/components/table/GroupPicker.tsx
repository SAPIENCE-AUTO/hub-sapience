import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getGroupColor } from './tableUtils';
import type { DynCols } from '../DynamicColumns';
import type { DynColumn } from '../../hooks/useDynamicColumns';

interface Props {
  rowId: string;
  groups: DynColumn[];
  groupDynCols: DynCols;
}

export function GroupPicker({ rowId, groups, groupDynCols }: Props) {
  const currentGroup = groups.find(g => groupDynCols.getCellVal(rowId, g.id)?.textValue === '1');
  const color = currentGroup ? getGroupColor(currentGroup.columnType) : undefined;

  if (groups.length === 0) return <span className="w-3 h-3 flex-shrink-0" />;

  const assign = async (newGroupId: string | null) => {
    // Clear ALL groups for this row to fix phantom assignments
    await Promise.all(groups.filter(g => groupDynCols.getCellVal(rowId, g.id)?.textValue === '1').map(g => groupDynCols.setCellVal(rowId, g.id, { textValue: undefined })));
    if (newGroupId) await groupDynCols.setCellVal(rowId, newGroupId, { textValue: '1' });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={currentGroup ? `Grupo: ${currentGroup.columnName}` : 'Asignar grupo'}
          className={`w-3 h-3 rounded-full flex-shrink-0 transition-transform hover:scale-125 border ${
            currentGroup ? 'border-transparent' : 'border-dashed border-muted-foreground/40'
          }`}
          style={color ? { backgroundColor: color } : {}}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44 p-1">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider px-2 py-1">Asignar a grupo</p>
        <DropdownMenuItem onClick={() => assign(null)} className="text-xs gap-2">
          <div className="w-3 h-3 rounded-full border border-dashed border-muted-foreground/40 flex-shrink-0" />
          Sin grupo
          {!currentGroup && <span className="ml-auto text-primary">✓</span>}
        </DropdownMenuItem>
        <div className="my-1 border-t border-border/30" />
        {groups.map(g => (
          <DropdownMenuItem key={g.id} onClick={() => assign(g.id)} className="text-xs gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getGroupColor(g.columnType) }} />
            <span className="truncate flex-1">{g.columnName}</span>
            {g.id === currentGroup?.id && <span className="ml-auto text-primary">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
