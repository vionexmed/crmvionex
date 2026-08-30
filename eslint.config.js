import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      /**
       * Ligada. Estava "off", e é literalmente por isso que 50 exports mortos,
       * 12 parâmetros ignorados e 3 arquivos órfãos acumularam sem ninguém ver
       * -- a rede que pegaria tudo isso estava desligada.
       *
       * `argsIgnorePattern` com "^_" existe porque assinatura de callback às
       * vezes obriga a receber um parâmetro que não se usa (o `_` de um map, o
       * `event` de um handler). Prefixar com underscore é a forma de dizer
       * "recebo e não uso, de propósito" -- diferente de esquecer.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
