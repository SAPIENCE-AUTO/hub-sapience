import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { useState, useEffect, useRef } from 'react';
import { uploadFile } from 'zite-file-upload-sdk';
import {
  LayoutDashboard, Briefcase, ReceiptText,
  FolderKanban, ChevronDown, ChevronRight, Search,
  Plus, X, TrendingUp, Building2, DollarSign, LayoutGrid,
  FileText, ShoppingCart, Truck, FileSpreadsheet,
  CreditCard, BarChart3, PieChart, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings, Upload, Menu, FlaskConical,
} from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { useAuth } from 'zite-auth-sdk';
import { getProjects, getUnreadCounts, getChatConversations, permanentlyDelete, getPoNotifications, getAppSettings, uploadProfilePhoto, GetProjectsOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isPageVisible, ROUTE_TO_PAGE_KEY } from '../lib/pageVisibility';
import PendingSavesBar from './PendingSavesBar';
import AvatarCropEditor from './AvatarCropEditor';
import { useRealtimeUserNotifications, ConversationCreatedPayload } from '../hooks/useRealtimeUserNotifications';
import { playChatDing, showChatBrowserNotification, shouldPlayDing, unlockAudio } from '../lib/chatNotifications';
import ChatPage from '../pages/ChatPage';

// ── Avatar gradient helpers ───────────────────────────────────────────────────
const LAYOUT_AVATAR_GRADIENTS: [string, string][] = [
  ['hsl(220,85%,55%)', 'hsl(250,80%,65%)'],
  ['hsl(260,75%,60%)', 'hsl(290,70%,65%)'],
  ['hsl(340,80%,55%)', 'hsl(10,85%,60%)'],
  ['hsl(15,90%,55%)',  'hsl(35,90%,55%)'],
  ['hsl(160,70%,38%)', 'hsl(190,75%,45%)'],
  ['hsl(185,80%,40%)', 'hsl(215,80%,55%)'],
  ['hsl(40,90%,48%)',  'hsl(20,90%,55%)'],
  ['hsl(280,75%,58%)', 'hsl(320,75%,60%)'],
  ['hsl(320,75%,55%)', 'hsl(350,80%,60%)'],
  ['hsl(100,60%,38%)', 'hsl(145,65%,42%)'],
  ['hsl(195,85%,42%)', 'hsl(225,80%,58%)'],
  ['hsl(25,85%,50%)',  'hsl(50,90%,48%)'],
  ['hsl(350,80%,52%)', 'hsl(280,75%,60%)'],
  ['hsl(150,65%,36%)', 'hsl(175,75%,42%)'],
];

function layoutHashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function layoutAvatarGradient(email?: string): React.CSSProperties {
  const key = email ?? '?';
  const [from, to] = LAYOUT_AVATAR_GRADIENTS[layoutHashStr(key) % LAYOUT_AVATAR_GRADIENTS.length];
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}

type Project = GetProjectsOutputType['projects'][0];
type LucideIcon = React.ComponentType<{ className?: string }>;

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  roles?: string[];
}

interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  items: NavItem[];
}

const ALL_ROLES = ['Owner', 'Socio', 'Head', 'Líder', 'Coordinador', 'Analista'];

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'comercial',
    label: 'Comercial',
    icon: TrendingUp,
    roles: ALL_ROLES,
    items: [
      { to: '/comercial/crm',          icon: Briefcase,       label: 'CRM / Deals' },
      { to: '/comercial/dashboard',    icon: BarChart3,       label: 'Dashboard comercial' },
      { to: '/comercial/cotizaciones', icon: FileSpreadsheet, label: 'Cotizaciones' },
    ],
  },
  {
    id: 'operacion',
    label: 'Operación',
    icon: Building2,
    roles: ALL_ROLES,
    items: [
      { to: '/operacion/proyectos', icon: FolderKanban, label: 'Proyectos' },
    ],
  },
  {
    id: 'admin',
    label: 'Administración',
    icon: ReceiptText,
    roles: ALL_ROLES,
    items: [
      { to: '/admin/ordenes',     icon: ShoppingCart, label: 'Órdenes de compra' },
      { to: '/admin/proveedores', icon: Truck,        label: 'Proveedores' },
      { to: '/admin/pagos',       icon: CreditCard,   label: 'Pagos a proveedores' },
      { to: '/admin/facturas-proveedores', icon: ReceiptText, label: 'Facturas de proveedores' },
      { to: '/admin/cobranza',    icon: FileText,     label: 'Cobranza' },
      { to: '/admin/gastos',      icon: ReceiptText,  label: 'Comprobación de gastos' },
    ],
  },
  {
    id: 'finanzas',
    label: 'Finanzas',
    icon: DollarSign,
    roles: ALL_ROLES,
    items: [
      { to: '/finanzas/costos',    icon: PieChart,    label: 'Costos por proyecto' },
      { to: '/finanzas/dashboard', icon: BarChart3,   label: 'Dashboard financiero' },
    ],
  },
  {
    id: 'otros',
    label: 'Otros',
    icon: LayoutGrid,
    roles: ALL_ROLES,
    items: [
      { to: '/tableros', icon: LayoutGrid, label: 'Tableros flexibles' },
      { to: '/sharpli-test', icon: FlaskConical, label: 'Sharpli Test' },
    ],
  },
];

// ── Chat badge helpers ────────────────────────────────────────────────────────
// DM conversations have UUID-format IDs (not project codes like "BRIDGE")
const isDmChannel = (ch: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ch);

// Returns true if any channel with unread messages is a mention or DM
const computeHasMentionOrDM = (): boolean => {
  try {
    const counts: Record<string, number> = JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}');
    const mentions = new Set<string>(JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]'));
    return Object.entries(counts).some(([ch, n]) => n > 0 && (mentions.has(ch) || isDmChannel(ch)));
  } catch { return false; }
};

const statusDot: Record<string, string> = {
  'En curso':   'bg-emerald-400',
  'Prospecto':  'bg-amber-400',
  'Finalizado': 'bg-slate-400',
  'Cancelado':  'bg-rose-400',
};

type UserWithAccess = {
  role?: string;
  accessComercial?: string;
  accessOperacion?: string;
  accessAdmin?: string;
  accessFinanzas?: string;
  accessOtros?: string;
  visiblePages?: string[];
  [key: string]: unknown;
};

