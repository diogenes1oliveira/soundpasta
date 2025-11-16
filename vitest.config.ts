import { defineConfig } from "vitest/config";
import { join } from "path";
import { existsSync } from "fs";

// Set NODE_EXTRA_CA_CERTS if CA cert exists
const caCertPath = join(process.cwd(), "certs", "ca.crt");
if (existsSync(caCertPath)) {
  process.env.NODE_EXTRA_CA_CERTS = caCertPath;
}

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
