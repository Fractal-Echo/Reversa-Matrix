#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const repoRoot = process.cwd();
const assetDir = path.join(repoRoot, "docs", "assets");
const renderDir = path.join(repoRoot, "local", "asset-renders");
const landingHeroAsset = "reversa-matrix-nebula-hero.svg";
const archivedHeroAsset = "reversa-matrix-redmagic-cross.png";
const oldHeroAssets = [
  "reversa-matrix-monogram.svg",
  "reversa-matrix-hero-v3.svg",
];

function fail(message) {
  console.error(`Asset check failed: ${message}`);
  process.exitCode = 1;
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function parseViewBox(svg, file) {
  const match = svg.match(/\bviewBox="([^"]+)"/);
  if (!match) {
    fail(`${file} is missing a viewBox`);
    return null;
  }
  const values = match[1].trim().split(/\s+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    fail(`${file} has an invalid viewBox: ${match[1]}`);
    return null;
  }
  return { width: values[2], height: values[3] };
}

function readPngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("rendered output is not a PNG");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function checkHeroReferences() {
  const refs = [
    ["README.md", readText(path.join(repoRoot, "README.md"))],
    ["docs/index.md", readText(path.join(repoRoot, "docs", "index.md"))],
  ];

  for (const [file, text] of refs) {
    for (const oldHeroAsset of oldHeroAssets) {
    if (text.includes(oldHeroAsset)) {
      fail(`${file} still references stale cached hero asset ${oldHeroAsset}`);
    }
  }
    if (text.includes(archivedHeroAsset)) {
      fail(`${file} still references archived hero asset ${archivedHeroAsset}`);
    }
    if (!text.includes(landingHeroAsset)) {
      fail(`${file} does not reference ${landingHeroAsset}`);
    }
  }
}

function checkLandingHeroAsset() {
  const file = path.join(assetDir, landingHeroAsset);
  if (!fs.existsSync(file)) {
    fail(`missing expected landing hero asset ${landingHeroAsset}`);
    return;
  }
  const svg = readText(file);
  const dims = parseViewBox(svg, path.relative(repoRoot, file));
  if (!dims) return;
  if (dims.width < 1000 || dims.height < 500) {
    fail(`${landingHeroAsset} is too small: ${dims.width}x${dims.height}`);
  }
  const ratio = dims.width / dims.height;
  if (ratio < 1.65 || ratio > 2.1) {
    fail(`${landingHeroAsset} should remain wide hero art, got ${dims.width}x${dims.height}`);
  }
}

function checkHeroStructure(svg) {
  const staleFragments = [
    "scan=true",
    "frontier=preserved",
    "mutation=blocked",
    "json/jsonl are source of truth",
    "EVIDENCE FIRST / PATCHES GUARDED",
  ];
  for (const fragment of staleFragments) {
    if (svg.includes(fragment)) {
      fail(`${svgHeroAsset} still contains clipped stale text fragment: ${fragment}`);
    }
  }

  const requiredFragments = [
    'viewBox="0 0 1200 640"',
    'textLength="730"',
    'textLength="690"',
    ">CORE ONLINE<",
    ">SOURCE TRUTH<",
    ">REVIEW LOCKED<",
    "CLAUDE CODEX BASE / REVERSA CORE",
    "EVIDENCE CORE",
    "AGENT MEMORY",
    "PATCH GUARD",
  ];
  for (const fragment of requiredFragments) {
    if (!svg.includes(fragment)) {
      fail(`${landingHeroAsset} is missing layout guard fragment: ${fragment}`);
    }
  }
}

function renderSvg(file) {
  const svg = readText(file);
  const viewBox = parseViewBox(svg, path.relative(repoRoot, file));
  if (!viewBox) return;

  const render = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: viewBox.width,
    },
    font: {
      loadSystemFonts: true,
    },
  });
  const png = render.render().asPng();
  const dims = readPngDimensions(png);
  if (dims.width !== viewBox.width || dims.height !== viewBox.height) {
    fail(`${path.basename(file)} rendered ${dims.width}x${dims.height}, expected ${viewBox.width}x${viewBox.height}`);
  }

  fs.mkdirSync(renderDir, { recursive: true });
  const outPath = path.join(renderDir, path.basename(file, ".svg") + ".png");
  fs.writeFileSync(outPath, png);
  console.log(`rendered ${path.relative(repoRoot, file)} -> ${path.relative(repoRoot, outPath)} (${dims.width}x${dims.height})`);
}

checkHeroReferences();
checkLandingHeroAsset();

const svgFiles = fs
  .readdirSync(assetDir)
  .filter((name) => name.endsWith(".svg"))
  .sort();

if (!svgFiles.includes(landingHeroAsset)) {
  fail(`missing expected SVG hero asset ${landingHeroAsset}`);
}

for (const name of svgFiles) {
  const file = path.join(assetDir, name);
  const svg = readText(file);
  if (name === landingHeroAsset) {
    checkHeroStructure(svg);
  }
  renderSvg(file);
}

if (!process.exitCode) {
  console.log(`SVG asset check passed (${svgFiles.length} assets).`);
}
