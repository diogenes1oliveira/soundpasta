import { readFileSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const vendorDir = join(process.cwd(), "vendor/quiet-js");
const publicDir = join(process.cwd(), "public/quietjs");
const patchesDir = join(process.cwd(), "vendor/patches");

// Ensure public directory exists
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

// Copy original quiet.js to public directory first
const quietJsPath = join(vendorDir, "quiet.js");
const patchedQuietJsPath = join(publicDir, "quiet.js");
copyFileSync(quietJsPath, patchedQuietJsPath);

// Apply patch using Unix patch command
const patchFile = join(patchesDir, "quiet.js.patch");
if (existsSync(patchFile)) {
  const patchContent = readFileSync(patchFile, "utf-8");
  // Check if patch file has actual changes (not just comments/whitespace)
  const hasChanges = patchContent.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#");
  });

  if (hasChanges) {
    try {
      // Apply patch from public directory (patch file uses relative path "quiet.js")
      execSync(`cd ${publicDir} && patch -p0 < ${patchFile}`, {
        stdio: "inherit",
      });
    } catch (error) {
      console.error("Failed to apply patch:", error);
      process.exit(1);
    }
  } else {
    console.log(
      "Patch file is empty (only comments), skipping patch application"
    );
  }
}

// Copy other files
const filesToCopy = [
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

// Verify JavaScript syntax
try {
  // Read the patched file content
  const patchedContent = readFileSync(patchedQuietJsPath, "utf-8");
  // Use Node.js vm module to check syntax
  const { createContext, Script } = await import("vm");
  const script = new Script(patchedContent);
  // This will throw if syntax is invalid
  script.runInContext(createContext({}));
  console.log("✓ Generated quiet.js syntax is valid");
} catch (error) {
  console.error("✗ Generated quiet.js has syntax errors:");
  console.error(error);
  process.exit(1);
}

console.log("✓ Bundled quiet.js files to public/quietjs/");
