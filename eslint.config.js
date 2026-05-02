import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/forge-out/**",
      "**/forge-cache/**",
      "**/.next/**",
      "**/.tsbuildinfo",
      "contracts/lib/**",
      "pnpm-lock.yaml",
      "*.config.js",
      "packages/*/scripts/**",
      "examples/nextjs-organizer/next-env.d.ts",
      "examples/nextjs-organizer/**/*.tsx",
      "examples/nextjs-organizer/next.config.js",
      "examples/nextjs-organizer/src/app/api/**/*.ts",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
