#!/usr/bin/env node
// Spec conformance checker.
//
// Parses the SPEC-HTML-NNN requirement declarations in docs/flowview-spec.md,
// scans recognized test files for `@spec SPEC-HTML-NNN` annotations, and
// verifies that every requirement has executable evidence and that every
// annotation points at a real requirement.
//
//   node scripts/spec-coverage.mjs           validate and print the report
//   node scripts/spec-coverage.mjs --check   validate and fail on a stale report
//   node scripts/spec-coverage.mjs --write   validate and rewrite the report
//
// No dependencies: Node standard library only.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = "docs/flowview-spec.md";
const REPORT_PATH = "docs/spec-coverage.md";

const ID_PATTERN = /^SPEC-HTML-\d{3,}$/;
// A declaration is a (possibly list-item) line that *starts* with the bold ID
// followed by an em dash. Anything else that mentions an ID is a cross-reference.
const DECLARATION = /^\s*(?:[-*]\s+)?\*\*(SPEC-[^*\s]*)\*\*\s*—\s*(.*)$/;
const REFERENCE = /SPEC-[A-Za-z]+-[A-Za-z0-9]*/g;

const SKIPPED_DIRS = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  ".git",
  ".astro",
  "pkg",
  "fuzz",
  "test-results",
  "playwright-report",
]);
const SCANNED_ROOTS = ["crates", "packages", "examples"];
const CODE_EXTENSIONS = /\.(rs|ts|tsx|mjs|js)$/;

/** Files whose executable tests are accepted as conformance evidence. */
function isTestFile(rel) {
  if (/^crates\/[^/]+\/tests\/.+\.rs$/.test(rel)) return true;
  if (/^crates\/[^/]+\/src\/.+\/(tests|[a-z_]+_tests)\.rs$/.test(rel)) {
    return true;
  }
  if (/^(packages|examples)\/.+\.test\.(ts|tsx|mjs|js)$/.test(rel)) return true;
  if (/^(packages|examples)\/.+\/e2e\/.+\.spec\.ts$/.test(rel)) return true;
  return false;
}

