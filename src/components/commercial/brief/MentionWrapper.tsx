import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

export interface TriggerState {
  type: 'user' | 'project';
  query: string;
  rect: DOMRect;
}

export interface MentionWrapperRef {
  insert: (token: string) => void;
}

interface Props {
  children: React.ReactNode;
  onTrigger: (state: TriggerState | null) => void;
}

const MentionWrapper = forwardRef<MentionWrapperRef, Props>(
  function MentionWrapper({ children, onTrigger }, ref) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const savedRangeRef = useRef<Range | null>(null);
    const onTriggerRef = useRef(onTrigger);

    // Keep ref up to date without re-running effect
    useEffect(() => { onTriggerRef.current = onTrigger; }, [onTrigger]);

    useEffect(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      // Input bubbles up from contenteditable naturally
      const handleInput = (e: Event) => {
        const target = e.target as HTMLElement;
        if (!target.isContentEditable) return;

        const sel = window.getSelection();
        if (!sel?.rangeCount) { onTriggerRef.current(null); return; }

        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) { onTriggerRef.current(null); return; }

        const textBefore = (node.textContent ?? '').slice(0, range.startOffset);
        const match = textBefore.match(/[@#](\w*)$/);

        if (!match) { onTriggerRef.current(null); savedRangeRef.current = null; return; }

        const type = match[0][0] === '@' ? 'user' : 'project';
        const query = match[1];

        // Save range for later insertion
        savedRangeRef.current = range.cloneRange();

        // Get pixel coords of the caret
        const caretRange = range.cloneRange();
        caretRange.collapse(true);
        const rect = caretRange.getBoundingClientRect();

        onTriggerRef.current({ type, query, rect });
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (!target.isContentEditable) return;
        if (e.key === 'Escape' && savedRangeRef.current) {
          onTriggerRef.current(null);
          savedRangeRef.current = null;
        }
      };

      wrapper.addEventListener('input', handleInput);
      wrapper.addEventListener('keydown', handleKeyDown);
      return () => {
        wrapper.removeEventListener('input', handleInput);
        wrapper.removeEventListener('keydown', handleKeyDown);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      insert: (token: string) => {
        const savedRange = savedRangeRef.current;
        if (!savedRange) return;

        const node = savedRange.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return;

        const textBefore = (node.textContent ?? '').slice(0, savedRange.startOffset);
        const match = textBefore.match(/[@#](\w*)$/);
        if (!match) return;

        const triggerStart = savedRange.startOffset - match[0].length;

        // Focus the contenteditable inside
        const editable = wrapperRef.current?.querySelector(
          '[contenteditable="true"]'
        ) as HTMLElement | null;
        editable?.focus();

        // Select the trigger + query text, then replace via execCommand
        const sel = window.getSelection();
        if (!sel) return;

        const replaceRange = document.createRange();
        replaceRange.setStart(node, triggerStart);
        replaceRange.setEnd(node, savedRange.startOffset);
        sel.removeAllRanges();
        sel.addRange(replaceRange);

        document.execCommand('insertText', false, token + ' ');

        onTriggerRef.current(null);
        savedRangeRef.current = null;
      },
    }));

    return (
      <div ref={wrapperRef} className="contents">
        {children}
      </div>
    );
  }
);

export default MentionWrapper;
