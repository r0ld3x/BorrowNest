// Test-only module hooks: resolve the "@/..." path alias (tsconfig paths)
// to files under src/ so unit tests can import app modules unchanged.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(srcRoot, specifier.slice(2));
      for (const suffix of CANDIDATES) {
        if (existsSync(base + suffix)) return nextResolve(pathToFileURL(base + suffix).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
