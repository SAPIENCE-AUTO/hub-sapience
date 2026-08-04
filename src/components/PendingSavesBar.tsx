import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { subscribeToPendingSaves, getPendingSaveState } from '../hooks/useDynamicColumns';

export default function PendingSavesBar() {
  const [state, setState] = useState(getPendingSaveState());

  useEffect(() => {
    const unsub = subscribeToPendingSaves(() => {
      setState(getPendingSaveState());
    });
    return unsub;
  }, []);

  const { pending, completed, failed, total } = state;
  const isActive = total > 0;
  const isDone   = isActive && pending === 0;
  const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          key="pending-saves-bar"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0,  opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
        >
          <div className="bg-card border border-border shadow-lg rounded-xl px-4 py-2.5 flex items-center gap-3 min-w-[280px] max-w-sm">
            {/* Icon */}
            {!isDone ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
            ) : failed > 0 ? (
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-chart-2 flex-shrink-0" />
            )}

            {/* Text + bar */}
            <div className="flex-1 min-w-0">
              {!isDone ? (
                <>
                  <p className="text-xs font-medium text-foreground leading-tight">
                    Guardando cambios&hellip;&nbsp;
                    <span className="text-muted-foreground font-normal">
                      {completed + failed} de {total}
                    </span>
                  </p>
                  <Progress value={progress} className="h-1 mt-1.5" />
                </>
              ) : failed > 0 ? (
                <p className="text-xs font-medium text-destructive leading-tight">
                  {failed} cambio{failed !== 1 ? 's' : ''} no se pudi{failed !== 1 ? 'eron' : 'o'} guardar
                </p>
              ) : (
                <p className="text-xs font-medium text-chart-2 leading-tight">
                  Todos los cambios guardados ✓
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
