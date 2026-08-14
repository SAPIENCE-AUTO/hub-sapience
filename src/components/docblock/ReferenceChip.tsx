import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ReactCustomInlineContentRenderProps } from '@blocknote/react';
import type { docSchema } from './docSchema';

type Props = ReactCustomInlineContentRenderProps<
  { type: 'reference'; content: 'none'; propSchema: any },
  typeof docSchema.styleSchema
>;

const META: Record<string, { icon: string; className: string; sigil: string }> = {
  user:    { icon: '👤', className: 'bg-chart-1/15 text-chart-1',    sigil: '@' },
  project: { icon: '📁', className: 'bg-chart-2/15 text-chart-2',    sigil: '#' },
  event:   { icon: '📅', className: 'bg-chart-4/15 text-chart-4',    sigil: '!' },
  group:   { icon: '👥', className: 'bg-chart-5/15 text-chart-5',    sigil: '&' },
};

/**
 * Reemplaza el click-en-mención de DocumentCanvas.tsx (handleChipClick): un
 * proyecto navega a Proyectos, el resto solo confirma con un toast — mismo
 * comportamiento de hoy (no había lógica fina por refId que preservar).
 */
export default function ReferenceChip({ inlineContent }: Props) {
  const navigate = useNavigate();
  const { refType, label } = inlineContent.props as { refType: string; refId: string; label: string };
  const meta = META[refType] ?? META.user;

  const handleClick = () => {
    if (refType === 'project') navigate('/operacion/proyectos');
    else if (refType === 'user') toast.info(`@${label}`, { description: 'Persona mencionada en este documento' });
    else if (refType === 'event') toast.info(`!${label}`, { description: 'Evento mencionado en este documento' });
    else if (refType === 'group') toast.info(`&${label}`, { description: 'Grupo mencionado en este documento' });
  };

  return (
    <span
      onClick={handleClick}
      contentEditable={false}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-sm font-medium cursor-pointer align-baseline ${meta.className}`}
    >
      <span>{meta.icon}</span>
      {label}
    </span>
  );
}
