# CONTEXT — Integración de flowmark en apps externas (dev-auth)

> Documento de traspaso entre sesiones. Contiene todo lo analizado el 2026-07-05
> para no tener que re-explorar los dos repos. Pásalo junto con la fase del
> `PLAN.md` que toque en cada sesión.

## Objetivo general

Usar **flowmark** (este repo) como motor de plantillas HTML en **dev-auth**
(`/Users/andriipap/Andersseen/Web/Projects/devflare/apps/dev-auth`), un Worker
de Cloudflare con Hono que devuelve HTML, y dejarlo listo para consumirse desde
cualquier otra app fuera de este monorepo.

Filosofía de trabajo del usuario: **pocas cosas por iteración, pero bien
hechas**. Cada fase del PLAN se ejecuta en una sesión nueva.

## Qué es flowmark (este repo)

Compilador escrito en Rust para plantillas HTML con control de flujo estilo
Angular (`@if`, `@for ... @empty`, interpolación `{{ }}`). Compila `.flow` →
módulo JS con una función de render que **devuelve un string** (SSR puro).

Estructura:

- `crates/flowmark-compiler` — el compilador (lib Rust).
- `crates/flowmark-cli` — CLI `flowmark`. Subcomando único `compile`:
  - Acepta ruta de fichero **o `-` (stdin)**; flags: `--out <ruta>`,
    `--runtime <import>` (default `@flowview/runtime`), `--display-name`,
    `--line-offset`, `--diagnostic-format human|json`.
  - **No tiene modo watch ni globs** — compila de uno en uno.
- `packages/runtime` (`@flowview/runtime`) — runtime mínimo: solo
  `escapeHtml` y `renderValue` + tipos (`RenderContext`, `RenderFunction`).
  **Sin dependencias, sin APIs de Node → 100% compatible con Workers.**
- `packages/vite` (`@flowview/vite`) — plugin Vite. En `transform` de `*.flow`
  hace `spawn` del binario `flowmark` (pasa la fuente por stdin). Exporta
  también `compileFlowmark()`, `resolveCompilerPath()`, `clearCompileCache()`.
  Tiene `client.d.ts` para tipar imports `.flow` (solo vía Vite).
- `packages/astro` / `packages/astro-events` — integraciones Astro.
- `packages/events` (`@flowview/events`) — compilador/runtime de eventos
  (`compileScriptEvents`, `findEventBindings`...). **Solo tiene integración
  para Astro** (`astro-events`); no hay vía genérica Vite/esbuild para eventos.
- `packages/prettier`, `packages/vscode-flowmark` — tooling.

Resolución del binario del compilador
(`packages/vite/src/index.ts` → `resolveCompilerPath`, ~línea 253):

1. `compilerPath` explícito en opciones.
2. Env `FLOWMARK_COMPILER_PATH`.
3. `target/debug/flowmark` y `target/release/flowmark` **relativos al
   monorepo** (solo funciona dentro de este repo).
4. Fallback: `flowmark` en el PATH.

## Estado de publicación (bloqueador #1)

- **Todos** los `@flowview/*` tienen `"private": true`, versión `0.1.0` y
  dependencias `workspace:*`. Nada está en npm.
- Verificado el 2026-07-05: `@flowview/runtime` → 404 en npm; el paquete
  `flowmark` (sin scope) está **retenido por npm security**
  (`0.0.1-security`) → ese nombre no está disponible.
- El scope `@flowview` no tiene paquetes; la organización ya está creada en npm.
  **Decisión del usuario (2026-07-05): usar la org `@flowview` en npm.**
- Distribución del compilador: **Decisión del usuario (2026-07-05): WASM**
  (Fase 4 del PLAN).
- No hay changesets ni workflow de publish.

## Distribución del compilador (bloqueador #2)

Fuera del monorepo el consumidor necesita el binario `flowmark`:

- Atajo válido hoy: `cargo install --path crates/flowmark-cli` +
  `FLOWMARK_COMPILER_PATH` o PATH. Sirve para la máquina del usuario, no
  escala a CI/otros usuarios.
- Opción escalable A: binarios precompilados por plataforma como
  `optionalDependencies` (patrón esbuild/swc). Requiere CI multiplataforma.
- Opción escalable B (**recomendada en el análisis**): compilar
  `flowmark-compiler` a WASM (wasm-pack/wasm-bindgen) y ejecutarlo in-process
  desde `@flowview/vite` — sin `spawn`, sin cargo en el consumidor, funciona
  en cualquier CI. La compilación es solo build-time, el coste WASM es
  irrelevante.

## dev-auth (el consumidor objetivo)

Ruta: `/Users/andriipap/Andersseen/Web/Projects/devflare/apps/dev-auth`
(monorepo devflare, paquete `@devflare/dev-auth`, `private`).

- Microservicio de auth: Hono + Better Auth + Cloudflare D1 (Drizzle) + KV,
  desplegado como Worker. Cookies cross-subdomain, OAuth GitHub, verificación
  email, reset password.
- **Build: wrangler a pelo** (`wrangler dev --local` / `wrangler deploy`,
  `main = "src/index.ts"`, bundler esbuild interno de wrangler). **No usa
  Vite** → `@flowview/vite` no aplica tal cual (bloqueador #3).
- `wrangler.toml` tiene `[build] command = ""` → hueco perfecto para un paso
  de precompilación.
- Páginas HTML en `src/pages/*.ts` (`layout.ts`, `login.ts`, `signup.ts`,
  `forgot.ts`, `verify.ts`, `setup.ts`, `not-found.ts`): funciones que
  devuelven template literals con web components `@andersseen/web-components`
  (`<and-card>`, `<and-input>`, `<and-button>`, atributos `and-layout`,
  `and-text`...). Patrón actual: `renderLoginPage(): string` →
  `renderLayout({ title, body })`.
- Compatibilidad: flowmark solo genera strings, así que los web components
  pasan tal cual — encaje perfecto con `c.html(...)` de Hono.

## Los 3 bloqueadores, en corto

1. Paquetes `@flowview/*` privados/no publicados (y nombre npm por decidir).
2. Compilador = binario Rust local; no hay distribución para consumidores.
3. dev-auth no usa Vite; la única integración genérica es el plugin Vite.

## Detalles menores ya identificados

- El código compilado importa `@flowview/runtime`; mientras no esté publicado,
  vendorizar el runtime (2 funciones) en dev-auth y compilar con
  `--runtime ./ruta-local` es un atajo válido.
- Vía precompilada: no se genera `.d.ts` (el `client.d.ts` del plugin solo
  cubre imports `.flow` en Vite) → declarar tipos a mano o generar `.d.ts`.
- Eventos (`@flowview/events`) fuera de Astro: no soportado; en dev-auth se sigue
  con `<script>` normales de momento.

## Rutas de referencia rápidas

- Plugin Vite / resolución de binario:
  `packages/vite/src/index.ts` (spawn ~L148, resolveCompilerPath ~L253).
- CLI args: `crates/flowmark-cli/src/main.rs` (enum `Command::Compile`).
- Runtime: `packages/runtime/src/{index,escape-html,render-value}.ts`.
- Consumidor: `.../devflare/apps/dev-auth/{wrangler.toml,src/pages/,src/index.ts}`.
- Ejemplo de sintaxis: `examples/basic/for.flow`.
