// Vitest runs from ../verify/node_modules (no install in app). See "test" script.
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));
const vitest = fileURLToPath(new URL("../verify/node_modules/vitest", import.meta.url));
const postalMime = fileURLToPath(new URL("../verify/node_modules/postal-mime", import.meta.url));

export default {
  resolve: { alias: { "@": src, vitest, "postal-mime": postalMime } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
};
