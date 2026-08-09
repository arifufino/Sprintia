import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".package-cache/**",
    ".vercel/**",
    ".vinext/**",
    ".wrangler/**",
    "dist/**",
    "outputs/**",
    "out/**",
    "work/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
