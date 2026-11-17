// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    // `conformance/**/repo/**` holds fixture repositories, not project source:
    // they deliberately contain unresolved imports, CommonJS, and committed
    // build output, and they are read as data by the conformance suite.
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "examples/**",
      "conformance/**/repo/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Plain ESM config and research scripts are outside the TypeScript
          // program; the default project count stays small and explicit.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 12,
          // `scripts/regenerate-discover-fixture.ts` is the one typed script: it
          // imports the implementation to generate the canonical discovery JSON
          // fixture, so it is part of the TypeScript program and is type-checked
          // by `pnpm typecheck` alongside the code it renders.
          allowDefaultProject: [
            "eslint.config.js",
            "vitest.config.ts",
            "scripts/*.mjs",
            "research/phase1-benchmark/*.mjs",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["**/*.mjs", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Plain ESM outside the TypeScript program has no type information, so
      // the type-aware `no-unsafe-*` family cannot evaluate it meaningfully.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  prettierConfig,
];
