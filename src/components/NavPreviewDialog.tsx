import { useEffect, useState } from 'react';
import { LayoutDashboard, MessageSquare, Settings, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAppSettings } from 'zite-endpoints-sdk';
import { NAV_SECTIONS, canSeeSection, canSeeItem, type UserWithAccess, type NavItem } from './Layout';
import { isPageVisible } from '../lib/pageVisibility';

type PreviewUser = UserWithAccess & {
  firstName?: string;
  lastName?: string;
  purchaseLevel?: string;
};

interface Props {
  user: PreviewUser | null;
  open: boolean;
  onClose: () => void;
}

function Row({ item, indent }: { item: Pick<NavItem, 'icon' | 'label'>; indent?: boolean }) {
  const Icon = item.icon;
  return (
    <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 ${indent ? 'pl-7' : ''}`}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{item.label}</span>
    </div>
  );
}

// Reconstruye, del lado del cliente, exactamente el mismo filtrado que
// aplica Layout.tsx (canSeeSection/canSeeItem por rol+acceso, isPageVisible
// por páginas visibles) pero usando los datos del usuario ELEGIDO en vez del
// usuario realmente autenticado — no hay sesión ni permisos que cambien de
// verdad, es solo una reconstrucción visual de qué le mostraría el menú.
export default function NavPreviewDialog({ user, open, onClose }: Props) {
  const [defaultPages, setDefaultPages] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    getAppSettings({}).then(d => setDefaultPages(d.defaultVisiblePages)).catch(() => setDefaultPages([]));
  }, [open]);

  if (!user) return null;

  const userPages = user.visiblePages ?? [];
  const checkVisible = (route: string) => isPageVisible(route, userPages, defaultPages);
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email as string;

  const settingsItem: NavItem = { to: '/configuracion', icon: Settings, label: 'Configuración', roles: ['__settings__'] };
  const canSeeSettings = canSeeItem(settingsItem, user);
  const canSeeImport = user.role === 'Owner' || user.role === 'Socio';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xs gap-0 overflow-hidden p-0">
        <DialogHeader className="px-4 pb-2 pt-4">
          <DialogTitle className="text-sm">Navegación de {fullName}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-0.5 overflow-y-auto bg-sidebar px-2 py-3">
          {checkVisible('/dashboard') && <Row item={{ icon: LayoutDashboard, label: 'Dashboard' }} />}
          {checkVisible('/chat') && <Row item={{ icon: MessageSquare, label: 'Chat' }} />}

          <div className="my-2 border-t border-sidebar-border" />

          {NAV_SECTIONS.filter(s => canSeeSection(s, user)).map(section => {
            const items = section.items.filter(item => canSeeItem(item, user) && checkVisible(item.to));
            if (items.length === 0) return null;
            return (
              <div key={section.id} className="mb-1">
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
                  <section.icon className="h-3.5 w-3.5" /> {section.label}
                </div>
                {items.map(item => <Row key={item.to} item={item} indent />)}
              </div>
            );
          })}

          {canSeeSettings && (
            <>
              <div className="my-2 border-t border-sidebar-border" />
              <Row item={{ icon: Settings, label: 'Configuración' }} />
            </>
          )}
          {canSeeImport && <Row item={{ icon: Upload, label: 'Importar datos' }} />}
        </div>

        <p className="border-t px-4 py-3 text-[11px] leading-snug text-muted-foreground">
          Solo previsualiza qué pestañas verían en el menú — no simula qué datos verían dentro de cada página.
        </p>
      </DialogContent>
    </Dialog>
  );
}
