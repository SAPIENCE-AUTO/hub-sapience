import { Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProjectProvider } from './context/ProjectContext';
import { TeamMembersProvider } from './components/DynamicColumns';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import MisPendientesPage from './pages/MisPendientesPage';
import CommercialPage from './pages/CommercialPage';
import CotizacionesPage from './pages/CotizacionesPage';
import AdminPage from './pages/AdminPage';
import SuppliersPage from './pages/SuppliersPage';
import PaymentsPage from './pages/PaymentsPage';
import UserAdminPage from './pages/UserAdminPage';
import PurchasesPage from './pages/PurchasesPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectHubPage from './pages/ProjectHubPage';
import PlaceholderPage from './pages/PlaceholderPage';
import CommercialDashboardPage from './pages/CommercialDashboardPage';
import ProjectCostsPage from './pages/ProjectCostsPage';
import ChatPage from './pages/ChatPage';
import SharedViewPage from './pages/SharedViewPage';
import SupplierPortalPage from './pages/SupplierPortalPage';
import LoginPage from './pages/LoginPage';
import SupplierInvoicesPage from './pages/SupplierInvoicesPage';
import SettingsPage from './pages/SettingsPage';
import DataImportPage from './pages/DataImportPage';
import ExpensesPage from './pages/ExpensesPage';
import MigrationRunnerPage from './pages/MigrationRunnerPage';
import SharpliTestPage from './pages/SharpliTestPage';
import ObservationRoomPage from './pages/ObservationRoomPage';
import SwipePage from './pages/SwipePage';
import EjesPage from './pages/EjesPage';

// ── Error boundary ────────────────────────────────────────────────────────────
interface EBState { hasError: boolean; message: string }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, message: error?.message ?? 'Error desconocido' };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
          <div style={{ textAlign: 'center', padding: '2rem', maxWidth: 400 }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</p>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Algo salió mal</p>
            <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: '1.5rem' }}>{this.state.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false, message: '' }); window.location.reload(); }}
              style={{ padding: '0.5rem 1.5rem', borderRadius: '0.375rem', background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}



export default function App() {
  return (
    <ErrorBoundary>
      <ProjectProvider>
          <TeamMembersProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/shared/:token" element={<SharedViewPage />} />
              <Route path="/portal/:token" element={<SupplierPortalPage />} />
              <Route path="/s/:slug" element={<ObservationRoomPage />} />
              <Route path="/swipe/:codigo" element={<SwipePage />} />
              <Route path="/ejes/:codigo" element={<EjesPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Layout />}>
                <Route index element={null} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="mis-pendientes" element={<MisPendientesPage />} />

                <Route path="comercial/crm"       element={<CommercialPage />} />
                <Route path="comercial/dashboard" element={<CommercialDashboardPage />} />
                <Route path="comercial/cotizaciones" element={<CotizacionesPage />} />

                <Route path="operacion/proyectos"              element={<ProjectsPage />} />
                <Route path="operacion/proyectos/:projectId"   element={<ProjectHubPage />} />
                <Route path="operacion/reclutamiento" element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="operacion/participantes" element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="operacion/tareas"        element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="operacion/calendario"    element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="operacion/chat"          element={<Navigate to="/operacion/proyectos" replace />} />

                <Route path="admin/ordenes"     element={<PurchasesPage />} />
                <Route path="admin/proveedores" element={<SuppliersPage />} />
                <Route path="admin/pagos"       element={<PaymentsPage />} />
                <Route path="admin/facturas-proveedores" element={<SupplierInvoicesPage />} />
                <Route path="admin/cobranza"    element={<PlaceholderPage title="Cobranza" description="Control de facturas emitidas a clientes y seguimiento de cobros pendientes." icon="📋" />} />
                <Route path="finanzas/cotizaciones" element={<Navigate to="/comercial/cotizaciones" replace />} />
                <Route path="admin/usuarios"   element={<Navigate to="/configuracion" replace />} />

                <Route path="finanzas/costos"    element={<ProjectCostsPage />} />
                <Route path="admin/gastos"       element={<ExpensesPage />} />
                <Route path="finanzas/dashboard" element={<PlaceholderPage title="Dashboard Financiero" description="P&L, métricas globales, cuentas por cobrar y por pagar." icon="💰" />} />

                <Route path="tableros" element={<PlaceholderPage title="Tableros Flexibles" description="Crea boards personalizados con columnas dinámicas para cualquier uso." icon="⚙️" />} />
                <Route path="configuracion" element={<SettingsPage />} />
                <Route path="admin/migration" element={<MigrationRunnerPage />} />
                <Route path="admin/importar" element={<DataImportPage />} />
                <Route path="sharpli-test" element={<SharpliTestPage />} />

                <Route path="commercial"   element={<Navigate to="/comercial/crm" replace />} />
                <Route path="projects"     element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="recruitment"  element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="participants" element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="admin"        element={<Navigate to="/admin/ordenes" replace />} />
                <Route path="pm"           element={<Navigate to="/operacion/proyectos" replace />} />
                <Route path="chat"         element={<ChatPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
          </TeamMembersProvider>
        </ProjectProvider>
    </ErrorBoundary>
  );
}
