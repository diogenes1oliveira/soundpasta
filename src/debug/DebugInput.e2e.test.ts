import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { execSync, spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { createServer } from "net";
import https from "https";

interface DeviceInfo {
  name: string;
  description: string;
}

describe("DebugInput Frequency Readout", () => {
  let browser: Browser;
  let page: Page;
  let context: BrowserContext;
  let viteServer: ChildProcess | null = null;
  let serverPort: number;

  const virtualPipeName = `soundpasta-test-output-${randomUUID()}`;
  let remappedInputDescription: string;

  beforeAll(async () => {
    // Cleanup any leftover pipes with soundpasta-test- prefix
    try {
      execSync(`uv run soundpasta device output remove ${virtualPipeName}`, {
        stdio: "ignore",
      });
    } catch {
      // Ignore if pipe doesn't exist
    }

    // Create output pipe
    try {
      execSync(`uv run soundpasta device output create ${virtualPipeName}`, {
        stdio: "pipe",
      });
    } catch (error) {
      console.error(`Failed to create output pipe ${virtualPipeName}:`, error);
      throw error;
    }

    // Resolve remapped input description
    remappedInputDescription = resolveRemappedInputDescription(virtualPipeName);

    // Find an available port
    serverPort = await findAvailablePort();

    // Start vite dev server with nvm use
    viteServer = startDevServerWithNvm(serverPort);

    viteServer.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log("[Vite stdout]:", output);
      if (output.includes("Local:") || output.includes("ready")) {
        // Server is starting
      }
    });

    viteServer.stderr?.on("data", (data) => {
      const output = data.toString();
      if (!output.includes("DeprecationWarning")) {
        console.error("[Vite stderr]:", output);
      }
    });

    viteServer.on("error", (error) => {
      console.error("Failed to start vite server:", error);
    });

    // Wait for server to be ready
    await waitForServer(`https://localhost:${serverPort}`);

    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--allow-running-insecure-content",
        "--autoplay-policy=no-user-gesture-required",
        "--ignore-certificate-errors",
      ],
    });

    context = await browser.newContext({
      permissions: ["microphone"],
      bypassCSP: true,
      ignoreHTTPSErrors: true,
    });
    await context.grantPermissions(["microphone"]);
    page = await context.newPage();
  });

  afterAll(async () => {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();

    if (viteServer) {
      viteServer.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        if (viteServer) {
          viteServer.on("exit", () => resolve());
          setTimeout(() => {
            if (viteServer && !viteServer.killed) {
              viteServer.kill("SIGKILL");
            }
            resolve();
          }, 5000);
        } else {
          resolve();
        }
      });
    }

    // Cleanup created pipe
    try {
      execSync(`uv run soundpasta device output remove ${virtualPipeName}`, {
        stdio: "ignore",
      });
    } catch {
      // Ignore cleanup errors
    }

    // Cleanup any leftover soundpasta-test- pipes
    cleanupTestPipes();
  });

  it("should display 18kHz frequency when playing 18kHz sine wave", async () => {
    const targetFrequency = 18000;

    page.on("console", (msg) => {
      console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
    });

    page.on("pageerror", (error) => {
      console.error(`[Browser] Page error: ${error.message}`);
    });

    const url = `https://localhost:${serverPort}/debug/input?device_description=${encodeURIComponent(
      remappedInputDescription
    )}`;

    await page.goto(url, { waitUntil: "networkidle" });

    // Wait for page to load and device to be selected
    await page.waitForSelector("#freq", { timeout: 10000 });

    // Wait a bit for audio to initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Play sine wave
    playSine(virtualPipeName, targetFrequency);

    // Sample frequency and average
    const averageFrequency = await sampleFrequencyAverage(page);

    expect(Math.abs(averageFrequency - targetFrequency)).toBeLessThanOrEqual(
      400
    );
  }, 90000);

  it("should display 19kHz frequency when playing 19kHz sine wave", async () => {
    const targetFrequency = 19000;

    page.on("console", (msg) => {
      console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
    });

    page.on("pageerror", (error) => {
      console.error(`[Browser] Page error: ${error.message}`);
    });

    const url = `https://localhost:${serverPort}/debug/input?device_description=${encodeURIComponent(
      remappedInputDescription
    )}`;

    await page.goto(url, { waitUntil: "networkidle" });

    // Wait for page to load and device to be selected
    await page.waitForSelector("#freq", { timeout: 10000 });

    // Wait a bit for audio to initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Play sine wave
    playSine(virtualPipeName, targetFrequency);

    // Sample frequency and average
    const averageFrequency = await sampleFrequencyAverage(page);

    expect(Math.abs(averageFrequency - targetFrequency)).toBeLessThanOrEqual(
      400
    );
  }, 90000);

  // Helper functions

  function parseDeviceList(output: string): DeviceInfo[] {
    const devices: DeviceInfo[] = [];
    const lines = output.trim().split("\n");

    let startIdx = 0;
    if (lines[0] && lines[0].startsWith("Name")) {
      startIdx = 1;
    }

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const match = line.match(/^(\S+)\s{2,}(.+?)(?=\s{2,}\S|$)/);
      if (match && match.length >= 3) {
        const name = match[1].trim();
        const description = match[2].trim();
        if (name && description) {
          devices.push({ name, description });
        }
      }
    }

    return devices;
  }

  function getDeviceDescription(
    deviceList: DeviceInfo[],
    deviceName: string
  ): string | null {
    const device = deviceList.find((d) => d.name === deviceName);
    return device ? device.description : null;
  }

  function resolveRemappedInputDescription(pipeName: string): string {
    const remappedSourceName = `${pipeName}-pipe`;

    try {
      const inputList = execSync(`uv run soundpasta device input list`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      const inputDevices = parseDeviceList(inputList);
      const description =
        getDeviceDescription(inputDevices, remappedSourceName) ||
        remappedSourceName;
      return description;
    } catch (error) {
      console.error("Failed to query input device descriptions:", error);
      return remappedSourceName;
    }
  }

  async function findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object" && "port" in address) {
          const port = address.port;
          server.close(() => {
            if (port) {
              resolve(port);
            } else {
              reject(new Error("Failed to get port number"));
            }
          });
        } else {
          server.close();
          reject(new Error("Failed to find available port"));
        }
      });
      server.on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  }

  function startDevServerWithNvm(port: number): ChildProcess {
    return spawn(
      "bash",
      [
        "-lc",
        `source ~/.nvm/nvm.sh && nvm use --silent && npm run dev -- --port ${port}`,
      ],
      {
        stdio: "pipe",
        shell: false,
        detached: false,
        env: { ...process.env },
      }
    );
  }

  async function waitForServer(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const maxAttempts = 30;
      let attempts = 0;
      const urlObj = new URL(url);
      const checkServer = () => {
        const req = https.get(
          {
            hostname: urlObj.hostname,
            port: urlObj.port ? parseInt(urlObj.port, 10) : 443,
            path: urlObj.pathname,
            rejectUnauthorized: true, // Will use NODE_EXTRA_CA_CERTS if set
          },
          (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 400
            ) {
              resolve();
            } else {
              res.resume();
              attempts++;
              if (attempts >= maxAttempts) {
                reject(
                  new Error(
                    `Server failed to start after ${maxAttempts} attempts: status ${res.statusCode}`
                  )
                );
              } else {
                setTimeout(checkServer, 1000);
              }
            }
          }
        );
        req.on("error", (error) => {
          attempts++;
          if (attempts >= maxAttempts) {
            reject(
              new Error(
                `Server failed to start after ${maxAttempts} attempts: ${error}`
              )
            );
          } else {
            setTimeout(checkServer, 1000);
          }
        });
        req.setTimeout(2000, () => {
          req.destroy();
          attempts++;
          if (attempts >= maxAttempts) {
            reject(
              new Error(
                `Server failed to start after ${maxAttempts} attempts: timeout`
              )
            );
          } else {
            setTimeout(checkServer, 1000);
          }
        });
      };
      setTimeout(checkServer, 3000);
    });
  }

  function playSine(
    pipeName: string,
    frequency: number,
    duration = 1.0,
    volume = 0.6
  ): void {
    try {
      execSync(
        `uv run soundpasta device output sine ${pipeName} ${duration} ${frequency} ${volume}`,
        { stdio: "ignore" }
      );
    } catch (error) {
      console.error(`Failed to play sine wave:`, error);
      throw error;
    }
  }

  async function sampleFrequencyAverage(
    page: Page,
    ms = 1000,
    everyMs = 50,
    settleMs = 200
  ): Promise<number> {
    // Wait for settling period
    await new Promise((resolve) => setTimeout(resolve, settleMs));

    const samples: number[] = [];
    const startTime = Date.now();
    const endTime = startTime + ms;

    while (Date.now() < endTime) {
      const freqValue = await page.evaluate(() => {
        const freqInput = document.querySelector<HTMLInputElement>("#freq");
        if (!freqInput) return null;
        const value = parseFloat(freqInput.value);
        return isNaN(value) ? null : value;
      });

      if (freqValue !== null) {
        samples.push(freqValue);
      }

      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }

    if (samples.length === 0) {
      throw new Error("No frequency samples collected");
    }

    const sum = samples.reduce((acc, val) => acc + val, 0);
    return sum / samples.length;
  }

  function cleanupTestPipes(): void {
    try {
      const sinks = execSync(
        `pactl list short sinks | grep "^[0-9]\\+.*soundpasta-test-" | awk '{print $2}'`,
        { encoding: "utf-8", stdio: "pipe" }
      )
        .trim()
        .split("\n")
        .filter((s) => s);

      for (const sinkName of sinks) {
        try {
          const pipeName = sinkName.replace("-pipe$", "");
          execSync(`uv run soundpasta device output remove ${pipeName}`, {
            stdio: "ignore",
          });
        } catch {
          try {
            execSync(`uv run soundpasta device output remove ${sinkName}`, {
              stdio: "ignore",
            });
          } catch {
            // Ignore
          }
        }
      }

      const sources = execSync(
        `pactl list short sources | grep "^[0-9]\\+.*soundpasta-test-" | awk '{print $2}'`,
        { encoding: "utf-8", stdio: "pipe" }
      )
        .trim()
        .split("\n")
        .filter((s) => s && !s.endsWith(".monitor"));

      for (const sourceName of sources) {
        try {
          execSync(`uv run soundpasta device input remove ${sourceName}`, {
            stdio: "ignore",
          });
        } catch {
          // Ignore
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
});
