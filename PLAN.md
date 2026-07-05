# PLAN — flowmark listo para apps externas (dev-auth primero)

> Cómo usar este plan: en cada sesión nueva, pasa `CONTEXT.md` completo + la
> sección de **una sola fase**. Las fases están ordenadas por valor y son
> independientes entre sí salvo donde se indica en "Prerrequisitos".
> Regla: pocas cosas por iteración, pero terminadas y verificadas.

## Estado

- [x] Fase 0 — Decisiones (usuario)
- [x] Fase 1 — Precompilación en dev-auth (uso inmediato, sin publicar nada)
- [x] Fase 2 — Migrar páginas de dev-auth a `.flow`
- [ ] Fase 3 — Publicar `@flowview/runtime` y `@flowview/vite` en npm
- [ ] Fase 4 — Compilador distribuible (WASM)
- [ ] Fase 5 — dev-auth con Vite + `@cloudflare/vite-plugin` (HMR)
- [ ] Fase 6 — Extras de DX (opcional)

---

## Fase 0 — Decisiones (solo usuario, 5 min)

Nada de código; responder esto desbloquea las fases 3–4:

1. **Scope npm**: ¿reclamar la org `@flowview` en npm o publicar como
   `@andersseen/flowmark-*`? (el nombre `flowmark` sin scope NO está
   disponible — retenido por npm security).
2. **Distribución del compilador**: ¿WASM (recomendado) o binarios
   precompilados por plataforma? El plan asume WASM (Fase 4).

### Decisiones registradas (2026-07-05)

- **Scope npm**: `@flowview` (organización creada en npm).
- **Distribución del compilador**: WASM (Fase 4).

---

## Fase 1 — Precompilación en dev-auth (uso inmediato)

**Objetivo**: poder escribir un `.flow` en dev-auth y que compile a JS en el
build de wrangler, sin publicar nada en npm ni tocar el toolchain.

**Repo de trabajo**: devflare (`apps/dev-auth`). Se necesita el binario
`flowmark` del repo flowmark.

Tareas:

1. Instalar el CLI en la máquina: `cargo install --path crates/flowmark-cli`
   (desde el repo flowmark). Verificar `flowmark --help`.
2. Vendorizar el runtime en dev-auth: copiar el contenido de
   `packages/runtime/src/{escape-html,render-value,index}.ts` (flowmark) a
   `apps/dev-auth/src/lib/flowmark-runtime.ts` (un solo fichero, ~60 líneas).
3. Crear `apps/dev-auth/scripts/compile-flow.mjs`:
   - Glob de `src/**/*.flow`.
   - Para cada uno: `flowmark compile <in> --out <in>.js --runtime <ruta
     relativa a src/lib/flowmark-runtime>` (ojo: la ruta de `--runtime` es el
     import que aparecerá en el JS generado; calcularla relativa a cada
     fichero de salida).
   - Salir con código ≠ 0 si algo falla (para que wrangler aborte el build).
4. Engancharlo: en `wrangler.toml`, `[build] command = "node
   scripts/compile-flow.mjs"` (hoy está vacío).
5. Añadir `*.flow.js` a `.gitignore` de dev-auth (son artefactos generados).
6. Modo dev: script `watch:flow` en package.json (chokidar-cli o un watcher
   de ~20 líneas con `fs.watch`) que recompile al guardar; documentar que en
   dev se corre junto a `wrangler dev`.
7. Piloto mínimo: crear UN `.flow` trivial (p. ej. `src/pages/not-found.flow`,
   la página más simple), importar el `.js` generado desde el route y servirlo
   con `c.html(...)`.

**Hecho cuando**: `pnpm dev` en dev-auth sirve la página piloto renderizada
por flowmark, y `wrangler deploy --dry-run` (o el build) pasa sin el binario…
no — el build SÍ requiere el binario en esa máquina; documentar eso en el
README de dev-auth como limitación hasta la Fase 4.

---

## Fase 2 — Migrar páginas de dev-auth a `.flow`

**Prerrequisito**: Fase 1 terminada y verificada.

**Objetivo**: mover las páginas reales de template literals a plantillas
`.flow`, una por sesión si hace falta.

Orden sugerido (de simple a complejo):

1. `not-found` (si no fue el piloto) → 2. `verify` → 3. `forgot` →
4. `login` → 5. `signup` → 6. `layout` (extraer como plantilla contenedora;
decidir cómo componer: pasar `body` ya renderizado como valor al contexto del
layout) → 7. `setup` (el wizard, la más compleja, dejarla para el final).

Reglas por página:

- Mantener la misma firma pública (`renderLoginPage(): string`) como wrapper
  fino sobre la función generada — los routes no cambian.
- Los `<script>` client-side se quedan como están (eventos flowmark fuera de
  Astro no existen aún — ver Fase 6).
- Verificar visualmente cada página en `wrangler dev --local` antes de pasar
  a la siguiente.
- Tipar el contexto de cada plantilla con un `interface` local + cast del
  módulo generado (no hay `.d.ts` generado; anotarlo si molesta mucho →
  alimenta Fase 6).

**Hecho cuando**: todas las páginas salen de `.flow`, los `.ts` viejos de
`src/pages` quedan como wrappers finos o eliminados, y el flujo completo
(login/signup/forgot/verify) funciona en local.

> **Nota sobre `layout.ts`**: se mantiene como helper TypeScript porque
> flowmark v1 escapa HTML por defecto y no ofrece una vía para inyectar
> `body`/`scripts` ya renderizados sin escapar. Cuando el compilador soporte
> HTML seguro (Fase 6, extra "`.d.ts` generado" u otro), se puede migrar.

---