function isAdmin(user?: UserWithAccess) {
  if (!user) return false;
  return user.role === 'Owner' || user.role === 'Socio' ||
    user.accessComercial === 'Administrar' ||
    user.accessOperacion === 'Administrar' ||
    user.accessAdmin === 'Administrar' ||
    user.accessFinanzas === 'Administrar' ||
    user.accessOtros === 'Administrar';
}

const SECTION_ACCESS_FIELD: Record<string, keyof UserWithAccess> = {
  comercial: 'accessComercial',
  operacion: 'accessOperacion',
  admin:     'accessAdmin',
  finanzas:  'accessFinanzas',
  otros:     'accessOtros',
};

function canSeeSection(section: NavSection, user?: UserWithAccess) {
  if (!user) return true;
  if (user.role === 'Owner' || user.role === 'Socio') return true;
  const field = SECTION_ACCESS_FIELD[section.id];
  if (!field) return true;
  const val = user[field] as string | undefined;
  return !!val && val !== 'Sin acceso';
}

function canSeeItem(item: NavItem, user?: UserWithAccess) {
  if (!item.roles) return true;
  if (item.roles.includes('__admin__')) return isAdmin(user);
  if (item.roles.includes('__settings__')) {
    if (!user) return false;
    return user.role === 'Owner' || user.role === 'Socio' ||
      (user as { purchaseLevel?: string }).purchaseLevel === 'Socios' ||
      (user as { purchaseLevel?: string }).purchaseLevel === 'Finanzas';
  }
  return true;
}

function getSectionForPath(path: string): string | null {
  if (path.startsWith('/operacion/')) return 'operacion';
  if (path.startsWith('/configuracion')) return null;
  for (const section of NAV_SECTIONS) {
    if (section.items.some(item => path.startsWith(item.to))) return section.id;
  }
  return null;
}

