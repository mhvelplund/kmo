import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/dist/", "packages/kmo-spike/", "packages/spike-lib/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
);
