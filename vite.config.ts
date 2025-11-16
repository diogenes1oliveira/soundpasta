import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { join } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    https: (() => {
      const certsDir = join(process.cwd(), "certs");
      const key = readFileSync(join(certsDir, "localhost.key"));
      const cert = readFileSync(join(certsDir, "localhost.crt"));
      return { key, cert };
    })(),
  },
});