// ── Sidebar nav section component ────────────────────────────────────────────
function SidebarSection({
  section, isOpen, onToggle, user, badges, userPages, defaultPages,
}: {
  section: NavSection;
  isOpen: boolean;
  onToggle: () => void;
  user?: UserWithAccess;
  badges?: Record<string, number>;
  userPages: string[];
  defaultPages: string[];
}) {
  const visibleItems = section.items.filter(
    item => canSeeItem(item, user) && isPageVisible(item.to, userPages, defaultPages)
  );
  if (visibleItems.length === 0) return null;
  const Icon = section.icon;

  const sectionBadgeCount = badges
    ? visibleItems.reduce((sum, item) => sum + (badges[item.to] ?? 0), 0)
    : 0;

  return (
    <div className="mb-0.5">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors group"
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-widest flex-1 text-left">
          {section.label}
        </span>
        {!isOpen && sectionBadgeCount > 0 && (
          <span className="min-w-[16px] h-[16px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-1">
            {sectionBadgeCount > 9 ? '9+' : sectionBadgeCount}
          </span>
        )}
        {isOpen
          ? <ChevronDown className="w-3 h-3 opacity-60" />
          : <ChevronRight className="w-3 h-3 opacity-60" />
        }
      </button>

      {isOpen && (
        <div className="mt-0.5 space-y-0.5">
          {visibleItems.map(item => {
            const ItemIcon = item.icon;
            const badgeCount = badges?.[item.to] ?? 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 pl-7 pr-3 py-1.5 rounded-lg text-sm transition-all duration-100 ${
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`
                }
              >
                <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate flex-1">{item.label}</span>
                {badgeCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-1">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────
export default function Layout() {
  const { user, isLoading, loginWithRedirect, logout } = useAuth();
  const { selectedProject, setSelectedProject, projects, setProjects, projectsLoading: loadingProjects, setProjectsLoading } = useProject();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [localPhotoUrl, setLocalPhotoUrl] = useState<string | undefined>(undefined);
  const [unreadTotal, setUnreadTotal] = useState(() => {
    try {
      const counts: Record<string, number> = JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}');
      return Object.values(counts).reduce((s, c) => s + c, 0);
    } catch { return 0; }
  });
  const [hasMentionOrDM, setHasMentionOrDM] = useState(() => computeHasMentionOrDM());
  const [poNotifIds, setPoNotifIds] = useState<string[]>([]);
  const [globalDefaultPages, setGlobalDefaultPages] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sidebarImgError, setSidebarImgError] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    window.matchMedia('(min-width: 768px)').matches
  );
  // Tracks whether we've already unlocked the Audio singleton with a user gesture
  const audioUnlockedRef = useRef(false);
  // Sync isDesktop with the viewport
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Reset img error when photo URL changes (must be before early return to obey Rules of Hooks)
  useEffect(() => { setSidebarImgError(false); }, [localPhotoUrl]);

  const handleAvatarSave = async (file: File) => {
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: 'avatar.jpg' });
      await uploadProfilePhoto({ photoUrl: fileUrl });
      setLocalPhotoUrl(fileUrl);
      setSidebarImgError(false);
      toast.success('Foto de perfil actualizada');
    } catch {
      toast.error('Error al subir la foto');
    }
  };

  const computePoCount = (ids: string[]) => {
    try {
      const seen: string[] = JSON.parse(localStorage.getItem('po-seen-ids') ?? '[]');
      const seenSet = new Set(seen);
      return ids.filter(id => !seenSet.has(id)).length;
    } catch { return 0; }
  };
  const poNotifCount = computePoCount(poNotifIds);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const location = useLocation();
  const navigate = useNavigate();

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  };

  const initialOpen = getSectionForPath(location.pathname);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    initialOpen ? { [initialOpen]: true } : { operacion: true }
  );

  const toggleSection = (id: string) =>
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    const active = getSectionForPath(location.pathname);
    if (active) setOpenSections(prev => ({ ...prev, [active]: true }));
  }, [location.pathname]);

  useEffect(() => {
    if (!user?.email) return;
    getAppSettings({})
      .then(d => { setGlobalDefaultPages(d.defaultVisiblePages); setSettingsLoaded(true); })
      .catch(() => setSettingsLoaded(true));
    // Stagger getProjects 1.5s after mount to avoid rate-limiting alongside page-level fetches
    const projectsTimer = setTimeout(() => {
      getProjects({}).then(data => {
        setProjects(data.projects);
        setProjectsLoading(false);
      }).catch(() => setProjectsLoading(false));
    }, 1500);
    const lastCleanup = localStorage.getItem('last-cleanup');
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (!lastCleanup || Date.now() - Number(lastCleanup) > oneDayMs) {
      localStorage.setItem('last-cleanup', String(Date.now()));
      permanentlyDelete({}).catch(() => {/* silent */});
    }
    return () => clearTimeout(projectsTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  // Track current path via ref so fetchUnread can read it without being in deps
  const pathnameRef = useRef(location.pathname);
  useEffect(() => { pathnameRef.current = location.pathname; }, [location.pathname]);

  useEffect(() => {
    if (!user?.email) return;
    const fetchUnread = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        // Fetch conversations alongside the existing projects list for a complete channel set
        const convs = await getChatConversations({}).catch(() => ({ dms: [], groups: [] }));
        const channels = [
          'general',
          ...projects.filter(p => p.status === 'En curso').map(p => p.projectCode).filter(Boolean) as string[],
          ...convs.dms.map((d: { id: string }) => d.id),
          ...convs.groups.map((g: { id: string }) => g.id),
        ];
        if (channels.length === 0) return;

        const lastRead: Record<string, string> = JSON.parse(localStorage.getItem('chat-last-read') ?? '{}');
        const mentionName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
        const result = await getUnreadCounts({ channels, lastReadTimestamps: lastRead, mentionName });

        // Zero out the channel the user is currently viewing
        const activeChannel = localStorage.getItem('chat-active-channel') ?? '';
        const nextCounts = { ...result.counts };
        if (activeChannel) nextCounts[activeChannel] = 0;

        const total = Object.values(nextCounts).reduce((s, c) => s + c, 0);
        setUnreadTotal(total);
        localStorage.setItem('chat-unread-counts', JSON.stringify(nextCounts));
        window.dispatchEvent(new CustomEvent('chat-unread-counts-updated', { detail: nextCounts }));

        // Store preview data so ChatPage can consume it (sidebar message previews)
        try {
          const prevMsgAt = JSON.parse(localStorage.getItem('chat-last-message-at') ?? '{}');
          const prevMsgPreview = JSON.parse(localStorage.getItem('chat-last-message-preview') ?? '{}');
          localStorage.setItem('chat-last-message-at', JSON.stringify({ ...prevMsgAt, ...result.lastMessageAt }));
          localStorage.setItem('chat-last-message-preview', JSON.stringify({ ...prevMsgPreview, ...result.lastMessagePreview }));
          window.dispatchEvent(new CustomEvent('chat-sidebar-data-updated', {
            detail: { lastMessageAt: result.lastMessageAt ?? {}, lastMessagePreview: result.lastMessagePreview ?? {} },
          }));
        } catch { /* silent */ }

        // Replace mention channels with the authoritative server result
        const mentionSet = new Set<string>(result.mentionChannels ?? []);
        if (activeChannel) mentionSet.delete(activeChannel);
        localStorage.setItem('chat-mention-channels', JSON.stringify([...mentionSet]));
        window.dispatchEvent(new CustomEvent('chat-mention-channels-updated', { detail: [...mentionSet] }));
        setHasMentionOrDM(computeHasMentionOrDM());
      } catch { /* silent */ }
    };
    fetchUnread();
    // Poll every 30 min — Ably handles real-time updates, polling is just a safety net
    const iv = setInterval(fetchUnread, 1800000);
    return () => { clearInterval(iv); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, projects.length]);

  useEffect(() => {
    if (!user) return;
    const fetchPoNotifs = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await getPoNotifications({});
        setPoNotifIds(result.items.map(i => i.id));
      } catch { /* silent */ }
    };
    fetchPoNotifs();
    const iv = setInterval(fetchPoNotifs, 900000);
    const handleSeen = () => setPoNotifIds(prev => [...prev]);
    window.addEventListener('po-seen-updated', handleSeen);
    return () => {
      clearInterval(iv);
      window.removeEventListener('po-seen-updated', handleSeen);
    };
  }, [user]);

  // ── Page visibility (computed before early return so hooks stay consistent) ─
  const userVisiblePages = (user?.visiblePages as string[] | undefined) ?? [];
  const checkPageVisible = (route: string) => isPageVisible(route, userVisiblePages, globalDefaultPages);

  const allNavItems: NavItem[] = NAV_SECTIONS
    .filter(s => canSeeSection(s, user))
    .flatMap(s => s.items.filter(i => canSeeItem(i, user) && checkPageVisible(i.to)));

  const firstVisibleRoute =
    checkPageVisible('/dashboard') ? '/dashboard' :
    checkPageVisible('/chat')      ? '/chat' :
    allNavItems[0]?.to             ?? '/dashboard';

  // ── Smart redirect — must be before early return (Rules of Hooks) ──────────
  useEffect(() => {
    if (!settingsLoaded || !user) return;

    const path = location.pathname;

    const isExempt =
      path === '/configuracion' ||
      path === '/sharpli-test' ||
      path.startsWith('/admin/importar') ||
      path.startsWith('/shared/') ||
      path.startsWith('/portal/') ||
      /^\/operacion\/proyectos\/.+/.test(path);

    if (isExempt) return;

    if (path === '/') {
      navigate(firstVisibleRoute, { replace: true });
      return;
    }

    const pageKey = ROUTE_TO_PAGE_KEY[path];
    if (pageKey && !checkPageVisible(path)) {
      navigate(firstVisibleRoute, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, settingsLoaded, firstVisibleRoute, user]);

  // ── Chat active channel (written by ChatPage, read here for notification filtering) ──
  const [chatActiveChannel, setChatActiveChannel] = useState(() =>
    localStorage.getItem('chat-active-channel') ?? ''
  );
  useEffect(() => {
    // Clear any stale value from a previous session on mount
    localStorage.removeItem('chat-active-channel');
    const handler = () => setChatActiveChannel(localStorage.getItem('chat-active-channel') ?? '');
    window.addEventListener('chat-channel-changed', handler);
    return () => window.removeEventListener('chat-channel-changed', handler);
  }, []);

  const knownConvIdsRef = useRef<Set<string>>(new Set());

  // ── Global chat notifications: sound + browser notification + sidebar badge ──
  const { status: userNotifyStatus } = useRealtimeUserNotifications({
    userEmail: user?.email ?? '',
    activeChannel: chatActiveChannel,
    enabled: !!user?.email,
    onConversationCreated: (payload: ConversationCreatedPayload) => {
      if (knownConvIdsRef.current.has(payload.conversationId)) return;
      knownConvIdsRef.current.add(payload.conversationId);
      window.dispatchEvent(new CustomEvent('chat-conversation-created', { detail: payload }));
      console.log('[layout][conversation.created]', payload.conversationId, payload.conversationType);
    },
    onNewMessage: (payload) => {
      if (!payload.isActiveChannel) {
        // ── Normal case: user is NOT viewing this channel ──
        // Update unread counts in localStorage
        const stored: Record<string, number> = JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}');
        stored[payload.channel] = (stored[payload.channel] ?? 0) + 1;
        localStorage.setItem('chat-unread-counts', JSON.stringify(stored));
        // Update sidebar Chat badge immediately
        setUnreadTotal(Object.values(stored).reduce((s, c) => s + c, 0));
        // Update mention channels
        if (payload.hasMention) {
          const mentions = new Set<string>(JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]'));
          mentions.add(payload.channel);
          localStorage.setItem('chat-mention-channels', JSON.stringify([...mentions]));
        }
        // Urgent if mention or DM
        if (payload.hasMention || isDmChannel(payload.channel)) {
          setHasMentionOrDM(true);
        }
        // Notify ChatPage (if mounted) to update its internal sidebar badges
        window.dispatchEvent(new CustomEvent('chat-unread-updated', {
          detail: { channel: payload.channel, hasMention: payload.hasMention },
        }));
        // Sound — plays for mentions and DMs, respects user's sound toggle
        const isUrgent = payload.hasMention || isDmChannel(payload.channel);
        const soundEnabled = localStorage.getItem('chat-sound-enabled') !== 'false';
        if (soundEnabled && isUrgent && payload.messageId && shouldPlayDing(payload.messageId)) {
          playChatDing();
        }
        // Browser notification — fires for mentions and DMs, independent of sound toggle
        if (isUrgent && payload.messageId && shouldPlayDing(`notif-${payload.messageId}`)) {
          showChatBrowserNotification(payload, chatActiveChannel);
        }
      } else {
        // ── Active channel case: user IS viewing this channel ──
        // Signal ChatPage to fetch new messages immediately (don't play sound / increment badge)
        window.dispatchEvent(new CustomEvent('chat-new-message-signal', {
          detail: { channel: payload.channel, sentAt: payload.sentAt },
        }));
      }

      // Always update last message preview + timestamp (both cases need sidebar ordering)
      if (payload.contentPreview !== undefined || payload.sentAt) {
        try {
          if (payload.contentPreview !== undefined) {
            const prevPreview = JSON.parse(localStorage.getItem('chat-last-message-preview') ?? '{}');
            prevPreview[payload.channel] = {
              content: payload.contentPreview,
              senderName: payload.senderName ?? '',
            };
            localStorage.setItem('chat-last-message-preview', JSON.stringify(prevPreview));
          }
          if (payload.sentAt) {
            const prevAt = JSON.parse(localStorage.getItem('chat-last-message-at') ?? '{}');
            prevAt[payload.channel] = payload.sentAt;
            localStorage.setItem('chat-last-message-at', JSON.stringify(prevAt));
          }
          window.dispatchEvent(new CustomEvent('chat-sidebar-data-updated', {
            detail: {
              lastMessagePreview: payload.contentPreview !== undefined
                ? { [payload.channel]: { content: payload.contentPreview, senderName: payload.senderName ?? '' } }
                : {},
              lastMessageAt: payload.sentAt
                ? { [payload.channel]: payload.sentAt }
                : {},
            },
          }));
        } catch { /* silent */ }
      }
    },
  });

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('chat-user-notify-status-changed', { detail: { status: userNotifyStatus } }));
  }, [userNotifyStatus]);

  // Unlock audio on the first real user gesture (click/keydown/pointer/touch).
  // Must happen via an actual interaction — notification callbacks don't count for Chrome's autoplay policy.
  useEffect(() => {
    if (audioUnlockedRef.current) return;
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      unlockAudio();
      audioUnlockedRef.current = true;
    };
    document.addEventListener('click',       unlock, { once: true, capture: true });
    document.addEventListener('keydown',     unlock, { once: true, capture: true });
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('touchstart',  unlock, { once: true, capture: true, passive: true });
    return () => {
      document.removeEventListener('click',       unlock, { capture: true });
      document.removeEventListener('keydown',     unlock, { capture: true });
      document.removeEventListener('pointerdown', unlock, { capture: true });
      document.removeEventListener('touchstart',  unlock, { capture: true });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request notification permission once (for chat alerts)
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ── Listen for immediate badge updates dispatched by ChatPage ─────────────
  useEffect(() => {
    const handleCountsUpdated = (e: Event) => {
      const counts = (e as CustomEvent<Record<string, number>>).detail ?? {};
      setUnreadTotal(Object.values(counts).reduce((s, c) => s + c, 0));
      // Recompute urgency after counts change (e.g. ChatPage cleared a channel)
      setHasMentionOrDM(computeHasMentionOrDM());
    };
    const handleMentionsUpdated = () => {
      setHasMentionOrDM(computeHasMentionOrDM());
    };
    window.addEventListener('chat-unread-counts-updated', handleCountsUpdated);
    window.addEventListener('chat-mention-channels-updated', handleMentionsUpdated);
    return () => {
      window.removeEventListener('chat-unread-counts-updated', handleCountsUpdated);
      window.removeEventListener('chat-mention-channels-updated', handleMentionsUpdated);
    };
  }, []);

  // ── Browser tab title indicator ────────────────────────────────────────────
  useEffect(() => {
    const BASE_TITLE = 'Sapience';
    const updateTitle = () => {
      try {
        const counts: Record<string, number> = JSON.parse(localStorage.getItem('chat-unread-counts') ?? '{}');
        const total = Object.values(counts).reduce((s, c) => s + c, 0);
        const mentions: string[] = JSON.parse(localStorage.getItem('chat-mention-channels') ?? '[]');
        const hasMentions = Array.isArray(mentions) && mentions.length > 0;
        if (total > 0 && hasMentions) {
          document.title = `💬 (${total}) ${BASE_TITLE}`;
        } else if (total > 0) {
          document.title = `(${total}) ${BASE_TITLE}`;
        } else {
          document.title = BASE_TITLE;
        }
      } catch {
        document.title = BASE_TITLE;
      }
    };

    updateTitle();

    const handleCounts = () => updateTitle();
    const handleMentions = () => updateTitle();
    window.addEventListener('chat-unread-counts-updated', handleCounts);
    window.addEventListener('chat-mention-channels-updated', handleMentions);

    return () => {
      window.removeEventListener('chat-unread-counts-updated', handleCounts);
      window.removeEventListener('chat-mention-channels-updated', handleMentions);
      document.title = BASE_TITLE;
    };
  }, []);

  // ── Auth redirect ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading && !user) {
      loginWithRedirect({ redirectUrl: window.location.href });
    }
  }, [isLoading, user, loginWithRedirect]);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-sidebar">
        <div className="flex flex-col items-center gap-4">
          <img
            src="https://images.fillout.com/orgid-631922/flowpublicid-qcnywdt1sa/widgetid-default/mFJtyswrdg3jzGEgbmrpR9/pasted-image-1774464420367.png"
            alt="Logo" className="h-7 w-auto opacity-80"
          />
          <p className="text-sidebar-foreground/60 text-xs">
            {isLoading ? 'Cargando...' : 'Redirigiendo al login...'}
          </p>
        </div>
      </div>
    );
  }

  const profilePhoto = localPhotoUrl ?? user?.profilePhoto ?? undefined;

  const filtered = projects
    .filter(p =>
      !search ||
      p.projectCode?.toLowerCase().includes(search.toLowerCase()) ||
      p.fullName?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => (a.projectCode ?? '').localeCompare(b.projectCode ?? ''));
  const currentProject = projects.find(p => p.projectCode === selectedProject);

  const getPageTitle = () => {
    const hubMatch = location.pathname.match(/^\/operacion\/proyectos\/(.+)$/);
    if (hubMatch) return `Hub del proyecto`;
    for (const section of NAV_SECTIONS) {
      const item = section.items.find(i => location.pathname.startsWith(i.to));
      if (item) return item.label;
    }
    if (location.pathname === '/dashboard') return 'Dashboard';
    if (location.pathname === '/configuracion') return 'Configuración';
    return 'OpsHub';
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen overflow-hidden">
        <Toaster richColors position="top-right" />

        {/* ── Sidebar ─────────────────────────────────────────── */}
        <aside
          className={`hidden md:flex flex-shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200 overflow-hidden ${
            collapsed ? 'w-14' : 'w-64'
          }`}
        >
          {/* Logo / Toggle row */}
          <div className={`border-b border-sidebar-border flex items-center flex-shrink-0 ${collapsed ? 'justify-center px-0 py-4' : 'px-4 py-4 justify-between'}`}>
            {!collapsed && (
              <img
                src="https://images.fillout.com/orgid-631922/flowpublicid-qcnywdt1sa/widgetid-default/mFJtyswrdg3jzGEgbmrpR9/pasted-image-1774464420367.png"
                alt="Logo" className="h-7 w-auto"
              />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapsed}
                  className={`flex-shrink-0 rounded-md p-1 text-secondary hover:text-secondary/80 hover:bg-sidebar-accent transition-colors ${collapsed ? '' : 'ml-auto'}`}
                >
                  {collapsed
                    ? <PanelLeftOpen className="w-4 h-4" />
                    : <PanelLeftClose className="w-4 h-4" />
                  }
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? 'Expandir menú' : 'Colapsar menú'}</TooltipContent>
            </Tooltip>
          </div>

          {/* Project Selector */}
          {!collapsed ? (
            <div className="px-3 py-3 border-b border-sidebar-border flex-shrink-0">
              <div className="text-[9px] font-bold text-sidebar-foreground/40 uppercase tracking-widest mb-1.5 px-1">
                Proyecto activo
              </div>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-left h-auto py-2 px-2.5 bg-sidebar-accent hover:bg-sidebar-accent/80 text-sidebar-foreground border border-sidebar-border rounded-lg"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {currentProject ? (
                        <>
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[currentProject.status ?? ''] ?? 'bg-slate-400'}`} />
                          <div className="min-w-0">
                            <div className="font-semibold text-[11px] text-sidebar-primary-foreground truncate">
                              {currentProject.projectCode}
                            </div>
                            <div className="text-[10px] text-sidebar-foreground/50 truncate">
                              {currentProject.fullName}
                            </div>
                          </div>
                        </>
                      ) : (
                        <span className="text-sidebar-foreground/40 text-xs">Seleccionar proyecto...</span>
                      )}
                    </div>
                    <ChevronDown className="w-3 h-3 flex-shrink-0 text-sidebar-foreground/40" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <ProjectPopoverContent
                    search={search} setSearch={setSearch}
                    filtered={filtered} loadingProjects={loadingProjects}
                    selectedProject={selectedProject} setSelectedProject={setSelectedProject}
                    setOpen={setOpen} navigate={navigate} statusDot={statusDot}
                  />
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <div className="flex justify-center py-3 border-b border-sidebar-border flex-shrink-0">
              <Popover open={open} onOpenChange={setOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button className="w-8 h-8 rounded-lg bg-sidebar-accent border border-sidebar-border flex items-center justify-center hover:bg-sidebar-accent/80 transition-colors">
                        {currentProject ? (
                          <div className={`w-2.5 h-2.5 rounded-full ${statusDot[currentProject.status ?? ''] ?? 'bg-slate-400'}`} />
                        ) : (
                          <FolderKanban className="w-3.5 h-3.5 text-sidebar-foreground/50" />
                        )}
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {currentProject ? `Proyecto: ${currentProject.projectCode}` : 'Seleccionar proyecto'}
                  </TooltipContent>
                </Tooltip>
                <PopoverContent className="w-64 p-2" side="right" align="start">
                  <ProjectPopoverContent
                    search={search} setSearch={setSearch}
                    filtered={filtered} loadingProjects={loadingProjects}
                    selectedProject={selectedProject} setSelectedProject={setSelectedProject}
                    setOpen={setOpen} navigate={navigate} statusDot={statusDot}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* ── Expanded Nav ─────────────────────────────────── */}
          {!collapsed ? (
            <ScrollArea className="flex-1">
              <nav className="px-2 py-3 space-y-0.5">
                {checkPageVisible('/dashboard') && (
                  <NavLink
                    to="/dashboard"
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-100 ${
                        isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      }`
                    }
                  >
                    <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
                    <span>Dashboard</span>
                  </NavLink>
                )}

                {checkPageVisible('/chat') && (
                  <button
                    onClick={() => setChatOpen(true)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-100 ${
                      chatOpen
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0" />
                    <span>Chat</span>
                    {unreadTotal > 0 && (
                      <span className={`ml-auto min-w-[18px] h-[18px] rounded-full text-[9px] font-bold flex items-center justify-center px-1 ${hasMentionOrDM ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
                        {unreadTotal > 9 ? '9+' : unreadTotal}
                      </span>
                    )}
                  </button>
                )}

                <div className="border-t border-sidebar-border my-2" />

                {NAV_SECTIONS.filter(s => canSeeSection(s, user)).map(section => (
                  <SidebarSection
                    key={section.id}
                    section={section}
                    user={user}
                    isOpen={!!openSections[section.id]}
                    onToggle={() => toggleSection(section.id)}
                    badges={{ '/admin/ordenes': poNotifCount }}
                    userPages={userVisiblePages}
                    defaultPages={globalDefaultPages}
                  />
                ))}

                {canSeeItem({ to: '/configuracion', icon: Settings, label: 'Configuración', roles: ['__settings__'] }, user) && (
                  <>
                    <div className="border-t border-sidebar-border my-2" />
                    <NavLink
                      to="/configuracion"
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-100 ${
                          isActive
                            ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        }`
                      }
                    >
                      <Settings className="w-4 h-4 flex-shrink-0" />
                      <span>Configuración</span>
                    </NavLink>
                  </>
                )}
                {(user.role === 'Owner' || user.role === 'Socio') && (
                  <NavLink
                    to="/admin/importar"
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-100 ${
                        isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      }`
                    }
                  >
                    <Upload className="w-4 h-4 flex-shrink-0" />
                    <span>Importar datos</span>
                  </NavLink>
                )}
              </nav>
            </ScrollArea>
          ) : (
            /* ── Collapsed rail ──────────────────────────────── */
            <ScrollArea className="flex-1">
              <nav className="flex flex-col items-center py-3 gap-1">
                {checkPageVisible('/dashboard') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <NavLink
                        to="/dashboard"
                        className={({ isActive }) =>
                          `w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                            isActive
                              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          }`
                        }
                      >
                        <LayoutDashboard className="w-4 h-4" />
                      </NavLink>
                    </TooltipTrigger>
                    <TooltipContent side="right">Dashboard</TooltipContent>
                  </Tooltip>
                )}

                {checkPageVisible('/chat') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setChatOpen(true)}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors relative ${
                          chatOpen
                            ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        }`}
                      >
                        <MessageSquare className="w-4 h-4" />
                        {unreadTotal > 0 && (
                          <span className={`absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full text-[8px] font-bold flex items-center justify-center px-0.5 ${hasMentionOrDM ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/50 text-background'}`}>
                            {unreadTotal > 9 ? '9+' : unreadTotal}
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Chat</TooltipContent>
                  </Tooltip>
                )}

                <div className="w-6 border-t border-sidebar-border my-1" />

                {allNavItems.map(item => {
                  const Icon = item.icon;
                  const itemBadge = item.to === '/admin/ordenes' ? poNotifCount : 0;
                  return (
                    <Tooltip key={item.to}>
                      <TooltipTrigger asChild>
                        <NavLink
                          to={item.to}
                          className={({ isActive }) =>
                            `w-9 h-9 rounded-lg flex items-center justify-center transition-colors relative ${
                              isActive
                                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                            }`
                          }
                        >
                          <Icon className="w-4 h-4" />
                          {itemBadge > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-destructive text-destructive-foreground text-[8px] font-bold flex items-center justify-center px-0.5">
                              {itemBadge > 9 ? '9+' : itemBadge}
                            </span>
                          )}
                        </NavLink>
                      </TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  );
                })}

                {canSeeItem({ to: '/configuracion', icon: Settings, label: 'Configuración', roles: ['__settings__'] }, user) && (
                  <>
                    <div className="w-6 border-t border-sidebar-border my-1" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <NavLink
                          to="/configuracion"
                          className={({ isActive }) =>
                            `w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                              isActive
                                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                            }`
                          }
                        >
                          <Settings className="w-4 h-4" />
                        </NavLink>
                      </TooltipTrigger>
                      <TooltipContent side="right">Configuración</TooltipContent>
                    </Tooltip>
                  </>
                )}
                {(user.role === 'Owner' || user.role === 'Socio') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <NavLink
                        to="/admin/importar"
                        className={({ isActive }) =>
                          `w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                            isActive
                              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          }`
                        }
                      >
                        <Upload className="w-4 h-4" />
                      </NavLink>
                    </TooltipTrigger>
                    <TooltipContent side="right">Importar datos</TooltipContent>
                  </Tooltip>
                )}
              </nav>
            </ScrollArea>
          )}

          {/* User section */}
          {!collapsed ? (
            <div className="px-3 py-3 border-t border-sidebar-border flex-shrink-0">
              <div className="flex items-center gap-2 px-1">
                <Popover open={profilePopoverOpen} onOpenChange={setProfilePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
                      {profilePhoto && !sidebarImgError ? (
                        <img src={profilePhoto} alt="avatar"
                          className="rounded-full object-cover flex-shrink-0 border border-sidebar-border"
                          style={{ width: 24, height: 24 }}
                          onError={() => setSidebarImgError(true)} />
                      ) : (
                        <div
                          className="rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ width: 24, height: 24, color: '#fff', ...layoutAvatarGradient(user.email) }}
                        >
                          {user.firstName?.[0] ?? user.email?.[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold text-sidebar-primary-foreground truncate">
                          {user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : user.email}
                        </div>
                        <div className="text-[10px] text-sidebar-foreground/40 truncate">{user.role ?? 'Usuario'}</div>
                      </div>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" className="w-64 p-4">
                    <ProfilePopoverContent
                      user={user} profilePhoto={profilePhoto}
                      onSave={handleAvatarSave}
                      onLogout={() => { setProfilePopoverOpen(false); logout({ returnTo: window.location.origin }); }}
                    />
                  </PopoverContent>
                </Popover>
                <button
                  onClick={() => logout({ returnTo: window.location.origin })}
                  title="Cerrar sesión"
                  className="flex-shrink-0 text-sidebar-foreground/30 hover:text-sidebar-foreground/70 transition-colors p-1 rounded"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-3 border-t border-sidebar-border flex-shrink-0">
              <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <button
                        className="rounded-full flex items-center justify-center text-[11px] font-bold hover:opacity-80 transition-opacity overflow-hidden"
                        style={{ width: 32, height: 32, color: '#fff', ...(!(profilePhoto && !sidebarImgError) ? layoutAvatarGradient(user.email) : {}) }}
                      >
                        {profilePhoto && !sidebarImgError ? (
                          <img src={profilePhoto} alt="avatar" className="w-full h-full object-cover"
                            onError={() => setSidebarImgError(true)} />
                        ) : (
                          user.firstName?.[0] ?? user.email?.[0]?.toUpperCase() ?? '?'
                        )}
                      </button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">Cuenta</TooltipContent>
                </Tooltip>
                <PopoverContent className="w-64 p-4" side="right" align="end">
                  <ProfilePopoverContent
                    user={user} profilePhoto={profilePhoto}
                    onSave={handleAvatarSave}
                    onLogout={() => { setUserPopoverOpen(false); logout({ returnTo: window.location.origin }); }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </aside>



        {/* ── Main content ────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-background min-w-0">
          <header className={`flex-shrink-0 h-12 bg-sidebar md:bg-card border-b border-sidebar-border md:border-border flex items-center px-6 gap-3 shadow-xs ${location.pathname.match(/^\/operacion\/proyectos\/.+/) ? 'hidden' : ''}`}>
            <button
              onClick={() => setMoreSheetOpen(true)}
              className="md:hidden -ml-2 mr-1 p-1.5 rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent md:text-muted-foreground md:hover:bg-muted transition-colors flex-shrink-0 flex items-center justify-center"
            >
              <Menu className="w-4 h-4" />
            </button>
            <img
              src="https://images.fillout.com/orgid-631922/flowpublicid-qcnywdt1sa/widgetid-default/mFJtyswrdg3jzGEgbmrpR9/pasted-image-1774464420367.png"
              alt="Sapience"
              className="md:hidden h-6 w-auto"
            />
            <h1 className="hidden md:block font-semibold text-sm text-foreground">{getPageTitle()}</h1>
            {selectedProject && (
              <Badge className="text-[10px] font-semibold tracking-wide bg-sidebar-accent text-sidebar-foreground md:bg-accent md:text-accent-foreground border-0">
                {selectedProject}
              </Badge>
            )}
          </header>
          <div className="flex-1 overflow-auto pb-16 md:pb-0">
            <Outlet />
          </div>
          <PendingSavesBar />
        </main>

        {/* Mobile "Más" Sheet */}
        <Sheet open={moreSheetOpen} onOpenChange={setMoreSheetOpen}>
          <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0 rounded-t-2xl">
            {/* User header */}
            <div className="flex items-center gap-3 px-4 pt-5 pb-3 border-b border-border flex-shrink-0">
              {profilePhoto && !sidebarImgError ? (
                <img src={profilePhoto} alt="avatar"
                  className="rounded-full object-cover flex-shrink-0 border border-border"
                  style={{ width: 36, height: 36 }}
                  onError={() => setSidebarImgError(true)} />
              ) : (
                <div
                  className="rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ width: 36, height: 36, color: '#fff', ...layoutAvatarGradient(user.email) }}
                >
                  {user.firstName?.[0] ?? user.email?.[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">
                  {user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : user.email}
                </div>
                <div className="text-xs text-muted-foreground">{user.role ?? 'Usuario'}</div>
              </div>
            </div>

            {/* Scrollable nav */}
            <ScrollArea className="flex-1">
              <div className="px-3 py-3 space-y-0.5">
                {/* Project selector */}
                <div className="mb-3 px-1">
                  <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Proyecto activo</div>
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between text-left h-auto py-2 px-3 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          {currentProject ? (
                            <>
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[currentProject.status ?? ''] ?? 'bg-slate-400'}`} />
                              <div className="min-w-0">
                                <div className="font-semibold text-xs truncate">{currentProject.projectCode}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{currentProject.fullName}</div>
                              </div>
                            </>
                          ) : (
                            <span className="text-muted-foreground text-xs">Seleccionar proyecto...</span>
                          )}
                        </div>
                        <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-2" align="start" side="top">
                      <ProjectPopoverContent
                        search={search} setSearch={setSearch}
                        filtered={filtered} loadingProjects={loadingProjects}
                        selectedProject={selectedProject} setSelectedProject={setSelectedProject}
                        setOpen={setOpen} navigate={navigate} statusDot={statusDot}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="border-t border-border mb-2" />

                {/* Nav sections */}
                {NAV_SECTIONS.filter(s => canSeeSection(s, user)).map(section => {
                  const visibleItems = section.items.filter(item => canSeeItem(item, user) && checkPageVisible(item.to));
                  if (visibleItems.length === 0) return null;
                  const SIcon = section.icon;
                  return (
                    <div key={section.id} className="mb-0.5">
                      <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        <SIcon className="w-3.5 h-3.5" />
                        {section.label}
                      </div>
                      <div className="space-y-0.5">
                        {visibleItems.map(item => {
                          const IIcon = item.icon;
                          const badge = item.to === '/admin/ordenes' ? poNotifCount : 0;
                          return (
                            <NavLink key={item.to} to={item.to} onClick={() => setMoreSheetOpen(false)}
                              className={({ isActive }) => `flex items-center gap-3 pl-8 pr-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-muted'}`}>
                              <IIcon className="w-4 h-4 flex-shrink-0" />
                              <span className="flex-1">{item.label}</span>
                              {badge > 0 && (
                                <span className="min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center px-1">{badge}</span>
                              )}
                            </NavLink>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {canSeeItem({ to: '/configuracion', icon: Settings, label: 'Configuración', roles: ['__settings__'] }, user) && (
                  <>
                    <div className="border-t border-border my-2" />
                    <NavLink to="/configuracion" onClick={() => setMoreSheetOpen(false)}
                      className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-muted'}`}>
                      <Settings className="w-4 h-4 flex-shrink-0" />
                      <span>Configuración</span>
                    </NavLink>
                  </>
                )}
                {(user.role === 'Owner' || user.role === 'Socio') && (
                  <NavLink to="/admin/importar" onClick={() => setMoreSheetOpen(false)}
                    className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-muted'}`}>
                    <Upload className="w-4 h-4 flex-shrink-0" />
                    <span>Importar datos</span>
                  </NavLink>
                )}
              </div>
            </ScrollArea>

            {/* Logout */}
            <div className="border-t border-border p-3 flex-shrink-0" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
              <button
                onClick={() => { setMoreSheetOpen(false); logout({ returnTo: window.location.origin }); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Cerrar sesión
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Mobile Bottom Tab Bar */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border shadow-lg z-50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-stretch">
            {checkPageVisible('/dashboard') && (
              <NavLink to="/dashboard"
                onClick={() => setChatOpen(false)}
                className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-2.5 flex-1 min-w-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <LayoutDashboard className="w-5 h-5" />
                <span className="text-[10px] font-medium">Dashboard</span>
              </NavLink>
            )}
            {checkPageVisible('/chat') && (
              <button
                onClick={() => setChatOpen(true)}
                className={`flex flex-col items-center gap-0.5 px-2 py-2.5 flex-1 min-w-0 relative transition-colors ${chatOpen ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <div className="relative">
                  <MessageSquare className="w-5 h-5" />
                  {unreadTotal > 0 && (
                    <span className={`absolute -top-1 -right-2 min-w-[14px] h-[14px] rounded-full text-[8px] font-bold flex items-center justify-center px-0.5 ${hasMentionOrDM ? 'bg-destructive text-destructive-foreground' : 'bg-muted-foreground/60 text-background'}`}>
                      {unreadTotal > 9 ? '9+' : unreadTotal}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">Chat</span>
              </button>
            )}
            {checkPageVisible('/operacion/proyectos') && (
              <NavLink to="/operacion/proyectos"
                onClick={() => setChatOpen(false)}
                className={({ isActive }) => `flex flex-col items-center gap-0.5 px-2 py-2.5 flex-1 min-w-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <FolderKanban className="w-5 h-5" />
                <span className="text-[10px] font-medium">Proyectos</span>
              </NavLink>
            )}
            <button
              onClick={() => { setChatOpen(false); setMoreSheetOpen(true); }}
              className={`flex flex-col items-center gap-0.5 px-2 py-2.5 flex-1 min-w-0 transition-colors ${moreSheetOpen ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <LayoutGrid className="w-5 h-5" />
              <span className="text-[10px] font-medium">Más</span>
            </button>
          </div>
        </nav>


      {/* ── Floating Chat Panel ─────────────────────────────── */}
      {/* Only ONE instance of ChatPage is ever mounted — conditional on isDesktop */}
      {chatOpen && isDesktop && (
        <>
          {/* Desktop floating panel — anchored to the right of the sidebar */}
          <div
            className="fixed z-50 flex flex-col bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            style={{
              left: collapsed ? 'calc(3.5rem + 8px)' : 'calc(16rem + 8px)',
              top: '12px',
              bottom: '12px',
              width: collapsed
                ? 'min(900px, calc(100vw - 3.5rem - 24px))'
                : 'min(900px, calc(100vw - 16rem - 24px))',
              transition: 'left 200ms, width 200ms',
            }}
          >
            <button
              onClick={() => setChatOpen(false)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-card/80 backdrop-blur border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
              title="Cerrar chat"
            >
              <X className="w-4 h-4" />
            </button>
            <ChatPage mode="drawer" onClose={() => setChatOpen(false)} />
          </div>
          {/* Backdrop — click outside to close */}
          <div
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => setChatOpen(false)}
          />
        </>
      )}
      {chatOpen && !isDesktop && (
        /* Mobile fullscreen overlay */
        <div className="fixed top-0 left-0 right-0 z-40 bg-background flex flex-col" style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' }}>
          <ChatPage mode="drawer" onClose={() => setChatOpen(false)} />
        </div>
      )}

      </div>
    </TooltipProvider>
  );
}

// ── Profile popover content ───────────────────────────────────────────────────
function ProfilePopoverContent({ user, profilePhoto, onSave, onLogout }: {
  user: { firstName?: string; lastName?: string; email?: string; role?: string };
  profilePhoto?: string;
  onSave: (file: File) => Promise<void>;
  onLogout: () => void;
}) {
  const fullName = user.firstName ? `${user.firstName} ${user.lastName ?? ''}`.trim() : user.email ?? '';

  return (
    <div className="flex flex-col gap-3">
      {/* User info */}
      <div className="text-center pb-1 border-b border-border">
        <div className="text-sm font-semibold leading-tight">{fullName}</div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
        <div className="text-[11px] text-muted-foreground/50 mt-0.5">{user.role ?? 'Usuario'}</div>
      </div>

      {/* Avatar crop editor */}
      <AvatarCropEditor currentPhotoUrl={profilePhoto} onSave={onSave} />

      {/* Logout */}
      <div className="border-t border-border pt-2">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

// ── Extracted project popover content ────────────────────────────────────────
function ProjectPopoverContent({
  search, setSearch, filtered, loadingProjects,
  selectedProject, setSelectedProject, setOpen, navigate, statusDot,
}: {
  search: string;
  setSearch: (v: string) => void;
  filtered: Project[];
  loadingProjects: boolean;
  selectedProject: string | null;
  setSelectedProject: (v: string | null) => void;
  setOpen: (v: boolean) => void;
  navigate: (to: string) => void;
  statusDot: Record<string, string>;
}) {
  return (
    <>
      <div className="flex items-center gap-1 mb-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar proyecto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-7 text-sm border-0 focus-visible:ring-0 p-0"
          autoFocus
        />
      </div>
      {selectedProject && (
        <button
          className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded flex items-center gap-1 mb-1"
          onClick={() => { setSelectedProject(null); setOpen(false); }}
        >
          <X className="w-3 h-3" /> Limpiar selección
        </button>
      )}
      <ScrollArea className="max-h-48">
        {loadingProjects ? (
          <div className="space-y-1 px-1">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">Sin resultados</div>
        ) : (
          filtered.map(p => (
            <button
              key={p.id}
              className={`w-full text-left px-2 py-2 rounded text-sm hover:bg-muted flex items-center gap-2 transition-colors ${
                p.projectCode === selectedProject ? 'bg-accent text-accent-foreground font-semibold' : ''
              }`}
              onClick={() => { setSelectedProject(p.projectCode ?? null); setOpen(false); setSearch(''); navigate(`/operacion/proyectos/${p.projectCode}`); }}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[p.status ?? ''] ?? 'bg-slate-300'}`} />
              <div>
                <div className="font-semibold text-xs">{p.projectCode}</div>
                <div className="text-xs text-muted-foreground truncate">{p.fullName}</div>
              </div>
            </button>
          ))
        )}
      </ScrollArea>
      <div className="border-t mt-2 pt-2">
        <button
          className="w-full text-left px-2 py-1.5 text-xs text-primary hover:bg-accent rounded flex items-center gap-1 transition-colors"
          onClick={() => { setOpen(false); navigate('/operacion/proyectos'); }}
        >
          <Plus className="w-3 h-3" /> Nuevo proyecto
        </button>
      </div>
    </>
  );
}
