import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Copy, X } from 'lucide-react';
import type { BoardObj } from './pmTypes';

interface BoardBadge {
  version?: number;
  url?: string;
  status?: string;
}

interface BoardTabsBarProps {
  boards: string[];
  boardObjects?: BoardObj[];
  activeBoard: string;
  onActiveBoardChange: (board: string) => void;
  adding: boolean;
  setAdding: (v: boolean) => void;
  newBoardName: string;
  setNewBoardName: (v: string) => void;
  onAddBoard: () => void;
  onDuplicateBoard: (boardName: string) => void;
  onDeleteBoard: (boardIdOrName: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onRenameBoard?: (keyOrOldName: string, newName: string) => void;
  addLabel: string;
  inputPlaceholder: string;
  getBadge?: (keyOrName: string) => BoardBadge | undefined;
}

export function BoardTabsBar({
  boards,
  boardObjects,
  activeBoard,
  onActiveBoardChange,
  adding,
  setAdding,
  newBoardName,
  setNewBoardName,
  onAddBoard,
  onDuplicateBoard,
  onDeleteBoard,
  onReorder,
  onRenameBoard,
  addLabel,
  inputPlaceholder,
  getBadge,
}: BoardTabsBarProps) {
  const dragIdxRef = useRef<number>(-1);
  const [dragOverIdx, setDragOverIdx] = useState<number>(-1);
  // editingBoard stores the item key (UUID when boardObjects present, name otherwise)
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Unified items array: key for identity, label for display
  const items = boardObjects
    ? boardObjects.map(b => ({ key: b.id, label: b.name }))
    : boards.map(b => ({ key: b, label: b }));

  const displayItems = items;

  const startEdit = (key: string, label: string) => {
    setEditingBoard(key);
    setEditingValue(label);
  };

  const commitEdit = (key: string, originalLabel: string) => {
    const trimmed = editingValue.trim();
    setEditingBoard(null);
    if (trimmed && trimmed !== originalLabel) {
      onRenameBoard?.(key, trimmed);
    }
  };

  const cancelEdit = () => {
    setEditingBoard(null);
    setEditingValue('');
  };

  return (
    <div className="flex items-center gap-0.5 px-4 pt-3 border-b border-border bg-card overflow-x-auto flex-shrink-0 min-w-0 scrollbar-thin">
      {displayItems.map((item, idx) => {
        const isDropTarget = dragOverIdx === idx && dragIdxRef.current !== idx;
        const badge = getBadge?.(item.key);
        const isEditing = editingBoard === item.key;
        return (
          <div
            key={item.key}
            draggable={!isEditing}
            onDragStart={e => { dragIdxRef.current = idx; e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
            onDragLeave={() => setDragOverIdx(-1)}
            onDrop={e => { e.preventDefault(); onReorder(dragIdxRef.current, idx); setDragOverIdx(-1); }}
            onDragEnd={() => { dragIdxRef.current = -1; setDragOverIdx(-1); }}
            className={`group/tab flex-shrink-0 flex items-center border-b-2 transition-colors whitespace-nowrap ${isEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'} relative ${
              activeBoard === item.key ? 'border-primary' : 'border-transparent'
            } ${isDropTarget ? 'border-l-2 border-l-primary' : ''}`}
          >
            {isEditing ? (
              <Input
                className="h-7 w-32 text-sm px-2 my-1 mx-1"
                value={editingValue}
                onChange={e => setEditingValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(item.key, item.label); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
                onBlur={() => commitEdit(item.key, item.label)}
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <button
                onClick={() => onActiveBoardChange(item.key)}
                onDoubleClick={e => { e.preventDefault(); if (onRenameBoard) startEdit(item.key, item.label); }}
                className={`px-3 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activeBoard === item.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                title={`${item.label} · ${item.key.slice(0, 6)}${onRenameBoard ? ' · Doble clic para renombrar' : ''}`}
              >
                {item.label}
                {badge?.version && (
                  <a
                    href={badge.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => { e.stopPropagation(); if (!badge.url) e.preventDefault(); }}
                    title={badge.url ? 'Abrir archivo Excel' : `V${badge.version}`}
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors"
                  >
                    V{badge.version} ✓
                  </a>
                )}
              </button>
            )}
            {!isEditing && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); onDuplicateBoard(item.label); }}
                  className="opacity-0 group-hover/tab:opacity-100 transition-opacity p-0.5 rounded text-muted-foreground/40 hover:text-primary hover:bg-primary/10"
                  title={`Duplicar "${item.label}"`}
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteBoard(item.key); }}
                  className="opacity-0 group-hover/tab:opacity-100 transition-opacity p-0.5 mr-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                  title={`Eliminar "${item.label}"`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        );
      })}

      {adding ? (
        <div className="flex items-center gap-1 px-2 py-1 flex-shrink-0">
          <Input
            className="h-7 w-36 text-xs"
            placeholder={inputPlaceholder}
            value={newBoardName}
            onChange={e => setNewBoardName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onAddBoard();
              if (e.key === 'Escape') setAdding(false);
            }}
            autoFocus
          />
          <Button size="sm" className="h-7 text-xs px-2" onClick={onAddBoard}>OK</Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setAdding(false)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 flex-shrink-0 whitespace-nowrap transition-colors"
        >
          <Plus className="w-3 h-3" /> {addLabel}
        </button>
      )}
    </div>
  );
}