/** The first code line after an annotation must start a test. */
const TEST_START = [
  /^#\[(?:\w+::)?test\b/, // Rust #[test], #[tokio::test]
  /^fn\s+\w+/, // Rust fn inside proptest! { ... }
  /^(?:it|test|describe)(?:\.\w+)*\s*[(`]/, // Vitest / Playwright
  /^(?:it|test|describe)\.each\b/,
  /^\{$/, // top-level assertion block in a plain node:assert script
];

function readText(rel) {
  return readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function walk(rel, out) {
  for (const entry of readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child, out);
    else if (CODE_EXTENSIONS.test(entry.name)) out.push(child);
  }
}

function numeric(id) {
  return Number.parseInt(id.slice("SPEC-HTML-".length), 10);
}

function parseSpec(errors) {
  const text = readText(SPEC_PATH);
  const lines = text.split("\n");
  const requirements = new Map();
  const references = [];
  let area = "";
  let inFence = false;
  let current = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^```/.test(line.trimStart())) inFence = !inFence;
    if (!inFence && /^## /.test(line)) {
      area = line.slice(3).trim();
      current = null;
      return;
    }

    const declaration = inFence ? null : DECLARATION.exec(line);
    if (declaration) {
      const [, id, rest] = declaration;
      current = null;
      if (!ID_PATTERN.test(id)) {
        errors.push(
          `${SPEC_PATH}:${lineNumber}: malformed requirement ID "${id}" (expected SPEC-HTML-NNN)`,
        );
        return;
      }
      if (requirements.has(id)) {
        errors.push(
          `${SPEC_PATH}:${lineNumber}: duplicate declaration of ${id} (first declared at line ${requirements.get(id).line})`,
        );
        return;
      }
      current = { id, area, line: lineNumber, text: rest.trim() };
      requirements.set(id, current);
      return;
    }

    // Wrapped continuation of the current declaration's first paragraph.
    if (current && line.trim() !== "" && /^\s{2,}\S/.test(line)) {
      if (!/^\s*[-*]\s/.test(line) && !/^\s*```/.test(line)) {
        if (!current.closed) current.text += ` ${line.trim()}`;
      } else {
        current.closed = true;
      }
    } else if (current) {
      current.closed = true;
      if (line.trim() === "") current = null;
    }

    for (const match of line.matchAll(REFERENCE)) {
      references.push({ token: match[0], line: lineNumber });
    }
  });

  for (const { token, line } of references) {
    if (!ID_PATTERN.test(token)) {
      errors.push(
        `${SPEC_PATH}:${line}: malformed requirement reference "${token}"`,
      );
    } else if (!requirements.has(token)) {
      errors.push(
        `${SPEC_PATH}:${line}: reference to undeclared requirement ${token}`,
      );
    }
  }
  return requirements;
}

function scanTests(requirements, errors) {
  const files = [];
  for (const dir of SCANNED_ROOTS) {
    if (existsSync(path.join(root, dir))) walk(dir, files);
  }
  files.sort();

  /** id -> Map(file -> annotation count) */
  const evidence = new Map();
  for (const rel of files) {
    const lines = readText(rel).split("\n");
    const testFile = isTestFile(rel);
    lines.forEach((line, index) => {
      const match = /^\s*(?:\/\/|\/\*|\*)\s*@spec\b(.*)$/.exec(line);
      if (!match) return;
      const where = `${rel}:${index + 1}`;
      if (!testFile) {
        errors.push(
          `${where}: @spec annotation outside a recognized test file (evidence must be an executable test)`,
        );
        return;
      }
      const ids = match[1].split(/[\s,]+/).filter(Boolean);
      if (ids.length === 0) {
        errors.push(`${where}: @spec annotation lists no requirement ID`);
        return;
      }
      if (!attachedToTest(lines, index)) {
        errors.push(`${where}: @spec annotation is not directly above a test`);
        return;
      }
      for (const id of new Set(ids)) {
        if (!ID_PATTERN.test(id)) {
          errors.push(`${where}: malformed requirement ID "${id}"`);
        } else if (!requirements.has(id)) {
          errors.push(`${where}: unknown requirement ${id}`);
        } else {
          const perFile = evidence.get(id) ?? new Map();
          perFile.set(rel, (perFile.get(rel) ?? 0) + 1);
          evidence.set(id, perFile);
        }
      }
    });
  }
  return evidence;
}

/** True when the next code line (skipping comments/blank lines) starts a test. */
function attachedToTest(lines, annotationIndex) {
  for (let i = annotationIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || /^(\/\/|\/\*|\*)/.test(trimmed)) continue;
    return TEST_START.some((pattern) => pattern.test(trimmed));
  }
  return false;
}

function shorten(text) {
  const plain = text.replace(/\s+/g, " ").replace(/\|/g, "\\|");
  if (plain.length <= 150) return plain;
  const cut = plain.slice(0, 147);
  return `${cut.slice(0, cut.lastIndexOf(" "))}...`;
}

function buildReport(requirements, evidence) {
  const sorted = [...requirements.values()].sort(
    (a, b) => numeric(a.id) - numeric(b.id),
  );
  const covered = sorted.filter((r) => evidence.has(r.id));
  const uncovered = sorted.filter((r) => !evidence.has(r.id));
  const percent = sorted.length
    ? ((covered.length / sorted.length) * 100).toFixed(1)
    : "100.0";

  const areas = new Map();
  for (const requirement of sorted) {
    const entry = areas.get(requirement.area) ?? { total: 0, covered: 0 };
    entry.total += 1;
    if (evidence.has(requirement.id)) entry.covered += 1;
    areas.set(requirement.area, entry);
  }

  const out = [];
  out.push("# Spec conformance coverage", "");
  out.push(
    `<!-- Generated by scripts/spec-coverage.mjs from ${SPEC_PATH}. Do not edit; run \`node scripts/spec-coverage.mjs --write\`. -->`,
    "",
  );
  out.push(
    "Every normative requirement in [flowview-spec.md](flowview-spec.md) is mapped to the tests that enforce it through `@spec SPEC-HTML-NNN` annotations.",
    "",
  );
  out.push("## Summary", "");
  out.push(`- Total normative requirements: ${sorted.length}`);
  out.push(`- Covered: ${covered.length}`);
  out.push(`- Uncovered: ${uncovered.length}`);
  out.push(`- Coverage: ${percent}%`, "");
  out.push("## Requirements by spec area", "");
  out.push("| Spec area | Requirements | Covered |", "| --- | --- | --- |");
  for (const [area, entry] of areas) {
    out.push(`| ${area} | ${entry.total} | ${entry.covered} |`);
  }
  out.push("");
  out.push("## Requirements", "");
  out.push("| ID | Requirement | Enforcing tests |", "| --- | --- | --- |");
  for (const requirement of sorted) {
    const files = [...(evidence.get(requirement.id) ?? new Map())]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, count]) => `\`${file}\` (${count})`)
      .join("<br>");
    out.push(
      `| ${requirement.id} | ${shorten(requirement.text)} | ${files || "**none**"} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

function main() {
  const mode = process.argv[2];
  if (mode !== undefined && mode !== "--check" && mode !== "--write") {
    console.error("usage: spec-coverage.mjs [--check | --write]");
    process.exit(2);
  }

  const errors = [];
  const requirements = parseSpec(errors);
  const evidence = scanTests(requirements, errors);

  for (const requirement of requirements.values()) {
    if (!evidence.has(requirement.id)) {
      errors.push(
        `${SPEC_PATH}:${requirement.line}: ${requirement.id} has no enforcing test (add "// @spec ${requirement.id}" above a test)`,
      );
    }
  }
  if (requirements.size === 0) {
    errors.push(`${SPEC_PATH}: no requirement declarations found`);
  }

  const report = buildReport(requirements, evidence);

  if (mode === "--write" && errors.length === 0) {
    writeFileSync(path.join(root, REPORT_PATH), report);
    console.log(`Wrote ${REPORT_PATH} (${requirements.size} requirements).`);
  } else if (mode === "--check" && errors.length === 0) {
    const committed = existsSync(path.join(root, REPORT_PATH))
      ? readText(REPORT_PATH)
      : "";
    if (committed !== report) {
      errors.push(
        `${REPORT_PATH} is stale; run "node scripts/spec-coverage.mjs --write" and commit the result`,
      );
    }
  } else if (mode === undefined && errors.length === 0) {
    process.stdout.write(report);
  }

  if (errors.length > 0) {
    console.error(`Spec conformance check failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  if (mode === "--check") {
    console.log(
      `Spec conformance OK: ${requirements.size}/${requirements.size} requirements covered, report current.`,
    );
  }
}

main();
