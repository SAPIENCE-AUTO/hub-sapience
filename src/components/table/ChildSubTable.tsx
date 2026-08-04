import { useState, type ReactNode } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { DynamicColumnHeaders } from '../DynamicColumns';
import type { DynCols } from '../DynamicColumns';

interface Props {
  children: ReactNode;
  childDynCols: DynCols;
  addingName: string;
  onAddingNameChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  childLabel: string;
  onLabelChange?: (label: string) => void;
}

export function ChildSubTable({
  children, childDynCols, addingName, onAddingNameChange,
  onCommit, onCancel, childLabel, onLabelChange,
}: Props) {
  const [renamingLabel, setRenamingLabel] = useState(false);
  const [labelEdit, setLabelEdit] = useState('');
  const commitLabelRename = (val: string) => {
    if (val.trim()) onLabelChange?.(val.trim());
    setRenamingLabel(false);
  };

  return (
    <div className="ml-8 mr-2 my-1.5 rounded-lg border border-border/40 bg-accent/5 overflow-x-auto">
      <table className="min-w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <thead className="bg-muted/40 border-b border-border/30">
          <tr>
            <th className="w-8 flex-shrink-0" />
            <th className="text-left px-3 py-1 text-xs font-semibold text-muted-foreground min-w-[180px] whitespace-nowrap">
              <div className="flex items-center gap-1 group/clabel">
                {renamingLabel ? (
                  <input
                    autoFocus
                    value={labelEdit}
                    onChange={e => setLabelEdit(e.target.value)}
                    onBlur={() => commitLabelRename(labelEdit)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitLabelRename(labelEdit);
                      if (e.key === 'Escape') setRenamingLabel(false);
                    }}
                    className="bg-transparent border-0 outline-none font-semibold text-muted-foreground text-xs w-full min-w-0"
                  />
                ) : (
                  <>
                    <span>{childLabel}</span>
                    {onLabelChange && (
                      <button
                        onClick={() => { setLabelEdit(childLabel); setRenamingLabel(true); }}
                        className="opacity-0 group-hover/clabel:opacity-100 transition-opacity text-muted-foreground/40 hover:text-muted-foreground ml-1"
                      >
                        <Pencil className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </th>
            <DynamicColumnHeaders dynCols={childDynCols} />
          </tr>
        </thead>
        <tbody>
          {children}
          <tr className="border-t border-dashed border-border/20">
            <td colSpan={childDynCols.columns.length + 3} className="px-3 py-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Plus className="w-3 h-3 opacity-40 flex-shrink-0" />
                <input
                  value={addingName}
                  onChange={e => onAddingNameChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && addingName.trim()) onCommit();
                    if (e.key === 'Escape') onCancel();
                  }}
                  placeholder={`Nuevo/a ${childLabel.toLowerCase()}...  (Enter para crear)`}
                  className="flex-1 bg-transparent outline-none border-0 text-xs placeholder:text-muted-foreground/40"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
