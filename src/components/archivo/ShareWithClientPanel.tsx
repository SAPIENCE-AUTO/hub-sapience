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

interface Share {
  id: string;
  token: string;
  nota?: string;
  allowDownload: boolean;
  expiresAt: string;
  revokedAt?: string;
  createdByEmail: string;
  accessCount: number;
  lastAccessedAt?: string;
}

const DAY_OPTIONS = [7, 30, 90];
const shareLink = (token: string) => `${window.location.origin}/grabacion/${token}`;

function shareStatus(s: Share): { label: string; active: boolean } {
  if (s.revokedAt) return { label: 'Revocado', active: false };
  if (new Date(s.expiresAt) <= new Date()) return { label: 'Vencido', active: false };
  return { label: `Vence ${formatDate(s.expiresAt)}`, active: true };
}

// Panel "Compartir con cliente" dentro del reproductor: genera links públicos
// /grabacion/<token> con vigencia, y lista/revoca los existentes.
export default function ShareWithClientPanel({ fileId }: { fileId: string }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [days, setDays] = useState('30');
  const [nota, setNota] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = () => getArchivedFileShares({ fileId }).then(res => setShares(res.shares)).catch(() => setShares([]));
  useEffect(() => { setShares(null); setLastLink(null); load(); }, [fileId]);

  const [lastLink, setLastLink] = useState<string | null>(null);

  // El portapapeles puede fallar (ventana sin foco, permisos); el link nuevo
  // queda visible abajo para copiarlo a mano.
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareLink(token));
      toast.success('Link para el cliente copiado');
    } catch {
      toast.message('Copia el link a mano desde el recuadro');
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createArchivedFileShare({ fileId, days: Number(days), nota: nota.trim() || undefined, allowDownload });
      setLastLink(shareLink(res.token));
      setNota('');
      load();
      await copy(res.token);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el link');
    } finally {
      setCreating(false);
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
      <Button size="sm" className="h-8" onClick={handleCreate} disabled={creating}>
        {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
        Generar y copiar link
      </Button>
      {lastLink && (
        <Input readOnly value={lastLink} onFocus={e => e.currentTarget.select()} className="h-8 text-xs font-mono" />
      )}

      {shares && shares.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Links de este archivo</p>
          {shares.map(s => {
            const st = shareStatus(s);
            return (
              <div key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border border-border rounded-md px-2.5 py-1.5 ${st.active ? '' : 'opacity-60'}`}>
                <span className="font-medium truncate min-w-0 flex-1 basis-40">{s.nota || 'Sin nota'}</span>
                <span className="text-muted-foreground">{st.label}</span>
                <span className="text-muted-foreground">
                  {s.accessCount} {s.accessCount === 1 ? 'apertura' : 'aperturas'}{s.lastAccessedAt ? ` · última ${formatDate(s.lastAccessedAt)}` : ''}
                </span>
                <span className="text-muted-foreground truncate" title={s.createdByEmail}>{s.createdByEmail}</span>
                {st.active && (
                  <span className="flex gap-1 ml-auto">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => copy(s.token)}>
                      <Copy className="h-3 w-3" /> Copiar
                    </Button>
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
