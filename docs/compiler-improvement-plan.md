# Flowmark Compiler Improvement Plan

> Plan de endurecimiento de los compiladores existentes de Flowmark.
> No agrega nuevas features al lenguaje; solo mejora robustez, diagnósticos y precisión.

## Estado actual (baseline)

- `cargo test --workspace` ✅
- `pnpm --filter @flowmark/dom test` ✅
- `pnpm --filter @flowmark/runtime test` ✅
- `pnpm run typecheck` ✅
- `pnpm run build:rust` ✅

Nota: `packages/dom/src/runtime/index.ts` e `index.test.ts` tienen cambios sin commitear que implementan la deduplicación de listeners. Ver [contexto de sesión](./compiler-session-context.md).

---

## Fase A — Eventos: diagnósticos y descubrimiento confiable

Objetivo: que el compilador de eventos no se rompa con HTML real y que los errores apunten al archivo correcto.

### A1. Commitear deduplicación de listeners existente ✅
- Archivos: `packages/dom/src/runtime/index.ts`, `packages/dom/src/runtime/index.test.ts`
- Estado: completado.
- Check: `pnpm --filter @flowmark/dom test` pasa.

### A2. Corregir diagnósticos page-relative en `@flowmark/astro-events` ✅
- Archivo: `packages/astro-events/src/index.ts`
- Problema: `compileEvents` recibe `templateSource = code.slice(templateStart)`, así que `locate()` da líneas/columnas relativas al template cortado.
- Solución: añadir `translateDiagnostics` que recibe el offset del template en el archivo original y ajusta línea/columna antes de relanzar el error.
- Check: test añadido verificando `loc: { line: 3, column: 9 }` para un error en la línea 3 del archivo Astro.

### A3. Rechazar basura al final de expresiones handler ✅
- Archivo: `packages/dom/src/parser.ts`, `parseCallShape`
- Problema: `save() + 1` parsea como `save()` sin error.
- Solución: después del `)` de cierre, saltar whitespace y verificar que `index === source.length`.
- Check: tests añadidos para `save() + 1` y `save()foo`.

### A4. Endurecer descubrimiento de atributos de evento ✅
- Archivo: `packages/dom/src/parser.ts`, `findEventBindings`
- Problema: `EVENT_ATTR_RE` es frágil (comentarios, comillas anidadas, espacios).
- Solución: reemplazar regex por un scanner HTML-aware que salta comentarios, `<script>`/`<style>`, y parsea atributos respetando comillas.
- Check: tests añadidos para comentarios, script tags, atributos mixtos, comillas simples y texto plano.

---

## Fase B — Eventos: frontmatter y análisis de captures

Objetivo: soportar formas reales de declarar handlers en Astro y evitar falsos positivos/negativos de capturas.

### B1. Soportar `export` y `async` en funciones de frontmatter ✅
- Archivo: `packages/dom/src/parser.ts`, `extractFrontmatterFunctions`; `packages/dom/src/compiler.ts`, `generateClientFunction`
- Problema: solo acepta `function name(...) {}`.
- Solución: extender `FUNCTION_DECL_RE` para `(?:export\s+)?(?:async\s+)?function\s+...`; añadir `isAsync` a `FrontmatterFunction`; emitir `async function` en el cliente cuando corresponda.
- Check: tests para `export function save()`, `async function load()`, `export async function save()`.

### B2. Diagnosticar formas de handler no soportadas ✅
- Archivo: `packages/dom/src/parser.ts`, `findUnsupportedHandlerNames`; `packages/dom/src/compiler.ts`
- Problema: arrow functions, funciones asignadas a `const`, etc., simplemente no se encuentran.
- Solución: detectar `const/let/var name = (...) =>` y `const/let/var name = function(...)` con regex; si el handler usado coincide, emitir diagnóstico que indique usar `function name(...) { ... }`.
- Check: tests para `const save = () => {}` y `const save = function() {}`.

### B3. Reemplazar análisis de captures heurístico por parsing real ✅
- Archivo: `packages/dom/src/parser.ts`, `analyzeCaptures`
- Problema: el tokenizador manual no entiende type annotations, optional chaining, nested functions, etc.
- Solución: usar `typescript` como dependencia runtime, crear un `ts.SourceFile` + `ts.createProgram` + type checker para resolver símbolos. Un identificador es captura si no se declara dentro del propio handler y no es global conocido.
- Check: tests para `console.log`/`fetch` (globales permitidos), type annotations (no captura), optional chaining (sí captura), nested functions (sí captura).

