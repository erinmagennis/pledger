import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));
// Next handles `import "server-only"` at build time; in tests it is a no-op.
const serverOnly = fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url));

export default {
  resolve: { alias: { "@": src, "server-only": serverOnly } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
};
