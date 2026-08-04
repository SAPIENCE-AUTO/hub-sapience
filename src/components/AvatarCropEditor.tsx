import { useState, useRef, useCallback, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ImageIcon, Upload, X, ZoomIn } from 'lucide-react';

interface AvatarCropEditorProps {
  currentPhotoUrl?: string;
  onSave: (file: File) => Promise<void>;
}

const DISPLAY = 200;
const CANVAS  = 400;

export default function AvatarCropEditor({ currentPhotoUrl, onSave }: AvatarCropEditorProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imgEl,    setImgEl]    = useState<HTMLImageElement | null>(null);
  const [zoom,     setZoom]     = useState(1);
  const [offset,   setOffset]   = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [currentImgError, setCurrentImgError] = useState(false);

  const dragStart  = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);
      setImageSrc(url);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = url;
  };

  // ── Drag & drop handlers ─────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

  // ── Pan handlers (mouse) ─────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + e.clientX - dragStart.current.mx,
      y: dragStart.current.oy + e.clientY - dragStart.current.my,
    });
  }, []);

  const onMouseUp = useCallback(() => {
    dragStart.current = null;
    setDragging(false);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onMouseMove, onMouseUp]);

  // ── Pan handlers (touch) ─────────────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    dragStart.current = { mx: t.clientX, my: t.clientY, ox: offset.x, oy: offset.y };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragStart.current) return;
    const t = e.touches[0];
    setOffset({
      x: dragStart.current.ox + t.clientX - dragStart.current.mx,
      y: dragStart.current.oy + t.clientY - dragStart.current.my,
    });
  };
  const onTouchEnd = () => { dragStart.current = null; };

  // ── Export ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!imgEl || saving) return;
    setSaving(true);
    try {
      const baseScale = Math.max(DISPLAY / imgEl.naturalWidth, DISPLAY / imgEl.naturalHeight);
      const totalScale = baseScale * zoom;
      const scale2x = CANVAS / DISPLAY;
      const drawW = imgEl.naturalWidth  * totalScale * scale2x;
      const drawH = imgEl.naturalHeight * totalScale * scale2x;
      const drawX = CANVAS / 2 - drawW / 2 + offset.x * scale2x;
      const drawY = CANVAS / 2 - drawH / 2 + offset.y * scale2x;

      const canvas = document.createElement('canvas');
      canvas.width  = CANVAS;
      canvas.height = CANVAS;
      const ctx = canvas.getContext('2d')!;

      // circular clip
      ctx.beginPath();
      ctx.arc(CANVAS / 2, CANVAS / 2, CANVAS / 2, 0, Math.PI * 2);
      ctx.clip();

      ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas export failed')), 'image/jpeg', 0.9);
      });

      const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
      await onSave(file);
    } catch { /* errors surfaced by onSave */ }
    setSaving(false);
  };

  const reset = () => {
    setImageSrc(null);
    setImgEl(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  // ── Drop zone ────────────────────────────────────────────────────────────
  if (!imageSrc || !imgEl) {
    return (
      <div className="flex flex-col gap-3">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileInput} />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed transition-all cursor-pointer py-6 px-4 select-none ${
            isDragOver
              ? 'border-primary bg-primary/8 scale-[1.01]'
              : 'border-border hover:border-primary/50 hover:bg-muted/40'
          }`}
        >
          {/* Current photo preview or icon */}
          {currentPhotoUrl && !currentImgError ? (
            <img
              src={currentPhotoUrl}
              alt="current"
              className="w-14 h-14 rounded-full object-cover ring-2 ring-border opacity-70 mb-0.5"
              onError={() => setCurrentImgError(true)}
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-0.5">
              <ImageIcon className="w-6 h-6 text-muted-foreground" />
            </div>
          )}

          <div className="text-center space-y-0.5">
            <p className="text-xs font-semibold text-foreground">
              {isDragOver ? 'Suelta para cargar' : 'Arrastra una foto aquí'}
            </p>
            <p className="text-[11px] text-muted-foreground">o haz clic para seleccionar</p>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-xs text-muted-foreground mt-0.5">
            <Upload className="w-3 h-3" />
            Seleccionar imagen
          </div>

          <p className="text-[10px] text-muted-foreground/50">JPG, PNG, WEBP — máx. 10 MB</p>
        </div>
      </div>
    );
  }

  // ── Editor ───────────────────────────────────────────────────────────────
  const baseScale = Math.max(DISPLAY / imgEl.naturalWidth, DISPLAY / imgEl.naturalHeight);
  const totalScale = baseScale * zoom;
  const imgW = imgEl.naturalWidth  * totalScale;
  const imgH = imgEl.naturalHeight * totalScale;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Circular preview */}
      <div
        className="relative flex-shrink-0 overflow-hidden rounded-full ring-2 ring-border shadow-inner"
        style={{
          width: DISPLAY,
          height: DISPLAY,
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'hsl(var(--muted))',
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={imageSrc}
          alt="crop preview"
          draggable={false}
          style={{
            position: 'absolute',
            width: imgW,
            height: imgH,
            left: DISPLAY / 2 - imgW / 2 + offset.x,
            top:  DISPLAY / 2 - imgH / 2 + offset.y,
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
        {/* Hint overlay */}
        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-border/40 pointer-events-none" />
      </div>

      <p className="text-[11px] text-muted-foreground -mt-1">
        Arrastra para reposicionar
      </p>

      {/* Zoom slider */}
      <div className="w-full space-y-2">
        <div className="flex items-center gap-2">
          <ZoomIn className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <Slider
            min={1} max={3} step={0.05}
            value={[zoom]}
            onValueChange={([v]) => setZoom(v)}
            className="flex-1"
          />
          <span className="text-[11px] font-mono text-muted-foreground w-8 text-right flex-shrink-0">
            {zoom.toFixed(1)}×
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 w-full">
        <Button
          variant="ghost" size="sm" className="flex-1 gap-1.5"
          onClick={reset} disabled={saving}
        >
          <X className="w-3.5 h-3.5" />
          Cancelar
        </Button>
        <Button
          size="sm" className="flex-1 gap-1.5"
          onClick={handleSave} disabled={saving}
        >
          {saving ? (
            <>
              <span className="w-3 h-3 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin flex-shrink-0" />
              Subiendo...
            </>
          ) : (
            'Guardar foto'
          )}
        </Button>
      </div>
    </div>
  );
}
