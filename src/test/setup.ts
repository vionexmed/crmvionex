import "@testing-library/jest-dom";

// O setup roda para TODOS os arquivos, inclusive os que rodam em `node` e não
// têm `window`. Sem a guarda, `defineProperty` lançaria antes do primeiro teste.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
