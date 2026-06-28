#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const repoRoot = process.cwd();
const assetDir = path.join(repoRoot, "docs", "assets");
const renderDir = path.join(repoRoot, "local", "asset-renders");
const heroAsset = "reversa-matrix-nebula-hero.svg";
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
    if (!text.includes(heroAsset)) {
      fail(`${file} does not reference ${heroAsset}`);
    }
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
      fail(`${heroAsset} still contains clipped stale text fragment: ${fragment}`);
    }
  }

  const requiredFragments = [
    'viewBox="0 0 1200 640"',
    'textLength="730"',
    'textLength="640"',
    ">CORE ONLINE<",
    ">SOURCE TRUTH<",
    ">GUARDED<",
    "NEBULA STYLE / REVERSA CORE",
    "EVIDENCE CORE",
    "FRONTIER GUARD",
    "PATCH WIZARD",
  ];
  for (const fragment of requiredFragments) {
    if (!svg.includes(fragment)) {
      fail(`${heroAsset} is missing layout guard fragment: ${fragment}`);
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

const svgFiles = fs
  .readdirSync(assetDir)
  .filter((name) => name.endsWith(".svg"))
  .sort();

if (!svgFiles.includes(heroAsset)) {
  fail(`missing expected hero asset ${heroAsset}`);
}

for (const name of svgFiles) {
  const file = path.join(assetDir, name);
  const svg = readText(file);
  if (name === heroAsset) {
    checkHeroStructure(svg);
  }
  renderSvg(file);
}

if (!process.exitCode) {
  console.log(`SVG asset check passed (${svgFiles.length} assets).`);
}
