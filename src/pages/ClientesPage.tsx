import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { createClient, getClientsCatalog } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Plus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import ClienteFichaDialog from '@/components/clientes/ClienteFichaDialog';
import Pastilla from '@/components/clientes/Pastilla';
import type { ClienteDeLista } from '@/components/clientes/tipos';

type Filtro = 'todos' | 'sin' | 'cobro' | 'fiscal';

// Sin acentos ni mayúsculas, para buscar «Alfa» o «alfa» o «Álfa» y que dé lo mismo.
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const FILTROS: { id: Filtro; texto: string; cuenta: (c: ClienteDeLista) => boolean }[] = [
  { id: 'todos', texto: 'Todos', cuenta: () => true },
  { id: 'sin', texto: 'Sin razón social', cuenta: c => c.entities === 0 },
  { id: 'cobro', texto: 'Falta para cobrar', cuenta: c => c.entities > 0 && c.cobroListo < c.entities },
  { id: 'fiscal', texto: 'Falta para facturar', cuenta: c => c.entities > 0 && c.facturaListo < c.entities },
];

function EstadoDeDatos({ total, listas, listo, falta }: { total: number; listas: number; listo: string; falta: string }) {
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  if (listas >= total) return <Pastilla tono="exito">{listo}</Pastilla>;
  return <Pastilla tono="alerta" title={`${listas} de ${total} razones sociales listas`}>{falta}</Pastilla>;
}

function NuevoClienteDialog({ open, onClose, onCreado }: { open: boolean; onClose: () => void; onCreado: (id: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (open) setNombre(''); }, [open]);

  const guardar = async () => {
    if (nombre.trim().length < 2) return;
    setGuardando(true);
    try {
      const r = await createClient({ name: nombre });
      toast.success('Cliente creado');
      onCreado(r.id);
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo crear el cliente');
    }
    setGuardando(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Nuevo cliente</DialogTitle></DialogHeader>
        <div className="space-y-1.5 py-1">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Nombre del cliente</label>
          <Input className="h-9" value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') guardar(); }} autoFocus placeholder="Como se le dice en el Hub" />
          <p className="text-[11px] text-muted-foreground">Después le agregas sus razones sociales y condiciones de cobro.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={nombre.trim().length < 2 || guardando} className="gap-1.5">
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [clientes, setClientes] = useState<ClienteDeLista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const abierto = params.get('cliente');

  const cargar = useCallback(async () => {
    try {
      const d = await getClientsCatalog({});
      setClientes(d.clients);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo cargar el catálogo de clientes');
      setClientes([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = (id: string) => setParams(p => { const n = new URLSearchParams(p); n.set('cliente', id); return n; }, { replace: true });
  const cerrar = useCallback(() => setParams(p => { const n = new URLSearchParams(p); n.delete('cliente'); return n; }, { replace: true }), [setParams]);

  const filtrados = useMemo(() => {
    const q = plano(busqueda.trim());
    const elegido = FILTROS.find(f => f.id === filtro)!;
    return clientes.filter(c => elegido.cuenta(c) && (!q || plano(c.name).includes(q)));
  }, [clientes, busqueda, filtro]);

  // Este módulo solo aparece en el menú para Owner o Finanzas (Layout.tsx), pero el candado real está en cada endpoint.
  if (user && user.role !== 'Owner' && user.purchaseLevel !== 'Finanzas') {
    return <div className="p-6"><p className="text-sm text-muted-foreground">No tienes permisos para ver este módulo.</p></div>;
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-primary" /> Clientes</h2>
          <p className="text-sm text-muted-foreground">{filtrados.length} de {clientes.length} clientes</p>
        </div>
        <Button className="gap-1.5" onClick={() => setNuevoAbierto(true)}><Plus className="w-4 h-4" />Nuevo cliente</Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input className="pl-9 h-9" placeholder="Buscar cliente..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map(f => {
            const n = clientes.filter(f.cuenta).length;
            const activo = filtro === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${activo ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-foreground hover:bg-muted/50'}`}
              >
                {f.texto}<span className={activo ? 'opacity-75' : 'text-muted-foreground'}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {cargando ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">Ningún cliente coincide con la búsqueda.</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Cliente</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Razones sociales</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Cobro</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Datos fiscales</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Contactos</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Deals</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Proyectos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map(c => (
                <tr key={c.id} className="hover:bg-muted/20 cursor-pointer transition-colors" onClick={() => abrir(c.id)}>
                  <td className="px-4 py-2.5 whitespace-nowrap font-medium">
                    <span className="inline-flex items-center gap-2">{c.name}{c.sharpliLinked && <Pastilla tono="info" title="Enlazado con Sharpli">Sharpli</Pastilla>}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.entities}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><EstadoDeDatos total={c.entities} listas={c.cobroListo} listo="Listo" falta="Falta crédito" /></td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><EstadoDeDatos total={c.entities} listas={c.facturaListo} listo="Completos" falta="Incompletos" /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{c.contacts}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{c.deals}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{c.projects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClienteFichaDialog clientId={abierto} onClose={cerrar} onChanged={cargar} />
      <NuevoClienteDialog open={nuevoAbierto} onClose={() => setNuevoAbierto(false)} onCreado={id => { cargar(); abrir(id); }} />
    </div>
  );
}
