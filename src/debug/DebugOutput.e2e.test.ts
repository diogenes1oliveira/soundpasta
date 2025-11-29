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
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";

interface DeviceInfo {
  name: string;
  description: string;
}

describe("DebugOutput Sine Wave Playback", () => {
  let browser: Browser;
  let page: Page;
  let context: BrowserContext;
  let viteServer: ChildProcess | null = null;
  let serverPort: number;

  const virtualPipeName = `soundpasta-test-output-${randomUUID()}`;
  let sinkDescription: string;

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

    // Resolve sink description
    sinkDescription = resolveSinkDescription(virtualPipeName);

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
      headless: false, // Headful mode required for audio routing
      args: [
        "--use-fake-ui-for-media-stream",
        "--allow-running-insecure-content",
        "--autoplay-policy=no-user-gesture-required",
        "--ignore-certificate-errors",
        "--disable-gpu", // May help in some environments
        "--no-sandbox", // Required in some CI environments
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

  it("should play 18kHz sine wave to selected sink", async () => {
    const targetFrequency = 18000;
    const duration = 1.0;
    const sampleRate = 44100;

    const tempDir = tmpdir();
    const recordedPath = join(tempDir, `recorded-output-${Date.now()}.wav`);

    try {
      page.on("console", (msg) => {
        console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
      });

      page.on("pageerror", (error) => {
        console.error(`[Browser] Page error: ${error.message}`);
      });

      const url = `https://localhost:${serverPort}/debug/output?sink_description=${encodeURIComponent(
        sinkDescription
      )}`;

      await page.goto(url, { waitUntil: "networkidle" });

      // Wait for page to load
      await page.waitForSelector("#sink", { timeout: 10000 });

      // Click on page to trigger permission request (getUserMedia requires user gesture)
      await page.click("body");

      // Wait for devices to enumerate (may need permission)
      // Wait for sink to appear in dropdown - try matching by label or by checking if description is in the text
      await page.waitForFunction(
        (desc) => {
          const select = document.querySelector<HTMLSelectElement>("#sink");
          if (!select) return false;
          const options = Array.from(select.options);
          // Try to match by full label or if description is contained in label
          return options.some(
            (opt) => opt.text === desc || opt.text.includes(desc)
          );
        },
        sinkDescription,
        { timeout: 10000 }
      );

      // Try to select by label first, if that fails try by index or value
      try {
        await page.selectOption("#sink", { label: sinkDescription });
      } catch {
        // If label matching fails, try to find by partial match
        const sinkSelected = await page.evaluate((desc) => {
          const select = document.querySelector<HTMLSelectElement>("#sink");
          if (!select) return false;
          const options = Array.from(select.options);
          const matchingOption = options.find(
            (opt) => opt.text === desc || opt.text.includes(desc)
          );
          if (matchingOption) {
            select.value = matchingOption.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          return false;
        }, sinkDescription);
        if (!sinkSelected) {
          throw new Error(
            `Could not find sink with description: ${sinkDescription}`
          );
        }
      }

      // Verify sink is selected
      const selectedValue = await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>("#sink");
        return select?.value || "";
      });
      expect(selectedValue).not.toBe("");

      // Debug: Log available sinks and selected value
      const sinkInfo = await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>("#sink");
        if (!select) return { options: [], selected: "" };
        return {
          options: Array.from(select.options).map((opt) => ({
            value: opt.value,
            text: opt.text,
            selected: opt.selected,
          })),
          selected: select.value,
        };
      });
      console.log("Sink info:", JSON.stringify(sinkInfo, null, 2));
      console.log("Looking for sink description:", sinkDescription);

      // Verify the sink description is actually in the dropdown
      const sinkFound = sinkInfo.options.some(
        (opt) =>
          opt.text === sinkDescription || opt.text.includes(sinkDescription)
      );
      if (!sinkFound) {
        const allSinkTexts = sinkInfo.options.map((opt) => opt.text).join(", ");
        throw new Error(
          `Sink description "${sinkDescription}" not found in dropdown. Available sinks: ${allSinkTexts}`
        );
      }
      console.log("✓ Sink description found in dropdown");

      // Enter frequency
      await page.fill("#frequency", targetFrequency.toString());

      // Enter duration
      await page.fill("#duration", duration.toString());

      // Start recording from monitor source
      const monitorSource = `${virtualPipeName}.monitor`;
      const recordDuration = duration + 2.0;

      const recordProcess = spawn(
        "uv",
        [
          "run",
          "soundpasta",
          "device",
          "input",
          "record",
          monitorSource,
          recordedPath,
          recordDuration.toString(),
        ],
        {
          stdio: "ignore",
        }
      );

      const recordPromise = new Promise<void>((resolve, reject) => {
        recordProcess.on("exit", (code) => {
          if (code === 0 || code === null) {
            resolve();
          } else {
            reject(new Error(`Recording process exited with code ${code}`));
          }
        });
        recordProcess.on("error", (error) => {
          reject(error);
        });
      });

      // Wait a bit for recording to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Click play button
      await page.click('button:has-text("Play")');

      // Wait for playing status to appear and verify no errors
      await page
        .waitForSelector('button:has-text("Playing...")', {
          timeout: 5000,
        })
        .catch(async (e) => {
          // Debug: Check for errors
          console.error("Failed to see Playing status:", e);
          const errorMsg = await page.evaluate(() => {
            const errorDiv = document.querySelector('div[style*="crimson"]');
            return errorDiv?.textContent || "No error message found";
          });
          console.error("Error message on page:", errorMsg);

          // Also check browser console for setSinkId errors
          const consoleErrors: string[] = [];
          page.on("console", (msg) => {
            if (msg.type() === "error") {
              consoleErrors.push(msg.text());
            }
          });

          throw new Error(
            `Playback failed: ${errorMsg}. Console errors: ${consoleErrors.join(
              ", "
            )}`
          );
        });

      // Verify no error is displayed
      const hasError = await page.evaluate(() => {
        const errorDiv = document.querySelector('div[style*="crimson"]');
        return errorDiv !== null;
      });
      expect(hasError).toBe(false);

      // Wait for playback to complete (check for button to be enabled again)
      await page.waitForSelector('button:not(:disabled):has-text("Play")', {
        timeout: 30000,
      });

      // Wait a bit more to ensure audio has finished
      await new Promise((resolve) => setTimeout(resolve, 500));

      await recordPromise;

      if (!existsSync(recordedPath)) {
        throw new Error("Recording file not created");
      }

      const fileSize = readFileSync(recordedPath).length;
      expect(fileSize).toBeGreaterThan(1000);

      // Verify frequency using Python
      execSync(
        `python3 -c "
import numpy as np
import soundfile as sf
data, sr = sf.read('${recordedPath}')
if len(data.shape) > 1:
    data = data[:, 0]
max_amp = np.max(np.abs(data))
assert max_amp > 0.01, f'Signal too quiet: {max_amp}'
assert sr == ${sampleRate}, f'Wrong sample rate: {sr}'
fft = np.fft.fft(data)
freqs = np.fft.fftfreq(len(data), 1/sr)
magnitude = np.abs(fft)
peak_idx = np.argmax(magnitude[:len(magnitude)//2])
peak_freq = abs(freqs[peak_idx])
assert abs(peak_freq - ${targetFrequency}) < 500, f'Wrong frequency: {peak_freq}Hz'
print(f'Peak frequency: {peak_freq}Hz, amplitude: {max_amp}')
"`,
        { stdio: "pipe" }
      );
    } finally {
      if (existsSync(recordedPath)) unlinkSync(recordedPath);
    }
  }, 90000);

  it("should play 19kHz sine wave to selected sink", async () => {
    const targetFrequency = 19000;
    const duration = 1.0;
    const sampleRate = 44100;

    const tempDir = tmpdir();
    const recordedPath = join(tempDir, `recorded-output-${Date.now()}.wav`);

    try {
      page.on("console", (msg) => {
        console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
      });

      page.on("pageerror", (error) => {
        console.error(`[Browser] Page error: ${error.message}`);
      });

      const url = `https://localhost:${serverPort}/debug/output?sink_description=${encodeURIComponent(
        sinkDescription
      )}`;

      await page.goto(url, { waitUntil: "networkidle" });

      // Wait for page to load
      await page.waitForSelector("#sink", { timeout: 10000 });

      // Wait for sink to appear in dropdown
      await page.waitForFunction(
        (desc) => {
          const select = document.querySelector<HTMLSelectElement>("#sink");
          if (!select) return false;
          const options = Array.from(select.options);
          return options.some((opt) => opt.text === desc);
        },
        sinkDescription,
        { timeout: 10000 }
      );

      // Select sink from dropdown by label
      await page.selectOption("#sink", { label: sinkDescription });

      // Verify sink is selected
      const selectedValue = await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>("#sink");
        return select?.value || "";
      });
      expect(selectedValue).not.toBe("");

      // Debug: Log available sinks and selected value
      const sinkInfo = await page.evaluate(() => {
        const select = document.querySelector<HTMLSelectElement>("#sink");
        if (!select) return { options: [], selected: "" };
        return {
          options: Array.from(select.options).map((opt) => ({
            value: opt.value,
            text: opt.text,
            selected: opt.selected,
          })),
          selected: select.value,
        };
      });
      console.log("Sink info:", JSON.stringify(sinkInfo, null, 2));
      console.log("Looking for sink description:", sinkDescription);

      // Verify the sink description is actually in the dropdown
      const sinkFound = sinkInfo.options.some(
        (opt) =>
          opt.text === sinkDescription || opt.text.includes(sinkDescription)
      );
      if (!sinkFound) {
        const allSinkTexts = sinkInfo.options.map((opt) => opt.text).join(", ");
        throw new Error(
          `Sink description "${sinkDescription}" not found in dropdown. Available sinks: ${allSinkTexts}`
        );
      }
      console.log("✓ Sink description found in dropdown");

      // Enter frequency
      await page.fill("#frequency", targetFrequency.toString());

      // Enter duration
      await page.fill("#duration", duration.toString());

      // Start recording from monitor source
      const monitorSource = `${virtualPipeName}.monitor`;
      const recordDuration = duration + 2.0;

      const recordProcess = spawn(
        "uv",
        [
          "run",
          "soundpasta",
          "device",
          "input",
          "record",
          monitorSource,
          recordedPath,
          recordDuration.toString(),
        ],
        {
          stdio: "ignore",
        }
      );

      const recordPromise = new Promise<void>((resolve, reject) => {
        recordProcess.on("exit", (code) => {
          if (code === 0 || code === null) {
            resolve();
          } else {
            reject(new Error(`Recording process exited with code ${code}`));
          }
        });
        recordProcess.on("error", (error) => {
          reject(error);
        });
      });

      // Wait a bit for recording to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Click play button
      await page.click('button:has-text("Play")');

      // Wait for playback to complete
      await page.waitForSelector('button:not(:disabled):has-text("Play")', {
        timeout: 30000,
      });

      await recordPromise;

      if (!existsSync(recordedPath)) {
        throw new Error("Recording file not created");
      }

      const fileSize = readFileSync(recordedPath).length;
      expect(fileSize).toBeGreaterThan(1000);

      // Verify frequency using Python
      execSync(
        `python3 -c "
import numpy as np
import soundfile as sf
data, sr = sf.read('${recordedPath}')
if len(data.shape) > 1:
    data = data[:, 0]
max_amp = np.max(np.abs(data))
assert max_amp > 0.01, f'Signal too quiet: {max_amp}'
assert sr == ${sampleRate}, f'Wrong sample rate: {sr}'
fft = np.fft.fft(data)
freqs = np.fft.fftfreq(len(data), 1/sr)
magnitude = np.abs(fft)
peak_idx = np.argmax(magnitude[:len(magnitude)//2])
peak_freq = abs(freqs[peak_idx])
assert abs(peak_freq - ${targetFrequency}) < 500, f'Wrong frequency: {peak_freq}Hz'
print(f'Peak frequency: {peak_freq}Hz, amplitude: {max_amp}')
"`,
        { stdio: "pipe" }
      );
    } finally {
      if (existsSync(recordedPath)) unlinkSync(recordedPath);
    }
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

  function resolveSinkDescription(pipeName: string): string {
    try {
      const outputList = execSync(`uv run soundpasta device output list`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      const outputDevices = parseDeviceList(outputList);
      const description =
        getDeviceDescription(outputDevices, pipeName) || pipeName;
      return description;
    } catch (error) {
      console.error("Failed to query output device descriptions:", error);
      return pipeName;
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
