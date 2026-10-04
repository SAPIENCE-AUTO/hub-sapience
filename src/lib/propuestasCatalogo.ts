// Catálogo del generador de propuestas para el front: los 7 estilos (A-G) y las
// 11 portadas de la skill. Los datos salen de skill/assets/estilos/*.json y
// portadas.json; las miniaturas viven en public/propuestas/ (estilos/A.jpg,
// portadas/<ID>.jpg — el marco real sobre gris, que es donde irán las fotos).
// Solo para mostrar: el backend (esquemas.ts) es quien valida los ids.
export interface EstiloInfo { nombre: string; acento: string; secundario: string; fondo: string; fases: string[] }
export const ESTILOS: Record<string, EstiloInfo> = {
  "A": {
    "nombre": "Oscuro coral",
    "acento": "FF4155",
    "secundario": "FFB843",
    "fondo": "212833",
    "fases": [
      "FFB843",
      "FF4155",
      "5FC2DE",
      "B7C3D0"
    ]
  },
  "B": {
    "nombre": "Banda navy, base clara",
    "acento": "C65A1E",
    "secundario": "E8B04B",
    "fondo": "F2F2F0",
    "fases": [
      "E8B04B",
      "B33A3A",
      "A9C9C0",
      "4F5F7A"
    ]
  },
  "C": {
    "nombre": "Blanco, pie amarillo",
    "acento": "FF675C",
    "secundario": "FFC000",
    "fondo": "FFFFFF",
    "fases": [
      "FF675C",
      "FFC000",
      "354251",
      "8AA1B1"
    ]
  },
  "D": {
    "nombre": "Rombos, verde",
    "acento": "00936F",
    "secundario": "E9AA42",
    "fondo": "FFFFFF",
    "fases": [
      "00936F",
      "E9AA42",
      "FF675C",
      "323F4F"
    ]
  },
  "E": {
    "nombre": "Mancha, embudo y tabla",
    "acento": "FF675C",
    "secundario": "FFC000",
    "fondo": "222A35",
    "fases": [
      "FFC000",
      "FF675C",
      "A9D18E",
      "8FA3B8"
    ]
  },
  "F": {
    "nombre": "Pizarra, cuadrado",
    "acento": "FF675C",
    "secundario": "F2C14E",
    "fondo": "354251",
    "fases": [
      "FF675C",
      "F2C14E",
      "7FC8C2",
      "D9DEE5"
    ]
  },
  "G": {
    "nombre": "Diagonal X, contorno",
    "acento": "F58A42",
    "secundario": "FFC101",
    "fondo": "FFFFFF",
    "fases": [
      "F58A42",
      "00324F",
      "FFC101",
      "5FC2DE"
    ]
  }
};

export const PORTADAS: Record<string, { nombre: string; huecos: number }> = {
  "CITIZEN": {
    "nombre": "Mancha, título en cascada",
    "huecos": 1
  },
  "DOS": {
    "nombre": "Mancha, cliente protagonista",
    "huecos": 1
  },
  "SANTIAGO": {
    "nombre": "Diagonal en X",
    "huecos": 1
  },
  "AURELIO": {
    "nombre": "Brochazo",
    "huecos": 1
  },
  "ESPARTA": {
    "nombre": "Chevrón",
    "huecos": 1
  },
  "1200": {
    "nombre": "Diagonal amarilla",
    "huecos": 1
  },
  "PIVOT": {
    "nombre": "Pixeles",
    "huecos": 1
  },
  "Yellow": {
    "nombre": "Triángulos",
    "huecos": 1
  },
  "VALOR": {
    "nombre": "Rombos en retícula",
    "huecos": 1
  },
  "PAIN": {
    "nombre": "Rombos redondeados",
    "huecos": 3
  },
  "FRESH": {
    "nombre": "Onda",
    "huecos": 1
  }
};

export const TIPOS_LAMINA: Record<string, string> = {
  contexto: 'Contexto', punto_partida: 'Punto de partida', objetivos: 'Objetivos', enfoque: 'Enfoque',
  detalle_fase: 'Detalle de fase', muestra: 'Muestra', entregables: 'Entregables', tiempos: 'Tiempos',
  inversion: 'Inversión', seccion: 'Sección', cierre: 'Cierre',
};

export const ESTADOS_PROPUESTA: Record<string, string> = {
  borrador: 'Borrador', esqueleto: 'Esqueleto propuesto', esqueleto_aprobado: 'Esqueleto aprobado',
  contenido: 'Con problemas por revisar', revisado: 'Contenido revisado', construida: 'PowerPoint listo', error: 'Error',
};

export function archivoABase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Descarga una URL firmada sin sacar a la persona de la pantalla.
export function descargarUrl(url: string) {
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
