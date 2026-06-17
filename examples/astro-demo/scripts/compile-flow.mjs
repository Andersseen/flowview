import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, "../..");
const demoRoot = join(__dirname, "..");
const templatesDir = join(demoRoot, "src", "templates");
const generatedDir = join(demoRoot, "src", "generated");

rmSync(generatedDir, { recursive: true, force: true });
mkdirSync(generatedDir, { recursive: true });

const files = readdirSync(templatesDir).filter((name) =>
  name.endsWith(".flow"),
);

for (const file of files) {
  const input = join(templatesDir, file);
  const base = file.slice(0, -extname(file).length);
  const output = join(generatedDir, `${base}.js`);
  const command = `cargo run -p flowmark-cli -- compile "${input}" --out "${output}"`;

  console.log(`Compiling ${file}...`);
  execSync(command, { cwd: workspaceRoot, stdio: "inherit" });
}

console.log("Done.");
