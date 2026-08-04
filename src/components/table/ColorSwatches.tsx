import { GROUP_COLORS } from './tableUtils';

interface Props {
  currentId?: string;
  onPick: (id: string) => void;
}

// 6 families × 5 shades — render column-first so each column is one family
const FAMILIES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const SHADES = [1, 2, 3, 4, 5];

export function ColorSwatches({ currentId, onPick }: Props) {
  const colorMap = Object.fromEntries(GROUP_COLORS.map(c => [c.id, c]));

  return (
    <div className="p-2">
      {/* Column headers — tiny family dots */}
      <div className="grid grid-cols-6 gap-1.5 mb-0.5">
        {FAMILIES.map(f => {
          const mid = colorMap[`${f}-3`];
          return <div key={f} className="w-6 h-1 rounded-full mx-auto opacity-30" style={{ backgroundColor: mid?.color }} />;
        })}
      </div>
      {/* 5 rows × 6 cols — each row is a shade, each col is a family */}
      <div className="grid grid-cols-6 gap-1.5">
        {SHADES.map(shade =>
          FAMILIES.map(family => {
            const c = colorMap[`${family}-${shade}`];
            if (!c) return null;
            return (
              <button
                key={c.id}
                title={c.label}
                onClick={() => onPick(c.id)}
                className={`w-6 h-6 rounded-full transition-all hover:scale-110 ${
                  currentId === c.id ? 'ring-2 ring-offset-1 ring-foreground scale-110' : ''
                }`}
                style={{ backgroundColor: c.color }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
