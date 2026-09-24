import sharpliLogo from '../assets/sharpli-logo.png';

// Logo real de Sharpli — envuelve <img> para satisfacer el tipo de ícono que
// usan el nav (NavItem.icon) y las pestañas de proyecto (ALL_TABS[].icon):
// cualquier componente con `className`, mismo criterio que un ícono de Lucide.
export function SharpliIcon({ className }: { className?: string }) {
  return <img src={sharpliLogo} alt="" className={className} />;
}
