// Paletas de color del tablero. «Hub» sigue los colores del moodboard (teal, dorado, info, éxito, alerta…). En modo oscuro el teal se aclara para que se vea.
export interface Paleta {
  id: string;
  etiqueta: string;
  claro: string[];
  oscuro: string[];
}

export const PALETAS: Record<string, Paleta> = {
  hub: {
    id: 'hub', etiqueta: 'Hub',
    claro: ['#0F3D4D', '#F4C025', '#1795D3', '#257E55', '#DC7A09', '#5B687B', '#8b93a1', '#D32222'],
    oscuro: ['#4FB3CF', '#F4C025', '#1795D3', '#3FAE7C', '#E8923A', '#9AA7BA', '#8b93a1', '#E65A5A'],
  },
  frio: {
    id: 'frio', etiqueta: 'Fríos',
    claro: ['#0F3D4D', '#1795D3', '#257E55', '#5B687B', '#6FB7D9', '#7FB69E', '#8b93a1', '#0A303D'],
    oscuro: ['#4FB3CF', '#1795D3', '#3FAE7C', '#9AA7BA', '#6FB7D9', '#7FB69E', '#8b93a1', '#7FD0E6'],
  },
  calido: {
    id: 'calido', etiqueta: 'Cálidos',
    claro: ['#DC7A09', '#F4C025', '#D32222', '#8a5a2b', '#E9A66B', '#F0D27A', '#8b93a1', '#A32D2D'],
    oscuro: ['#E8923A', '#F4C025', '#E65A5A', '#C08A55', '#E9A66B', '#F0D27A', '#8b93a1', '#F09595'],
  },
  mono: {
    id: 'mono', etiqueta: 'Un solo color',
    claro: ['#0F3D4D', '#2F6272', '#5A8795', '#86AAB5', '#B1CBD2', '#D4E3E7', '#8b93a1', '#5B687B'],
    oscuro: ['#4FB3CF', '#6FC0D6', '#8FCEDF', '#AEDCE8', '#CDEAF1', '#E5F4F8', '#8b93a1', '#9AA7BA'],
  },
};

export const PALETA_BASE = 'hub';

export function coloresDe(paleta: string, oscuro: boolean): string[] {
  const p = PALETAS[paleta] ?? PALETAS[PALETA_BASE];
  return oscuro ? p.oscuro : p.claro;
}

export const colorDe = (colores: string[], i: number): string => colores[i % colores.length];
