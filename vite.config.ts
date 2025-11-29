import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { join } from "path";

// https://vite.dev/config/
export default defineConfig({
  base: process.env.APP_BASE_PATH || "/",
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
