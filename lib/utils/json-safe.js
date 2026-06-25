import { readFileSync } from 'fs';

// Reads a UTF-8 JSON file tolerantly: strips a leading BOM (U+FEFF) before
// parsing. Some Windows tools (Notepad, older Out-File) save JSON with a BOM,
// and Node's JSON.parse rejects it. Use this everywhere we read state.json,
// manifest.yaml-adjacent JSON, or any user-facing JSON written outside our own
// JSON.stringify path.
export function readJsonSafe(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
}
