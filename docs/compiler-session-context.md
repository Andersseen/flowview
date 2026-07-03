# Flowmark Compiler Session Context

> Contexto vivo para retomar el trabajo de endurecimiento de compiladores sin analizar el repo desde cero.
> Actualizar al inicio y al final de cada sesión.

## Fecha de última actualización

2026-07-03

## Estado del repo

- Rama actual: `main` (según `git status`)
- Archivos sin commit:
  - `packages/dom/src/runtime/index.ts` — deduplicación de listeners (`FLOW_BOUND_ATTR`, `bindFlowEventsIn`)
  - `packages/dom/src/runtime/index.test.ts` — tests de deduplicación
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

### Eventos

1. Descubrimiento regex (`EVENT_ATTR_RE`) es frágil.
2. `parseCallShape` no rechaza trailing junk (`save() + 1`).
3. Frontmatter solo soporta `function name() {}`.
4. `analyzeCaptures` es heurístico y falla con TS moderno.
5. Diagnósticos en Astro apuntan al template cortado, no al archivo original.
6. `astro-events` devuelve `map: null`.
7. Runtime ya tiene deduplicación sin commit.

### Rust

1. `track` se parsea pero se ignora.
2. `@switch` puede generar fallthrough accidental.
3. Atributos dinámicos solo aceptan interpolación completa; el mensaje de error es confuso.
4. Diagnósticos de tags no cerrados no indican dónde se abrieron.
5. Nombres temporales (`__items0`) dependen de reservados.

## Decisions log

| Fecha | Decisión | Razón |
|-------|----------|-------|
| 2026-07-03 | No agregar nuevas features al lenguaje | Enfocarse en robustez de compiladores existentes |
| 2026-07-03 | Fases A→D en ese orden | Mayor impacto DX primero (eventos), luego Rust, luego integración |
| 2026-07-03 | Commitear deduplicación de listeners como primer paso | Ya está implementada; evita perder trabajo |

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

- Revisar si `oxc_parser` puede usarse también en el lado TypeScript para `analyzeCaptures` sin agregar una nueva dependencia pesada.
- Evaluar si `MagicString` ya está disponible en `packages/astro-events` o hay que agregarlo.
- Confirmar si el prefijo `__flowmark_` para temporales no colisiona con nada existente.
