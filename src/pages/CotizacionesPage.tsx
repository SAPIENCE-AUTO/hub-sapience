import { useEffect } from 'react';
import { useAuth } from 'zite-auth-sdk';
import CotizacionesTab from '../components/admin/CotizacionesTab';
import { FileSpreadsheet } from 'lucide-react';

export default function CotizacionesPage() {
  const { user, isLoading, loginWithRedirect } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) loginWithRedirect({ redirectUrl: window.location.href });
  }, [isLoading, user, loginWithRedirect]);

  if (isLoading || !user) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cotizaciones</h1>
          <p className="text-sm text-muted-foreground">Gestión, importación y vinculación de cotizaciones a deals</p>
        </div>
      </div>
      <CotizacionesTab />
    </div>
  );
}
