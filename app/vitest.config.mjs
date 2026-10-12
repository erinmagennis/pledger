import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default {
  resolve: { alias: { "@": src } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
};
