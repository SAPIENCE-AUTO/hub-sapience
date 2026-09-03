import { useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import SwipeCardStack, { type SwipeIdea } from './SwipeCardStack';

interface SwipePreviewModalProps {
  ideas: SwipeIdea[];
  onClose: () => void;
}

/**
 * Ensayo del swipe real para el facilitador — reusa SwipeCardStack tal cual
 * (no una reimplementación aparte) para que sea idéntico a SwipePage.tsx.
 * Nunca manda votos: onVote es no-op y onComplete solo marca el recorrido
 * como terminado para poder repetirlo.
 */
export default function SwipePreviewModal({ ideas, onClose }: SwipePreviewModalProps) {
  const [runKey, setRunKey] = useState(0);
  const [done, setDone] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <button
        onClick={onClose}
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        aria-label="Cerrar preview"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex w-full max-w-[380px] flex-col items-center gap-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">Preview · así lo ve el participante</p>
        <div className="h-[720px] max-h-[80vh] w-full overflow-hidden rounded-[36px] bg-[#0F3D4C] shadow-2xl ring-8 ring-black/40">
          {done ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <p className="text-lg font-semibold text-white">Fin del preview</p>
              <p className="text-sm text-[#8FB6C0]">Así terminaría esta parte para un participante real.</p>
              <button
                onClick={() => { setDone(false); setRunKey((k) => k + 1); }}
                className="mt-2 flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
              >
                <RotateCcw className="h-4 w-4" /> Repetir
              </button>
            </div>
          ) : (
            <SwipeCardStack
              key={runKey}
              ideas={ideas}
              superLikesRestantes={3}
              onVote={() => {}}
              onComplete={() => setDone(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