---

## Fase C — Rust: robustez de control flow y sintaxis

Objetivo: pulir los casos donde el compilador Rust es silencioso o frágil.

### C1. Warning cuando se usa `track` en `@for`
- Archivo: `crates/flowmark-compiler/src/parser/blocks.rs` o `codegen.rs`
- Problema: `track` se parsea pero no tiene efecto en v1.
- Solución: emitir un warning diagnostic con código `FM0015` indicando que `track` está reservado y se ignora en v1.
- Check: test que verifique el warning, no error.

### C2. Endurecer emisión de `break` en `@switch`
- Archivo: `crates/flowmark-compiler/src/codegen.rs`, `generate_switch_block`
- Problema: la lógica actual omite `break` en el último caso si no hay `default`; es frágil.
- Solución: emitir `break` siempre que el caso tenga contenido, sin excepciones.
- Check: tests de `@switch` con default, sin default, case vacío, último case vacío.

### C3. Mejorar mensajes de error para atributos dinámicos parciales
- Archivo: `crates/flowmark-compiler/src/parser/html.rs`
- Problema: `class="x {{ y }}"` da un error confuso.
- Solución: el mensaje debe decir: "Interpolations inside attributes must span the entire value, e.g. `attr=\"{{ expr }}\"`."
- Check: test de snapshot del mensaje.

### C4. Mejorar spans de errores de tags no cerrados
- Archivo: `crates/flowmark-compiler/src/parser/html.rs`
- Problema: "Unclosed tag" no indica dónde se abrió.
- Solución: cuando sea posible, incluir en el diagnóstico la línea/columna del tag de apertura.
- Check: test con `<div><span>` sin cerrar.

### C5. Revisar nombres temporales del generador
- Archivo: `crates/flowmark-compiler/src/codegen.rs`
- Problema: `__items0`, `__switch0` dependen de la lista de reservados.
- Solución: cambiar prefijo a `__flowmark_items0`, `__flowmark_switch0`.
- Check: tests de codegen actualizados.

---

## Fase D — Integración y runtime

Objetivo: mejorar la experiencia en dev y permitir limpiar listeners.

### D1. Source maps en `@flowmark/astro-events`
- Archivo: `packages/astro-events/src/index.ts`
- Problema: `map: null`.
- Solución: usar `MagicString` para generar el código transformado y devolver un source map.
- Check: test que verifique que el mapa no sea null y que contenga mappings.

### D2. API de cleanup/dispose en runtime de eventos
- Archivo: `packages/dom/src/runtime/index.ts`
- Problema: no hay forma de eliminar listeners.
- Solución: `bindFlowEvents` y `bindFlowEventsIn` devuelven una función `unbind()` que llama a `removeEventListener`.
- Check: tests que verifiquen que después de `unbind()` los listeners no se ejecutan.

### D3. Revisar escape del client module en Astro
- Archivo: `packages/astro-events/src/index.ts`
- Problema: `replace(/<\/script>/gi, "<\\/script>")` es un hack.
- Solución: evaluar si se puede insertar el script de forma más segura o al menos documentar el motivo.
- Check: no regression en `examples/astro-demo`.

---

## Orden recomendado de ataque

1. A1 (commit de lo hecho)
2. A2 (diagnósticos page-relative)
3. A3 (basura al final de handler)
4. A4 (scanner de eventos)
5. B1 + B2 (frontmatter)
6. B3 (captures real)
7. C1 + C2 + C3 (Rust)
8. C4 + C5 (Rust spans/nombres)
9. D1 + D2 + D3 (integración/runtime)

---

## Convenciones durante este plan

- No agregar nuevas features al lenguaje (no nuevas directivas, no hydration, no signals, etc.).
- Preferir tests de regresión antes o junto con cada cambio.
- Mantener la sintaxis pública exactamente igual: `(event)="handler($event)"`, `@if`, `@for`, `@switch`.
- Actualizar este archivo y `compiler-session-context.md` al final de cada sesión.
