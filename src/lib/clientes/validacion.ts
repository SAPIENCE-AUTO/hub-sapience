// Validaciones y normalización de los datos fiscales y de contacto del catálogo de clientes. Puras: las usan el servidor (al guardar) y la pantalla (al escribir).

/** RFC en mayúsculas y sin espacios ni guiones; vacío → undefined. */
export function normalizarRfc(v?: string | null): string | undefined {
  const s = (v ?? '').toUpperCase().replace(/[\s-]+/g, '');
  return s || undefined;
}

// Persona moral: 3 letras + 6 dígitos de fecha + 3 de homoclave (12). Persona física: 4 letras (13). Incluye los genéricos XAXX010101000 y XEXX010101000.
export function rfcValido(rfc: string): boolean {
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc);
}

export function cpValido(cp: string): boolean {
  return /^\d{5}$/.test(cp);
}

export function correoValido(c: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(c);
}

/** Separa por coma, punto y coma, salto de línea o espacio; sin vacíos ni repetidos (sin importar mayúsculas). */
export function separarCorreos(v?: string | null): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const parte of (v ?? '').split(/[,;\s]+/)) {
    const c = parte.trim();
    if (!c || vistos.has(c.toLowerCase())) continue;
    vistos.add(c.toLowerCase());
    out.push(c);
  }
  return out;
}

/** Agrega https:// si falta; devuelve undefined si queda vacío o no es una dirección válida. */
export function normalizarUrl(v?: string | null): string | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  const conEsquema = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(conEsquema);
    return u.hostname.includes('.') ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function textoOUndefined(v?: string | null): string | undefined {
  const s = (v ?? '').trim();
  return s || undefined;
}
