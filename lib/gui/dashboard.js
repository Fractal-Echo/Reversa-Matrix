import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const DASHBOARD_FILE = 'dashboard.html';

export async function generateDashboard(options) {
  const outDir = resolve(options.outDir);
  if (!existsSync(outDir)) {
    throw new Error(`Output directory does not exist: ${outDir}`);
  }

  const data = await loadDashboardData(outDir);
  if (!data.scanReport && !data.compareReport) {
    throw new Error(`No Reversa-Matrix scan or compare output found in: ${outDir}`);
  }

  await mkdir(outDir, { recursive: true });
  const dashboardPath = join(outDir, DASHBOARD_FILE);
  await writeFile(dashboardPath, buildDashboardHtml(data), 'utf8');
  return {
    dashboardPath,
    fileUrl: toFileUrl(dashboardPath),
    hasScan: Boolean(data.scanReport),
    hasCompare: Boolean(data.compareReport),
  };
}

async function loadDashboardData(outDir) {
  const readJson = async relPath => {
    const path = join(outDir, relPath);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const readText = async relPath => {
    const path = join(outDir, relPath);
    if (!existsSync(path)) return null;
    return readFile(path, 'utf8');
  };

  return {
    generated_at: new Date().toISOString(),
    scanReport: await readJson('report.json'),
    compareReport: await readJson('compare_report.json'),
    summaryMarkdown: await readText('summary.md'),
    compareSummaryMarkdown: await readText('compare_summary.md'),
    handoff: {
      findings: await readJson('agent_handoff/findings.json'),
      contradictions: await readJson('agent_handoff/contradictions.json'),
      patchCandidates: await readJson('agent_handoff/patch_candidates.json'),
      knownGoodFacts: await readJson('agent_handoff/known_good_facts.json'),
      riskyAssumptions: await readJson('agent_handoff/risky_assumptions.json'),
      treeInventory: await readJson('agent_handoff/tree_inventory.json'),
      commandsText: await readText('agent_handoff/commands_to_run.md'),
      compareFindings: await readJson('agent_handoff/compare_findings.json'),
      safeImportCandidates: await readJson('agent_handoff/safe_import_candidates.json'),
      riskyImportCandidates: await readJson('agent_handoff/risky_import_candidates.json'),
    },
  };
}

function buildDashboardHtml(data) {
  const encodedData = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reversa-Matrix Dashboard</title>
  <style>${dashboardCss()}</style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">RM</div>
        <div>
          <h1>Reversa-Matrix</h1>
          <p>Evidence lab</p>
        </div>
      </div>
      <nav aria-label="Dashboard sections">
        <a href="#home">Home</a>
        <a href="#setup">Setup</a>
        <a href="#metadata">Metadata</a>
        <a href="#findings">Findings</a>
        <a href="#contradictions">Contradictions</a>
        <a href="#patches">Patch Candidates</a>
        <a href="#known-good">Known-Good</a>
        <a href="#risks">Risky Assumptions</a>
        <a href="#commands">Commands</a>
        <a href="#inventory">Tree Inventory</a>
        <a href="#handoff">Agent Handoff</a>
        <a href="#compare">Compare</a>
      </nav>
    </aside>
    <main>
      <section id="home" class="hero section"></section>
      <section id="setup" class="section"></section>
      <section id="metadata" class="section"></section>
      <section id="filters" class="section sticky-tools"></section>
      <section id="findings" class="section"></section>
      <section id="contradictions" class="section"></section>
      <section id="patches" class="section"></section>
      <section id="known-good" class="section"></section>
      <section id="risks" class="section"></section>
      <section id="commands" class="section"></section>
      <section id="inventory" class="section"></section>
      <section id="handoff" class="section"></section>
      <section id="compare" class="section"></section>
    </main>
  </div>
  <script id="reversa-data" type="application/json">${encodedData}</script>
  <script>${dashboardJs()}</script>
</body>
</html>
`;
}

function dashboardCss() {
  return `
:root {
  color-scheme: dark;
  --bg: #080d0c;
  --panel: #111816;
  --panel-2: #17211f;
  --ink: #e8f5ef;
  --muted: #a6b8b0;
  --line: #2a3d38;
  --accent: #40d88f;
  --accent-2: #7dd3fc;
  --danger: #fb7185;
  --warn: #fbbf24;
  --ok: #6ee7b7;
  --info: #93c5fd;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
.app-shell { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
  padding: 22px 18px;
  border-right: 1px solid var(--line);
  background: rgba(8,13,12,.92);
  backdrop-filter: blur(14px);
}
.brand { display: flex; gap: 12px; align-items: center; margin-bottom: 22px; }
.brand-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid rgba(64,216,143,.6);
  border-radius: 8px;
  background: #0d1f18;
  color: var(--accent);
  font-weight: 800;
}
h1, h2, h3 { margin: 0; letter-spacing: 0; }
.brand h1 { font-size: 18px; }
.brand p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
nav { display: grid; gap: 4px; }
nav a {
  color: var(--muted);
  text-decoration: none;
  padding: 9px 10px;
  border-radius: 7px;
}
nav a:hover, nav a:focus { color: var(--ink); background: var(--panel-2); outline: none; }
main { min-width: 0; padding: 28px; }
.section {
  margin: 0 0 18px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(17,24,22,.92);
  box-shadow: 0 10px 28px rgba(0,0,0,.2);
}
.hero { padding: 28px; }
.hero h2 { font-size: clamp(28px, 5vw, 52px); line-height: 1.04; margin-bottom: 12px; }
.hero p { max-width: 860px; color: var(--muted); font-size: 17px; }
.tagline { color: var(--accent); font-weight: 700; margin-bottom: 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.metric, .card, details {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(23,33,31,.82);
  padding: 14px;
}
.metric .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
.metric .value { margin-top: 4px; font-size: 26px; font-weight: 800; }
.help {
  margin: 10px 0 16px;
  padding: 12px;
  border-left: 3px solid var(--accent-2);
  background: rgba(125,211,252,.08);
  color: #d7ecf8;
}
.warning {
  border-color: rgba(251,113,133,.8);
  background: rgba(127,29,29,.22);
}
.warning h3 { color: var(--danger); }
.filters { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, minmax(150px, 210px)); gap: 10px; }
input, select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 10px 11px;
  background: #0b1211;
  color: var(--ink);
  font: inherit;
}
.sticky-tools { position: sticky; top: 0; z-index: 3; }
.item-list { display: grid; gap: 10px; }
details summary { cursor: pointer; list-style: none; }
details summary::-webkit-details-marker { display: none; }
.item-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.title { font-weight: 800; }
.meta { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 12px;
  font-weight: 800;
  color: #07100d;
}
.BLOCKER { background: #fb7185; }
.HIGH { background: #f59e0b; }
.MEDIUM { background: #fde047; }
.LOW { background: #86efac; }
.INFO { background: #93c5fd; }
.confidence { background: #d8b4fe; }
.category { background: #99f6e4; }
pre, code {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}
pre {
  overflow: auto;
  padding: 12px;
  border-radius: 8px;
  background: #07100f;
  border: 1px solid var(--line);
}
.copy-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
button {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 9px 11px;
  background: #10231c;
  color: var(--ink);
  cursor: pointer;
}
button:hover, button:focus { border-color: var(--accent); outline: none; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 9px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.empty { color: var(--muted); }
@media (max-width: 900px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; }
  main { padding: 16px; }
  .filters { grid-template-columns: 1fr; }
}
`;
}

function dashboardJs() {
  return `
const DATA = JSON.parse(document.getElementById('reversa-data').textContent);
const scan = DATA.scanReport || {};
const compare = DATA.compareReport || {};
const handoff = DATA.handoff || {};
const severityOrder = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const destructivePattern = /\\b(dd|fastboot|flash|mkfs|parted|sgdisk|wipefs|mount|umount|adb\\s+(?:push|shell\\s+su|reboot)|rm|mv|cp)\\b/i;

const state = {
  search: '',
  severity: '',
  confidence: '',
  category: '',
};

function el(id) { return document.getElementById(id); }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function badge(value, cls = value) {
  return value ? '<span class="badge ' + esc(cls) + '">' + esc(value) + '</span>' : '';
}
function metric(label, value) {
  return '<div class="metric"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value ?? 0) + '</div></div>';
}
function sectionTitle(title, help) {
  return '<h2>' + esc(title) + '</h2>' + (help ? '<div class="help">' + help + '</div>' : '');
}
function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
function itemText(item) { return asText(item).toLowerCase(); }
function commandsFromMarkdown(text) {
  if (!text) return [];
  const commands = [];
  const fence = /\\\`\\\`\\\`(?:bash|sh)?\\n([\\s\\S]*?)\\n\\\`\\\`\\\`/g;
  let match;
  while ((match = fence.exec(text)) !== null) {
    const command = match[1].trim();
    if (command) commands.push(command);
  }
  return commands.length ? commands : text.split('\\n').map(line => line.trim()).filter(line => line && !line.startsWith('#') && !line.startsWith('- No '));
}
function copyText(text, button) {
  const done = () => {
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = old; }, 1000);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const area = document.createElement('textarea');
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
  done();
}

function renderHome() {
  const summary = scan.summary || {};
  el('home').innerHTML =
    '<div class="tagline">Reverse-engineering evidence mapper for source trees, contradictions, and analysis.</div>' +
    '<h2>Browse source-tree evidence without losing the thread.</h2>' +
    '<p>Reversa-Matrix scans a source tree, records findings with file and line evidence, compares them with known-good facts, and packages the result for humans and Codex agents. This dashboard is only a viewer over JSON/JSONL; it is not the source of truth.</p>' +
    '<div class="grid">' +
      metric('Findings', summary.total_findings ?? (scan.evidence || []).length) +
      metric('Contradictions', summary.total_contradictions ?? (scan.contradictions || []).length) +
      metric('Patch Candidates', summary.total_patch_candidates ?? (scan.patch_candidates || []).length) +
      metric('Compare Findings', (compare.findings || []).length) +
    '</div>';
}

function renderSetup() {
  el('setup').innerHTML = sectionTitle('Setup Checklist', 'New here? A source tree is the folder of files you want to inspect. Reversa-Matrix reads it, writes evidence outputs, and leaves the source tree alone.') +
    '<div class="grid">' +
    checklistCard('1. Install', ['git clone https://github.com/Fractal-Echo/Reversa-Matrix.git', 'cd Reversa-Matrix', 'npm install', 'npm test']) +
    checklistCard('2. Run a scan', ['node ./bin/reversa.js scan --project-root ./test/fixtures/android-recovery-current --profile android_recovery --known-good examples/known_good_rm11pro_nx809j.json --out reversa_out']) +
    checklistCard('3. Open this dashboard', ['node ./bin/reversa.js gui --out reversa_out']) +
    '</div>';
}
function checklistCard(title, commands) {
  return '<div class="card"><h3>' + esc(title) + '</h3>' + commands.map(command => '<div class="copy-row"><pre>' + esc(command) + '</pre><button type="button" data-copy="' + esc(command) + '">Copy</button></div>').join('') + '</div>';
}

function renderMetadata() {
  const meta = scan.scan || {};
  const compareMeta = compare.compare || {};
  el('metadata').innerHTML = sectionTitle('Scan Metadata', 'Metadata tells you what was scanned, when, with which profile, and which known-good facts were loaded.') +
    '<table><tbody>' +
    row('Project root', meta.project_root) +
    row('Profile', meta.profile) +
    row('Scanned at', meta.scanned_at) +
    row('Known-good path', meta.known_good_path) +
    row('Compare left', compareMeta.left_root) +
    row('Compare right', compareMeta.right_root) +
    '</tbody></table>';
}
function row(label, value) { return '<tr><th>' + esc(label) + '</th><td>' + esc(value ?? '(none)') + '</td></tr>'; }

function renderFilters() {
  const items = allEvidenceItems();
  const categories = [...new Set(items.map(item => item.category).filter(Boolean))].sort();
  el('filters').innerHTML = sectionTitle('Search And Filters', 'Use filters to narrow the evidence. A finding is one evidence-backed observation; a contradiction is a conflict between claims; a patch candidate is a suggested source-tree change that still needs review.') +
    '<div class="filters">' +
      '<input id="filter-search" placeholder="Search text, files, IDs, paths">' +
      selectHtml('filter-severity', 'Severity', ['', ...severityOrder]) +
      selectHtml('filter-confidence', 'Confidence', ['', 'confirmed', 'likely', 'possible', 'weak']) +
      selectHtml('filter-category', 'Category', ['', ...categories]) +
    '</div>';
  el('filter-search').addEventListener('input', event => { state.search = event.target.value.toLowerCase(); renderFilteredSections(); });
  el('filter-severity').addEventListener('change', event => { state.severity = event.target.value; renderFilteredSections(); });
  el('filter-confidence').addEventListener('change', event => { state.confidence = event.target.value; renderFilteredSections(); });
  el('filter-category').addEventListener('change', event => { state.category = event.target.value; renderFilteredSections(); });
}
function selectHtml(id, label, values) {
  return '<select id="' + id + '" aria-label="' + esc(label) + '">' + values.map(value => '<option value="' + esc(value) + '">' + esc(value || label) + '</option>').join('') + '</select>';
}
function allEvidenceItems() {
  return [
    ...(scan.evidence || []),
    ...(scan.contradictions || []),
    ...(scan.patch_candidates || []),
    ...(compare.findings || []),
  ];
}
function passesFilters(item) {
  const text = itemText(item);
  if (state.search && !text.includes(state.search)) return false;
  if (state.severity && item.severity !== state.severity) return false;
  if (state.confidence && item.confidence !== state.confidence) return false;
  if (state.category && item.category !== state.category && item.group !== state.category) return false;
  return true;
}

function renderFilteredSections() {
  renderFindings();
  renderContradictions();
  renderPatches();
  renderCompare();
}

function renderFindings() {
  const items = (scan.evidence || []).filter(passesFilters);
  el('findings').innerHTML = sectionTitle('Findings Browser', 'A finding is a single observation with evidence. Evidence IDs matter because another agent can cite and track the same claim across scans.') + renderEvidenceList(items);
}
function renderContradictions() {
  const items = (scan.contradictions || []).filter(passesFilters);
  el('contradictions').innerHTML = sectionTitle('Contradictions Browser', 'A contradiction means two claims disagree, or source data conflicts with known-good facts. Reversa-Matrix shows the likely winner when evidence supports one.') + renderEvidenceList(items, 'contradiction');
}
function renderPatches() {
  const items = (scan.patch_candidates || []).filter(passesFilters);
  el('patches').innerHTML = sectionTitle('Patch Candidates Browser', 'A patch candidate is not an automatic patch. It is a reviewable idea linked to evidence, risk, rollback, and validation commands.') + renderEvidenceList(items, 'patch');
}

function renderEvidenceList(items, mode = 'evidence') {
  if (!items.length) return '<p class="empty">No matching items.</p>';
  return '<div class="item-list">' + items.map(item => {
    const title = item.title || item.normalized_claim || item.id;
    const source = item.source_file ? item.source_file + ':' + item.source_line_start : (item.target_file || item.category || '');
    const safeNext = item.safe_next_action || item.suggested_action || item.recommended_action || item.expected_result || '';
    return '<details>' +
      '<summary><div class="item-head"><div><div class="title">' + esc(title) + '</div><div class="meta">' + esc(item.id || '') + ' ' + esc(source || '') + '</div></div><div class="badges">' + badge(item.severity || item.risk_level || 'INFO', item.severity || 'INFO') + badge(item.confidence, 'confidence') + badge(item.category || item.group, 'category') + '</div></div></summary>' +
      '<div class="help"><strong>What does this mean?</strong> ' + esc(explainItem(mode, item)) + '</div>' +
      (safeNext ? '<p><strong>Safe next step:</strong> ' + esc(safeNext) + '</p>' : '') +
      '<pre>' + esc(JSON.stringify(item, null, 2)) + '</pre>' +
    '</details>';
  }).join('') + '</div>';
}
function explainItem(mode, item) {
  if (mode === 'contradiction') return 'Two evidence-backed claims disagree. Use the file/line references and known-good facts before changing anything.';
  if (mode === 'patch') return 'This is a proposed direction, not an automatic edit. Review evidence IDs, risk level, rollback, and validation commands first.';
  if ((item.category || '').includes('known')) return 'Known-good facts come from observed device behavior and can outweigh stale source-tree leftovers.';
  return 'This is one structured observation from the scan. It should be traceable to a file, line, derived inventory check, or known-good comparison.';
}

function renderKnownGood() {
  const known = scan.known_good || handoff.knownGoodFacts || {};
  el('known-good').innerHTML = sectionTitle('Known-Good Comparison', 'Known-good facts are trusted observations from real testing. They help identify old device names, wrong SoC values, and partition-size mismatches.') +
    '<div class="grid">' + metric('Matches', (known.matches || []).length) + metric('Mismatches', (known.mismatches || []).length) + metric('Not Observed', (known.not_observed || []).length) + '</div>' +
    renderTable(['Type', 'Key', 'Expected', 'Observed', 'Source'], [
      ...(known.matches || []).map(item => ['match', item.key, item.expected, item.observed, (item.file || '') + ':' + (item.line || '')]),
      ...(known.mismatches || []).map(item => ['mismatch', item.key, item.expected, item.observed, (item.file || '') + ':' + (item.line || '')]),
      ...(known.not_observed || []).map(item => ['not observed', item.key, item.expected, '', '']),
    ]);
}
function renderRisks() {
  const risks = scan.risky_assumptions || handoff.riskyAssumptions || {};
  el('risks').innerHTML = sectionTitle('Risky Assumptions', 'Risky assumptions are weak, possible, or unresolved claims. They need independent evidence before they become a patch plan.') +
    '<div class="grid">' + metric('Weak/Possible Findings', (risks.weak_or_possible_findings || []).length) + metric('Contradictions Without Winner', (risks.contradictions_without_winner || []).length) + '</div>' +
    '<pre>' + esc(JSON.stringify(risks, null, 2)) + '</pre>';
}
function renderCommands() {
  const commands = [...(scan.commands_to_run || []), ...commandsFromMarkdown(handoff.commandsText)].filter((value, index, arr) => value && arr.indexOf(value) === index);
  const safe = commands.filter(command => !destructivePattern.test(command));
  const destructive = commands.filter(command => destructivePattern.test(command));
  el('commands').innerHTML = sectionTitle('Commands To Run', 'Commands here are intended for validation. Copy buttons are provided for convenience. Destructive commands, if present in imported output, are isolated below and require human review plus backups.') +
    '<h3>Read-only commands</h3>' + renderCommandList(safe) +
    '<div class="card warning"><h3>DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED</h3>' + (destructive.length ? renderCommandList(destructive) : '<p>No destructive commands found.</p>') + '</div>';
}
function renderCommandList(commands) {
  if (!commands.length) return '<p class="empty">No commands.</p>';
  return commands.map(command => '<div class="copy-row"><pre>' + esc(command) + '</pre><button type="button" data-copy="' + esc(command) + '">Copy</button></div>').join('');
}
function renderInventory() {
  const inventory = scan.tree_inventory || handoff.treeInventory || {};
  const files = inventory.files || [];
  el('inventory').innerHTML = sectionTitle('Tree Inventory', 'The inventory records which files were seen, scanned, skipped, and considered important for the selected profile.') +
    '<div class="grid">' + metric('Files Total', inventory.counts?.files_total || files.length) + metric('Files Scanned', inventory.counts?.files_scanned || 0) + metric('Files Skipped', inventory.counts?.files_skipped || 0) + metric('Important Files', (inventory.important_files || []).length) + '</div>' +
    renderTable(['Path', 'Size', 'Important', 'Scanned', 'Skipped Reason'], files.slice(0, 500).map(file => [file.path, file.size, file.important, file.scanned, file.skipped_reason || '']));
}
function renderHandoff() {
  el('handoff').innerHTML = sectionTitle('Agent Handoff', 'Codex agents should use the handoff bundle to continue from structured evidence. The GUI helps humans browse; the agent should still read JSON and JSONL directly.') +
    '<ol><li>Read <code>agent_handoff/summary.md</code>.</li><li>Inspect <code>contradictions.json</code>.</li><li>Review <code>patch_candidates.json</code>.</li><li>Run only safe commands from <code>commands_to_run.md</code>.</li><li>Use <code>known_good_facts.json</code> and <code>risky_assumptions.json</code> before patching.</li></ol>' +
    '<p><strong>Why Reversa-Matrix does not blindly patch:</strong> reverse-engineering work often has copied values, generated paths, and target-only files. The tool maps evidence; humans and agents still need to weigh it.</p>';
}
function renderCompare() {
  const findings = (compare.findings || handoff.compareFindings || []).filter(passesFilters);
  const safe = compare.safe_import_candidates || handoff.safeImportCandidates || [];
  const risky = compare.risky_import_candidates || handoff.riskyImportCandidates || [];
  el('compare').innerHTML = sectionTitle('Compare Results', 'Compare mode checks two trees and classifies differences. It never imports files automatically.') +
    '<div class="grid">' + metric('Compare Findings', findings.length) + metric('Safe Import Candidates', safe.length) + metric('Risky Import Candidates', risky.length) + '</div>' +
    '<h3>Findings</h3>' + renderEvidenceList(findings, 'compare') +
    '<h3>Safe import candidates</h3><pre>' + esc(JSON.stringify(safe, null, 2)) + '</pre>' +
    '<h3>Risky import candidates</h3><pre>' + esc(JSON.stringify(risky, null, 2)) + '</pre>';
}

function renderTable(headers, rows) {
  if (!rows.length) return '<p class="empty">No rows.</p>';
  return '<table><thead><tr>' + headers.map(header => '<th>' + esc(header) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + row.map(cell => '<td>' + esc(cell ?? '') + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
}

function attachCopyHandlers() {
  document.body.addEventListener('click', event => {
    const button = event.target.closest('button[data-copy]');
    if (!button) return;
    copyText(button.getAttribute('data-copy'), button);
  });
}

function renderAll() {
  renderHome();
  renderSetup();
  renderMetadata();
  renderFilters();
  renderKnownGood();
  renderRisks();
  renderCommands();
  renderInventory();
  renderHandoff();
  renderFilteredSections();
  attachCopyHandlers();
}

renderAll();
`;
}

function toFileUrl(path) {
  return pathToFileURL(path).href;
}
