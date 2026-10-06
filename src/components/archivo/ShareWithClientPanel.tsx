import { useEffect, useState } from 'react';
import { createArchivedFileShare, getArchivedFileShares, revokeArchivedFileShare } from 'zite-endpoints-sdk';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from './utils';

export type ShareTarget =
  | { scope: 'file'; fileId: string }
  | { scope: 'folder' | 'project'; pathPrefix: string };

interface Share {
  id: string;
  token: string;
  scope: string;
  filesViewed: number;
  nota?: string;
  allowDownload: boolean;
  kind: string;
  expiresAt: string;
  revokedAt?: string;
  createdByEmail: string;
  accessCount: number;
  lastAccessedAt?: string;
}

const DAY_OPTIONS = [7, 30, 90];
const shareLink = (token: string) => `${window.location.origin}/grabacion/${token}`;

const DIRECT_MAX_DAYS = 7;

function shareStatus(s: Share): { label: string; active: boolean } {
  if (s.revokedAt) return { label: 'Revocado', active: false };
  if (new Date(s.expiresAt) <= new Date()) return { label: 'Vencido', active: false };
  return { label: `Vence ${formatDate(s.expiresAt)}`, active: true };
}

async function copyText(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.message('Copia el link a mano desde el recuadro');
  }
}

// Panel "Compartir con cliente": genera links públicos /grabacion/<token> con
// vigencia para un video, una carpeta o un proyecto, y lista/revoca los
// existentes de ese mismo alcance.
export default function ShareWithClientPanel({ target }: { target: ShareTarget }) {
  const targetKey = target.scope === 'file' ? target.fileId : target.pathPrefix;
  const targetQuery = target.scope === 'file' ? { fileId: target.fileId } : { pathPrefix: target.pathPrefix };
  const [shares, setShares] = useState<Share[] | null>(null);
  const [days, setDays] = useState('30');
  const [nota, setNota] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [creating, setCreating] = useState<'page' | 'direct' | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = () => getArchivedFileShares(targetQuery).then(res => setShares(res.shares)).catch(() => setShares([]));
  useEffect(() => { setShares(null); setLastLink(null); load(); }, [targetKey]);

  const [lastLink, setLastLink] = useState<string | null>(null);

  // El portapapeles puede fallar (ventana sin foco, permisos); el link nuevo
  // queda visible abajo para copiarlo a mano.
  const copy = (token: string) => copyText(shareLink(token), 'Link para el cliente copiado');

  const handleCreate = async (direct: boolean) => {
    setCreating(direct ? 'direct' : 'page');
    try {
      const res = await createArchivedFileShare({
        ...targetQuery, scope: target.scope, days: Number(days), nota: nota.trim() || undefined, allowDownload, direct,
      });
      // El link directo no se guarda en ningún lado: solo se puede copiar ahora.
      const link = direct ? res.directUrl : shareLink(res.token);
      setLastLink(link);
      setNota('');
      load();
      await copyText(link, direct ? 'Link directo copiado' : 'Link para el cliente copiado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el link');
    } finally {
      setCreating(null);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await revokeArchivedFileShare({ id });
      toast.success('Link revocado — ya no abre');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo revocar');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Para quién (referencia interna)</Label>
          <Input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej. Danone – Mariana" className="h-8" maxLength={200} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vigencia</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map(d => <SelectItem key={d} value={String(d)}>{d} días</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-xs h-8">
          <Switch checked={allowDownload} onCheckedChange={setAllowDownload} /> Permitir descarga
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-8" onClick={() => handleCreate(false)} disabled={!!creating}>
          {creating === 'page' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Generar y copiar link
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => handleCreate(true)} disabled={!!creating}>
          {creating === 'direct' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Link directo (si el normal no abre)
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        El link directo abre en un dominio de Microsoft, para clientes cuya red bloquea el Hub. No registra aperturas, dura
        máximo {DIRECT_MAX_DAYS} días
        {target.scope === 'file'
          ? ' y no se puede revocar'
          : ' y solo incluye lo archivado hasta hoy'}. Úsalo solo si el link normal no les abre.
      </p>
      {lastLink && (
        <Input readOnly value={lastLink} onFocus={e => e.currentTarget.select()} className="h-8 text-xs font-mono" />
      )}

      {shares && shares.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">
            Links de {target.scope === 'file' ? 'este archivo' : target.scope === 'project' ? 'este proyecto' : 'esta carpeta'}
          </p>
          {shares.map(s => {
            const st = shareStatus(s);
            return (
              <div key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border border-border rounded-md px-2.5 py-1.5 ${st.active ? '' : 'opacity-60'}`}>
                <span className="font-medium truncate min-w-0 flex-1 basis-40">
                  {s.nota || 'Sin nota'}
                  {s.kind === 'direct' && <span className="ml-1.5 font-normal text-amber-600">· directo</span>}
                </span>
                <span className="text-muted-foreground">{st.label}</span>
                {s.kind === 'page' ? (
                  <span className="text-muted-foreground">
                    {s.accessCount} {s.accessCount === 1 ? 'apertura' : 'aperturas'}
                    {s.scope !== 'file' && ` · ${s.filesViewed} ${s.filesViewed === 1 ? 'video visto' : 'videos vistos'}`}
                    {s.lastAccessedAt ? ` · última ${formatDate(s.lastAccessedAt)}` : ''}
                  </span>
                ) : s.scope === 'file' ? (
                  <span className="text-muted-foreground">no revocable</span>
                ) : null}
                <span className="text-muted-foreground truncate" title={s.createdByEmail}>{s.createdByEmail}</span>
                {st.active && (s.kind === 'page' || s.scope !== 'file') && (
                  <span className="flex gap-1 ml-auto">
                    {s.kind === 'page' && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => copy(s.token)}>
                        <Copy className="h-3 w-3" /> Copiar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => handleRevoke(s.id)} disabled={revokingId === s.id}>
                      Revocar
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
