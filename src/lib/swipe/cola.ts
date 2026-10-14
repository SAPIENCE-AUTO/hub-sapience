/**
 * Corre las tareas de a `concurrencia` a la vez y devuelve una promesa por tarea, EN EL MISMO ORDEN en que se pidieron
 * (no en el que van terminando): quien las espera en fila las recibe en el orden de la lista aunque unas acaben antes.
 * Cada promesa se resuelve o se rechaza por su cuenta: una tarea que falla no detiene a las demás.
 */
export function enCola<T>(tareas: Array<() => Promise<T>>, concurrencia: number): Promise<T>[] {
  const limite = Math.max(1, Math.floor(concurrencia));
  const salidas = tareas.map(() => {
    let resolver!: (valor: T) => void;
    let rechazar!: (motivo: unknown) => void;
    const promesa = new Promise<T>((ok, mal) => { resolver = ok; rechazar = mal; });
    return { promesa, resolver, rechazar };
  });
  let siguiente = 0;
  let activas = 0;
  const lanzar = () => {
    while (activas < limite && siguiente < tareas.length) {
      const i = siguiente++;
      activas++;
      // Un try por si la tarea lanza antes de devolver su promesa.
      Promise.resolve().then(tareas[i]).then(salidas[i].resolver, salidas[i].rechazar).finally(() => { activas--; lanzar(); });
    }
  };
  lanzar();
  return salidas.map((s) => s.promesa);
}