## Fase 3 — Publicar `@flowview/runtime` y `@flowview/vite` en npm

**Prerrequisito**: Fase 0 (decisión de scope). No depende de las fases 1–2.

**Repo de trabajo**: flowmark.

Tareas:

1. Renombrar paquetes al scope decidido (si aplica) — buscar/reemplazar
   imports `@flowview/...` en packages, tests, docs y el default `--runtime`
   del CLI (`crates/flowmark-cli/src/main.rs`).
2. En `packages/runtime` y `packages/vite`: quitar `"private": true`, añadir
   `publishConfig: { access: "public" }`, `repository` con `directory`,
   `license`, `description`, `keywords`. Revisar que `files: ["dist"]` +
   `exports` estén completos (en vite incluir `client.d.ts`, ya está en
   `files`).
3. Añadir changesets (`@changesets/cli`) al monorepo; config para ignorar
   examples/vscode.
4. Workflow GitHub Actions de release: build (tsup) + test + `changeset
   publish` con `NPM_TOKEN`. Nota: los tests del plugin vite necesitan el
   binario Rust → el job debe hacer `cargo build --workspace` antes.
5. Publicar 0.1.0 de ambos y verificar instalación limpia en un proyecto
   temporal fuera del monorepo (`npm i <scope>/runtime` y compilar un `.flow`
   con `FLOWMARK_COMPILER_PATH` apuntando al binario local).
6. (Opcional, misma fase si sobra tiempo) publicar también `@flowview/events`,
   `astro` y `astro-events` — mismo checklist.

**Hecho cuando**: `npm view <scope>/runtime version` devuelve 0.1.0 y el
proyecto de prueba externo compila y ejecuta un `.flow`.

**Al terminar**: en dev-auth, sustituir el runtime vendorizado (Fase 1) por el
paquete publicado y borrar `src/lib/flowmark-runtime.ts`.

---

## Fase 4 — Compilador distribuible (WASM)

**Prerrequisito**: ninguno técnico; tiene más sentido tras la Fase 3.

**Objetivo**: que ningún consumidor necesite cargo ni un binario en PATH.

**Repo de trabajo**: flowmark.

Tareas:

1. Crear crate `flowmark-wasm` (wasm-bindgen) que exponga
   `compile(source, options) -> { code, diagnostics }` reutilizando
   `flowmark-compiler`. Build con wasm-pack, target `nodejs` (o `bundler`,
   decidir según cómo lo cargue el plugin).
2. Nuevo paquete npm `@flowview/compiler` (o el scope decidido) que embebe el
   `.wasm` + wrapper JS/TS con la misma interfaz `FlowmarkCompileResult`
   /`FlowmarkDiagnostic` del plugin vite.
3. En `packages/vite`: cadena de resolución →
   `compilerPath` explícito > `FLOWMARK_COMPILER_PATH` > binario del monorepo
   > **WASM (`@flowview/compiler` como dependencia)**. Eliminar así el
   fallback ciego a `flowmark` en PATH.
4. Actualizar el script de precompilación de dev-auth (Fase 1) para usar el
   paquete WASM en vez del binario instalado con cargo → desaparece la
   limitación de "necesitas cargo en la máquina de build".
5. CI: añadir wasm-pack al workflow de release.
6. Tests: los del plugin vite deben pasar también por la vía WASM (matrix o
   test dedicado).

**Hecho cuando**: en un proyecto externo sin Rust instalado, `npm i` +
compilar un `.flow` funciona, y el build de dev-auth ya no requiere el binario.

---

## Fase 5 — dev-auth con Vite + `@cloudflare/vite-plugin` (HMR)

**Prerrequisito**: Fase 3 (paquetes publicados); ideal tras Fase 4.

**Objetivo**: sustituir la precompilación por el plugin Vite oficial, con HMR
de `.flow` en dev.

**Repo de trabajo**: devflare (`apps/dev-auth`).

Tareas:

1. Añadir `vite` + `@cloudflare/vite-plugin` + `@flowview/vite` a dev-auth;
   crear `vite.config.ts` (plugin cloudflare + flowmark).
2. Cambiar scripts: `dev` → `vite dev`, `deploy` → `vite build && wrangler
   deploy` (según docs actuales del plugin de Cloudflare — verificarlas en la
   sesión, cambian rápido; usar la skill `cloudflare`).
3. Quitar `[build] command`, `scripts/compile-flow.mjs`, el watcher y los
   `.flow.js` generados; importar los `.flow` directamente.
4. Tipos: añadir `@flowview/vite/client` a los types del tsconfig de la app.
5. Verificar: dev con HMR (editar un `.flow` y ver el cambio sin reiniciar),
   build de producción y `wrangler deploy` a staging.

**Hecho cuando**: no queda rastro de la vía precompilada y el deploy de
staging sirve las páginas correctamente.

---

## Fase 6 — Extras de DX (opcional, elegir a la carta)

Sin orden; cada punto cabe en una sesión corta:

- **`.d.ts` generado**: que el CLI/compilador emita la declaración del módulo
  (tipo del contexto) junto al `.js` — elimina los casts manuales de Fase 2.
- **`flowmark build`**: subcomando CLI con globs + `--watch`, para consumidores
  sin Vite (haría trivial la vía de la Fase 1 para terceros).
- **Eventos fuera de Astro**: integración genérica de `@flowview/events` (plugin
  vite u opción del compilador) para poder usar bindings de eventos en
  dev-auth en vez de `<script>` manuales.
- **Plugin esbuild**: alternativa al de Vite para proyectos wrangler puros.
- **Docs**: página "Uso fuera del monorepo" en `docs/` con las dos vías
  (precompilación y Vite).
