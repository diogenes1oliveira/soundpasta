import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { IncomingMessage, ServerResponse } from "http";

// Vite plugin to serve quietjs files from vendor directory
function quietJSPlugin(): Plugin {
  return {
    name: "quietjs-serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/quietjs",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const vendorDir = join(process.cwd(), "vendor/quiet-js");
          const filePath = join(
            vendorDir,
            req.url?.replace(/^\/quietjs\//, "") || ""
          );

          try {
            const content = readFileSync(filePath);
            const ext = filePath.split(".").pop();
            const mimeTypes: Record<string, string> = {
              js: "application/javascript",
              json: "application/json",
              mem: "application/octet-stream",
            };
            res.setHeader(
              "Content-Type",
              mimeTypes[ext || ""] || "application/octet-stream"
            );
            res.end(content);
          } catch {
            next();
          }
        }
      );
    },
    buildStart() {
      // For build, copy files to public during build
      const vendorDir = join(process.cwd(), "vendor/quiet-js");
      const publicDir = join(process.cwd(), "public/quietjs");

      if (!existsSync(publicDir)) {
        mkdirSync(publicDir, { recursive: true });
      }

      const filesToCopy = [
        "quiet.js",
        "quiet-emscripten.js",
        "quiet-emscripten.js.mem",
        "quiet-profiles.json",
      ];

      for (const file of filesToCopy) {
        const src = join(vendorDir, file);
        const dest = join(publicDir, file);
        if (existsSync(src)) {
          copyFileSync(src, dest);
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), quietJSPlugin()],
  server: {
    https: (() => {
      try {
        const key = readFileSync(join(process.cwd(), "localhost-key.pem"));
        const cert = readFileSync(join(process.cwd(), "localhost.pem"));
        return { key, cert };
      } catch {
        // If certs are missing, fall back to HTTP without throwing
        return undefined as unknown as { key: Buffer; cert: Buffer };
      }
    })(),
  },
});
