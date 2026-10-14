import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Flat config for Next 16. The bare `eslint-config-next` entry point leaves out
 * both the Core Web Vitals rules and typescript-eslint's recommended set, so a
 * config that only spreads it silently misses unused variables and image/script
 * performance problems. These two entry points are the supported way in.
 */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // A leading underscore is how this codebase marks a binding that exists
      // to satisfy a signature or to drop a key; flagging those is noise.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    ignores: [".next/**", "out/**", "build/**", "dist/**", ".dev-data/**", "next-env.d.ts", ".claude/**"],
  },
];

export default eslintConfig;
