import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";

// eslint-config-next 15.x todavía publica configuraciones en formato legacy
// (.eslintrc): `core-web-vitals.js` y `typescript.js` exportan objetos con
// `extends`, no arreglos de flat config. Por eso se cargan con FlatCompat en
// lugar de hacer spread directo (que producía `nextVitals is not iterable`).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
];

export default eslintConfig;
