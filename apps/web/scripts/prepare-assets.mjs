/**
 * Static asset preparation script for self-hosted Tesseract.js OCR.
 *
 * Copies worker, WebAssembly binaries/glue, and language traineddata
 * from node_modules into the web app's public directory so recognition
 * runs 100% locally in the browser with ZERO remote CDN or inference calls.
 */

import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// apps/web directory
const webDir = resolve(__dirname, "..");
const repoRoot = resolve(webDir, "../..");

function findPackageDir(pkgName) {
  const candidates = [
    resolve(webDir, "node_modules", pkgName),
    resolve(repoRoot, "node_modules", pkgName),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Package ${pkgName} not found in node_modules at ${candidates.join(" or ")}`);
}

export function prepareAssets() {
  const tesseractDir = findPackageDir("tesseract.js");
  const coreDir = findPackageDir("tesseract.js-core");
  const dataDir = findPackageDir("@tesseract.js-data/eng");

  const publicDir = resolve(webDir, "public", "tesseract");
  const coreTargetDir = join(publicDir, "core");
  const langTargetDir = join(publicDir, "lang-data");

  mkdirSync(publicDir, { recursive: true });
  mkdirSync(coreTargetDir, { recursive: true });
  mkdirSync(langTargetDir, { recursive: true });

  let copiedCount = 0;
  let totalBytes = 0;

  function copy(src, dest) {
    if (!existsSync(src)) {
      throw new Error(`Source file missing: ${src}`);
    }
    copyFileSync(src, dest);
    const size = statSync(dest).size;
    copiedCount++;
    totalBytes += size;
    console.log(`Copied ${src} -> ${dest} (${(size / 1024).toFixed(1)} KB)`);
  }

  // 1. Worker
  const workerSrc = join(tesseractDir, "dist", "worker.min.js");
  const workerDest = join(publicDir, "worker.min.js");
  copy(workerSrc, workerDest);

  // 2. Core (copy all wasm and wasm.js variants so SIMD and non-SIMD both work offline)
  const coreFiles = [
    "tesseract-core-simd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm",
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-lstm.wasm",
    "tesseract-core-simd.wasm.js",
    "tesseract-core-simd.wasm",
    "tesseract-core.wasm.js",
    "tesseract-core.wasm",
  ];

  for (const file of coreFiles) {
    const src = join(coreDir, file);
    if (existsSync(src)) {
      copy(src, join(coreTargetDir, file));
    }
  }

  // 3. Language traineddata (eng)
  const langCandidates = [
    join(dataDir, "4.0.0", "eng.traineddata.gz"),
    join(dataDir, "4.0.0_best_int", "eng.traineddata.gz"),
    join(dataDir, "4.0.0_fast", "eng.traineddata.gz"),
  ];

  let langFound = false;
  for (const candidate of langCandidates) {
    if (existsSync(candidate)) {
      copy(candidate, join(langTargetDir, "eng.traineddata.gz"));
      langFound = true;
      break;
    }
  }

  if (!langFound) {
    throw new Error(`eng.traineddata.gz not found under ${dataDir}`);
  }

  console.log(`\nSelf-hosted OCR assets prepared successfully: ${copiedCount} files, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB total.`);
}

// Execute if run as script
if (process.argv[1] === __filename) {
  try {
    prepareAssets();
  } catch (err) {
    console.error("Asset preparation failed:", err.message);
    process.exit(1);
  }
}
