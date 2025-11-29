import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { join } from "path";

// https://vite.dev/config/
const basePath = process.env.APP_BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_APP_BASE_PATH": JSON.stringify(basePath),
  },
  plugins: [react()],
  server: {
    ...(process.env.APP_NO_HTTPS !== "true" && {
      https: (() => {
        const certsDir = join(process.cwd(), "certs");
        const key = readFileSync(join(certsDir, "localhost.key"));
        const cert = readFileSync(join(certsDir, "localhost.crt"));
        return { key, cert };
      })(),
    }),
  },
});
