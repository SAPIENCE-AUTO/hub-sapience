import { useEffect, useState } from 'react';
import { Bold, Italic, Strikethrough, Code, List, ListOrdered, Heading1, Heading2, Heading3, Pilcrow } from 'lucide-react';
import type { docSchema } from './docSchema';

type Editor = typeof docSchema.BlockNoteEditor;

/**
 * Barra de formato fija arriba (pedida explícitamente en vez de la flotante
 * default de BlockNote). onMouseDown + preventDefault en cada botón es lo que
 * evita el bug de pérdida de foco/selección visto en el POC: sin esto, el
 * navegador mueve el foco al botón ANTES de que corra el onClick, así que
 * editor.getTextCursorPosition()/toggleStyles actúan sobre la posición
 * equivocada.
 */
export default function DocToolbar({ editor }: { editor: Editor }) {
  const [activeStyles, setActiveStyles] = useState<Record<string, any>>({});
  const [activeBlockType, setActiveBlockType] = useState<string>('paragraph');

  useEffect(() => {
    const sync = () => {
      setActiveStyles(editor.getActiveStyles());
      try { setActiveBlockType(editor.getTextCursorPosition().block.type); } catch { /* sin selección aún */ }
    };
    sync();
    return editor.onSelectionChange(sync);
  }, [editor]);

  const btnCls = (active?: boolean) =>
    `p-1.5 rounded hover:bg-gray-100 ${active ? 'bg-gray-200 text-primary' : 'text-foreground'}`;

  const stopFocusLoss = (e: React.MouseEvent) => e.preventDefault();

  const setBlockType = (type: 'paragraph' | 'heading' | 'bulletListItem' | 'numberedListItem', level?: 1 | 2 | 3) => {
    const pos = editor.getTextCursorPosition();
    editor.updateBlock(pos.block, type === 'heading' ? { type, props: { level: level! } } as any : { type } as any);
  };

  return (
    <div className="flex items-center gap-0.5 border-b bg-white px-2 py-1.5 flex-wrap flex-shrink-0">
      <button title="Negrita" onMouseDown={stopFocusLoss} onClick={() => editor.toggleStyles({ bold: true } as any)} className={btnCls(activeStyles.bold)}><Bold className="w-3.5 h-3.5" /></button>
      <button title="Cursiva" onMouseDown={stopFocusLoss} onClick={() => editor.toggleStyles({ italic: true } as any)} className={btnCls(activeStyles.italic)}><Italic className="w-3.5 h-3.5" /></button>
      <button title="Tachado" onMouseDown={stopFocusLoss} onClick={() => editor.toggleStyles({ strike: true } as any)} className={btnCls(activeStyles.strike)}><Strikethrough className="w-3.5 h-3.5" /></button>
      <button title="Código" onMouseDown={stopFocusLoss} onClick={() => editor.toggleStyles({ code: true } as any)} className={btnCls(activeStyles.code)}><Code className="w-3.5 h-3.5" /></button>
      <div className="w-px h-4 bg-gray-200 mx-1" />
      <button title="Título 1" onMouseDown={stopFocusLoss} onClick={() => setBlockType('heading', 1)} className={btnCls(activeBlockType === 'heading')}><Heading1 className="w-3.5 h-3.5" /></button>
      <button title="Título 2" onMouseDown={stopFocusLoss} onClick={() => setBlockType('heading', 2)} className={btnCls(false)}><Heading2 className="w-3.5 h-3.5" /></button>
      <button title="Título 3" onMouseDown={stopFocusLoss} onClick={() => setBlockType('heading', 3)} className={btnCls(false)}><Heading3 className="w-3.5 h-3.5" /></button>
      <button title="Párrafo" onMouseDown={stopFocusLoss} onClick={() => setBlockType('paragraph')} className={btnCls(activeBlockType === 'paragraph')}><Pilcrow className="w-3.5 h-3.5" /></button>
      <div className="w-px h-4 bg-gray-200 mx-1" />
      <button title="Lista con viñetas" onMouseDown={stopFocusLoss} onClick={() => setBlockType('bulletListItem')} className={btnCls(activeBlockType === 'bulletListItem')}><List className="w-3.5 h-3.5" /></button>
      <button title="Lista numerada" onMouseDown={stopFocusLoss} onClick={() => setBlockType('numberedListItem')} className={btnCls(activeBlockType === 'numberedListItem')}><ListOrdered className="w-3.5 h-3.5" /></button>
    </div>
  );
}
