# Cómo levantar la interfaz (sin backend todavía)

Objetivo: ver la app renderizando en el navegador, con usuario simulado y sin datos.
Esto valida que los ~350 archivos del front son portables sin reescribirse.

## Qué falta y por qué

Zite proveía tres cosas que no vinieron en el export:

1. **El andamiaje del proyecto** — no hay `package.json`, `index.html`, `vite.config.ts` ni `tsconfig.json`.
2. **Los 26 componentes de shadcn/ui** — `src/components/ui/` no existe, pero 100 archivos importan de ahí.
3. **Los tres SDK** — `zite-endpoints-sdk` (99 archivos), `zite-auth-sdk` (20), `zite-file-upload-sdk` (15).
   Los reemplazos están en esta carpeta.

## Pasos

### 1. Colocar los shims

```
mkdir -p src/shims
cp shims/zite-*.ts src/shims/
```

### 2. Crear el proyecto Vite

Dependencias necesarias (detectadas de los imports reales del código):

```
npm init -y
npm i react react-dom react-router-dom lucide-react sonner date-fns recharts framer-motion zod clsx tailwind-merge class-variance-authority ably
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss postcss autoprefixer
```

### 3. Alias de módulos

En `vite.config.ts` y `tsconfig.json` hay que mapear:

- `@/*` → `./src/*`  (lo usan los 100 imports de `@/components/ui`)
- `zite-endpoints-sdk` → `./src/shims/zite-endpoints-sdk`
- `zite-auth-sdk` → `./src/shims/zite-auth-sdk`
- `zite-file-upload-sdk` → `./src/shims/zite-file-upload-sdk`

Los alias evitan tener que editar los 134 archivos que importan de esos paquetes.

### 4. Instalar los componentes shadcn/ui

```
npx shadcn@latest init
npx shadcn@latest add accordion alert alert-dialog badge button calendar card checkbox collapsible command dialog dropdown-menu input label popover progress scroll-area select separator sheet skeleton slider sonner switch tabs textarea tooltip
```

Esos 26 son exactamente los que usa el código, ni uno más.

### 5. Modo simulado

Crear `.env.local`:

```
VITE_MOCK_USER=true
```

Con eso `useAuth` devuelve un usuario ficticio y la app renderiza sin backend.

### 6. Levantar

```
npm run dev
```

## Qué esperar

**Sí vas a ver:** el Layout, la navegación lateral, las rutas funcionando, las páginas
renderizando su estructura.

**No vas a ver:** datos. Cada llamada a un endpoint va a fallar contra `/api/...` porque
el servidor no existe. Las páginas se van a quejar o mostrar vacío. Eso es lo esperado.

**Van a salir errores.** El front dependía de detalles de Zite que se descubren al correr:
variables de entorno, `index.css` con directivas de Tailwind, quizá algún import faltante.
Resolverlos uno por uno es justo el trabajo de esta etapa.

## Después

Con la interfaz en pie, el siguiente paso es el servidor Hono que monta los 207 endpoints
sobre `server/compat/`, y ahí ya se conecta con Supabase y aparecen los datos.
