# Flowmark Compiler Session Context

> Contexto vivo para retomar el trabajo de endurecimiento de compiladores sin analizar el repo desde cero.
> Actualizar al inicio y al final de cada sesión.

## Fecha de última actualización

2026-07-03 (Fases A, B, C y D completadas)

## Estado del repo

- Rama actual: `main` (según `git status`)
- Archivos sin commit:
  - Ninguno de la Fase A; pendiente commit grupal.
- Tests baseline pasan:
  - `cargo test --workspace` ✅
  - `pnpm --filter @flowmark/dom test` ✅
  - `pnpm --filter @flowmark/runtime test` ✅
  - `pnpm run typecheck` ✅
  - `pnpm run build:rust` ✅

## Arquitectura de un vistazo

### Compilador HTML/control flow (Rust)

- Entrada: templates `.flow` o regiones Astro.
- Salida: módulo ES con `export function render(context) { ... }`.
- Pipeline: `lib.rs` → `parser` → `codegen.rs`.

Archivos clave:

| Archivo | Responsabilidad |
|---------|-----------------|
| `crates/flowmark-compiler/src/lib.rs` | API pública: `compile`, `parse_ast`, `CompileOptions` |
| `crates/flowmark-compiler/src/ast.rs` | Nodos del AST |
| `crates/flowmark-compiler/src/codegen.rs` | Generación de JS (`output += ...`) |
| `crates/flowmark-compiler/src/parser/nodes.rs` | Dispatch recursivo descendente |
| `crates/flowmark-compiler/src/parser/html.rs` | Tags, atributos, comentarios, raw text |
| `crates/flowmark-compiler/src/parser/blocks.rs` | `@if`, `@for`, `@switch` |
| `crates/flowmark-compiler/src/parser/interpolation.rs` | `{{ expr }}` |
| `crates/flowmark-compiler/src/javascript.rs` | Scanner de expresiones JS + validación con `oxc_parser` |
| `crates/flowmark-compiler/src/diagnostics.rs` | Códigos `FM0001`–`FM0014`, formateo human/JSON |
| `crates/flowmark-compiler/tests/compiler_tests.rs` | Tests del compilador |
| `crates/flowmark-cli/src/main.rs` | CLI `flowmark compile` |

### Compilador de eventos (TypeScript)

- Entrada: frontmatter + template HTML (Astro o standalone).
- Salida: HTML con `data-flow-on-*` + módulo cliente que llama `bindFlowEvents`.
- Separado del compilador Rust por diseño.

Archivos clave:

| Archivo | Responsabilidad |
|---------|-----------------|
| `packages/dom/src/compiler.ts` | `compileEvents`, validación, generación de HTML y cliente |
| `packages/dom/src/parser.ts` | `findEventBindings`, `parseHandlerExpression`, `extractFrontmatterFunctions`, `analyzeCaptures` |
| `packages/dom/src/runtime/index.ts` | `bindFlowEvents`, `bindFlowEventsIn`, resolución de `$event`/`$el` |
| `packages/dom/src/diagnostics.ts` | `locate`, `FlowmarkDomError` |
| `packages/dom/src/index.test.ts` | Tests del compilador de eventos |
| `packages/dom/src/runtime/index.test.ts` | Tests del runtime |
| `packages/astro-events/src/index.ts` | Integración Astro + inyección de `<script>` |
| `packages/astro-events/src/index.test.ts` | Tests de la integración Astro |

### Integraciones

| Archivo | Responsabilidad |
|---------|-----------------|
| `packages/vite/src/index.ts` | Plugin Vite para `.flow` (spawn del CLI Rust) |
| `packages/astro/src/index.ts` | Integración Astro para templates `.flow` y `<template flowmark>` |
| `packages/runtime/src/index.ts` | `renderValue`, `escapeHtml` usados por el output Rust |

## Problemas conocidos (copia resumida)

### Eventos (resueltos en Fase A)

1. ~~Descubrimiento regex (`EVENT_ATTR_RE`) es frágil.~~ ✅ Reemplazado por scanner HTML-aware.
2. ~~`parseCallShape` no rechaza trailing junk (`save() + 1`).~~ ✅ Ahora se rechaza contenido inesperado tras el cierre del call.
3. ~~Frontmatter solo soporta `function name() {}`.~~ ✅ Ahora soporta `export`, `async` y `export async`.
4. ~~`analyzeCaptures` es heurístico y falla con TS moderno.~~ ✅ Reemplazado por TypeScript type checker.
5. ~~Diagnósticos en Astro apuntan al template cortado, no al archivo original.~~ ✅ Ajustados con `translateDiagnostics`.
6. `astro-events` devuelve `map: null`. ⏳ Pendiente Fase D.
7. ~~Runtime ya tiene deduplicación sin commit.~~ ✅ Commiteado.

### Rust (resueltos en Fase C)

1. ~~`track` se parsea pero se ignora.~~ ✅ Ahora emite warning `FM0015`.
2. ~~`@switch` puede generar fallthrough accidental.~~ ✅ Ahora siempre emite `break`.
3. ~~Atributos dinámicos solo aceptan interpolación completa; el mensaje de error es confuso.~~ ✅ Mensaje mejorado.
4. ~~Diagnósticos de tags no cerrados no indican dónde se abrieron.~~ ✅ Span apunta al tag de apertura.
5. ~~Nombres temporales (`__items0`) dependen de reservados.~~ ✅ Cambiados a `__flowmark_items0`.

## Decisions log

| Fecha | Decisión | Razón |
|-------|----------|-------|
| 2026-07-03 | No agregar nuevas features al lenguaje | Enfocarse en robustez de compiladores existentes |
| 2026-07-03 | Fases A→D en ese orden | Mayor impacto DX primero (eventos), luego Rust, luego integración |
| 2026-07-03 | Commitear deduplicación de listeners como primer paso | Ya está implementada; evita perder trabajo |
| 2026-07-03 | Scanner HTML-aware en lugar de regex | Más robusto y mantiene el paquete sin dependencias nuevas |
| 2026-07-03 | Añadir `typescript` como dependencia de `@flowmark/dom` | Necesario para análisis real de captures en handlers |

## Comandos útiles para cada sesión

```bash
# Rust
cargo test --workspace
cargo clippy --workspace --all-targets
cargo fmt --check

# JS/TS
pnpm run typecheck
pnpm --filter @flowmark/dom test
pnpm --filter @flowmark/runtime test
pnpm --filter @flowmark/astro-events test

# Build
cargo build --release
pnpm run build:rust

# Demo
cd examples/astro-demo
pnpm run check
pnpm run test:unit
pnpm run dev
```

## Notas abiertas

- Evaluar si `MagicString` ya está disponible en `packages/astro-events` o hay que agregarlo.
- Confirmar si el prefijo `__flowmark_` para temporales no colisiona con nada existente.
- Considerar si el tiempo de test (~3s por crear programas TS) es aceptable o si se debe cachear el checker.
- Los warnings de templates embebidos en Astro se descartan en el hook `load` porque Vite no expone `this.warn` allí. Evaluar si mover la compilación embebida a `transform` para poder emitir warnings.
- El source map de `astro-events` mapea el frontmatter 1:1 y el template de forma aproximada; el client module inyectado no tiene mapeo aún.
- Revisar si se quiere un escape aún más robusto para `<!--`/`-->` dentro del client module inyectado.
