/**
 * Una copia de la lista en orden aleatorio (Fisher-Yates): todos los órdenes posibles son igual de probables y la lista
 * original no se toca. `azar` devuelve un número en [0, 1) y se puede pasar uno propio para probarlo.
 */
export function barajar<T>(lista: readonly T[], azar: () => number = Math.random): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
