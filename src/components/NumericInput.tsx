import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';

interface NumericInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
  min?: number;
  disabled?: boolean;
  title?: string;
  formatDisplay?: (value: number) => string;
}

export default function NumericInput({
  value,
  onChange,
  className,
  placeholder = '0',
  min,
  disabled,
  title,
  formatDisplay,
}: NumericInputProps) {
  const [internal, setInternal] = useState(
    value === 0 ? '' : formatDisplay ? formatDisplay(value) : String(value)
  );
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current) {
      if (formatDisplay && value > 0) {
        setInternal(formatDisplay(value));
      } else {
        setInternal(value === 0 ? '' : String(value));
      }
    }
  }, [value]);

  const handleFocus = () => {
    isFocused.current = true;
    setInternal(value === 0 ? '' : String(value));
  };

  const handleBlur = () => {
    isFocused.current = false;
    const parsed = parseFloat(internal.replace(',', '.'));
    if (internal.trim() === '' || isNaN(parsed)) {
      setInternal('');
      onChange(0);
    } else {
      const clamped = min !== undefined ? Math.max(min, parsed) : parsed;
      setInternal(formatDisplay && clamped > 0 ? formatDisplay(clamped) : String(clamped));
      onChange(clamped);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '' || /^-?\d*[.,]?\d*$/.test(raw)) {
      setInternal(raw);
      const parsed = parseFloat(raw.replace(',', '.'));
      if (!isNaN(parsed)) {
        onChange(parsed);
      }
    }
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={internal}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      className={`placeholder:text-muted-foreground/30 ${className ?? ''}`}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
}
