import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

export async function writeScanOutputs(report, options) {
  const outDir = options.outDir;
  await mkdir(outDir, { recursive: true });

  const written = [];

  if (options.json) {
    await writeJson(join(outDir, 'report.json'), report);
    written.push(join(outDir, 'report.json'));
  }

  if (options.jsonl) {
    const jsonl = report.evidence.map(item => JSON.stringify(item)).join('\n') + '\n';
    await writeFile(join(outDir, 'evidence.jsonl'), jsonl, 'utf8');
    written.push(join(outDir, 'evidence.jsonl'));
  }

  if (options.markdown) {
    await writeFile(join(outDir, 'summary.md'), buildSummaryMarkdown(report), 'utf8');
    written.push(join(outDir, 'summary.md'));
  }

  if (options.html) {
    await writeFile(join(outDir, 'report.html'), buildHtmlReport(report), 'utf8');
    written.push(join(outDir, 'report.html'));
  }

  if (options.agentHandoff) {
    const handoffDir = join(outDir, 'agent_handoff');
    await mkdir(handoffDir, { recursive: true });

    const files = [
      ['summary.md', buildSummaryMarkdown(report)],
      ['findings.json', prettyJson(report.findings)],
      ['evidence.jsonl', report.evidence.map(item => JSON.stringify(item)).join('\n') + '\n'],
      ['contradictions.json', prettyJson(report.contradictions)],
      ['patch_candidates.json', prettyJson(report.patch_candidates)],
      ['commands_to_run.md', buildCommandsMarkdown(report.commands_to_run)],
      ['questions_for_human.md', buildQuestionsMarkdown(report.questions_for_human)],
      ['known_good_facts.json', prettyJson(report.known_good)],
      ['risky_assumptions.json', prettyJson(report.risky_assumptions)],
      ['tree_inventory.json', prettyJson(report.tree_inventory)],
    ];

    for (const [fileName, contents] of files) {
      await writeFile(join(handoffDir, fileName), contents, 'utf8');
      written.push(join(handoffDir, fileName));
    }
  }

  return written;
}

async function writeJson(path, value) {
  await writeFile(path, prettyJson(value), 'utf8');
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

export function buildSummaryMarkdown(report) {
  const lines = [];
  lines.push('# Reversa Scan Summary');
  lines.push('');
  lines.push(`- Project root: \`${report.scan.project_root}\``);
  lines.push(`- Profile: \`${report.scan.profile}\``);
  lines.push(`- Scanned at: \`${report.scan.scanned_at}\``);
  lines.push(`- Findings: ${report.summary.total_findings}`);
  lines.push(`- Contradictions: ${report.summary.total_contradictions}`);
  lines.push(`- Patch candidates: ${report.summary.total_patch_candidates}`);
  lines.push(`- Highest severity: ${report.summary.highest_severity}`);
  lines.push(`- Schema validation: ${report.schema_validation?.valid === false ? 'failed' : 'passed'}`);
  lines.push(`- Known-good file: \`${report.scan.known_good_path ?? '(none)'}\``);
  lines.push('');

  lines.push('## Severity Map');
  lines.push('');
  lines.push(markdownTable(
    ['Severity', 'Count'],
    Object.entries(report.summary.by_severity).sort(sortSeverityDesc).map(([key, value]) => [key, value])
  ));
  lines.push('');

  lines.push('## High-Confidence Findings');
  lines.push('');
  const highConfidence = report.findings
    .filter(item => item.confidence === 'confirmed' || item.confidence === 'likely')
    .sort(compareFindings)
    .slice(0, 25);
  lines.push(markdownTable(
    ['Severity', 'Category', 'Claim', 'File', 'Line'],
    highConfidence.map(item => [
      item.severity,
      item.category,
      item.normalized_claim,
      item.source_file,
      item.source_line_start,
    ])
  ));
  lines.push('');

  lines.push('## Contradictions');
  lines.push('');
  if (report.contradictions.length === 0) {
    lines.push('No contradictions detected.');
  } else {
    lines.push(markdownTable(
      ['Severity', 'Confidence', 'Title', 'Likely winner'],
      report.contradictions.sort(compareContradictions).map(item => [
        item.severity,
        item.confidence,
        item.title,
        item.likely_winner ?? '(unknown)',
      ])
    ));
  }
  lines.push('');

  lines.push('## Patch Candidates');
  lines.push('');
  if (report.patch_candidates.length === 0) {
    lines.push('No patch candidates generated.');
  } else {
    lines.push(markdownTable(
      ['Group', 'Risk', 'Title', 'Target'],
      report.patch_candidates.map(item => [
        item.group,
        item.risk_level,
        item.title,
        item.target_file ?? '(none)',
      ])
    ));
  }
  lines.push('');

  lines.push('## Known-Good Comparison');
  lines.push('');
  lines.push(`- Matches: ${report.known_good.matches.length}`);
  lines.push(`- Mismatches: ${report.known_good.mismatches.length}`);
  lines.push(`- Not observed: ${report.known_good.not_observed.length}`);
  lines.push('');

  lines.push('## Risky Assumptions');
  lines.push('');
  const riskyCount = (report.risky_assumptions?.weak_or_possible_findings?.length ?? 0)
    + (report.risky_assumptions?.contradictions_without_winner?.length ?? 0);
  lines.push(`- Items requiring extra evidence: ${riskyCount}`);
  lines.push('');

  lines.push('## Commands To Run');
  lines.push('');
  for (const command of report.commands_to_run) {
    lines.push(`- \`${command}\``);
  }
  lines.push('');

  lines.push('## Questions For Human');
  lines.push('');
  if (report.questions_for_human.length === 0) {
    lines.push('No blocking questions generated.');
  } else {
    for (const question of report.questions_for_human) {
      lines.push(`- ${question.question}`);
    }
  }
  lines.push('');

  lines.push('## Agent Handoff');
  lines.push('');
  lines.push('Use JSON and JSONL as the source of truth. Start with `agent_handoff/summary.md`, then inspect `contradictions.json`, `patch_candidates.json`, `commands_to_run.md`, `known_good_facts.json`, and `risky_assumptions.json`.');
  lines.push('');

  return lines.join('\n');
}

function buildCommandsMarkdown(commands) {
  const lines = ['# Commands To Run', '', '## Read-Only Validation Commands', ''];
  if (commands.length === 0) {
    lines.push('No validation commands generated.');
  } else {
    for (const command of commands) {
      lines.push('```bash');
      lines.push(command);
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('## DESTRUCTIVE / HUMAN REVIEW REQUIRED / BACKUP REQUIRED');
  lines.push('');
  lines.push('No destructive commands are generated by default.');
  return lines.join('\n');
}

function buildQuestionsMarkdown(questions) {
  const lines = ['# Questions For Human', ''];
  if (questions.length === 0) {
    lines.push('No blocking questions generated.');
  } else {
    for (const question of questions) {
      lines.push(`- [${question.id}] ${question.question}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildHtmlReport(report) {
  const topFindings = report.findings.sort(compareFindings).slice(0, 200);
  const contradictions = report.contradictions.sort(compareContradictions);
  const pathProblems = report.findings.filter(item => item.category === 'invalid_paths' || item.category === 'missing_files').slice(0, 100);
  const placeholders = report.findings.filter(item => item.category === 'placeholders' || item.category === 'todo_fixme_stub_markers').slice(0, 100);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reversa Scan Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #1f2933;
      --muted: #616e7c;
      --line: #d9e2ec;
      --accent: #0f766e;
      --blocker: #8a1c1c;
      --high: #b54708;
      --medium: #7c5800;
      --low: #3f6212;
      --info: #334e68;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    header {
      background: #13201f;
      color: #f8fafc;
      padding: 28px 36px;
    }
    header h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }
    header p { margin: 0; color: #b6c2c0; }
    main { max-width: 1440px; margin: 0 auto; padding: 24px 28px 48px; }
    section {
      margin: 0 0 20px;
      padding: 20px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }
    h2 {
      margin: 0 0 14px;
      font-size: 18px;
      letter-spacing: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfd;
    }
    .metric .label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .metric .value {
      margin-top: 4px;
      font-size: 24px;
      font-weight: 700;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      text-align: left;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #f8fafc;
    }
    code {
      background: #eef2f6;
      border-radius: 4px;
      padding: 1px 4px;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    .badge {
      display: inline-block;
      min-width: 62px;
      border-radius: 999px;
      padding: 2px 8px;
      color: #fff;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
    }
    .BLOCKER { background: var(--blocker); }
    .HIGH { background: var(--high); }
    .MEDIUM { background: var(--medium); }
    .LOW { background: var(--low); }
    .INFO { background: var(--info); }
    .muted { color: var(--muted); }
    .two-col {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 20px;
    }
    @media (max-width: 900px) {
      main { padding: 18px; }
      header { padding: 22px; }
      .two-col { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Reversa Scan Report</h1>
    <p>${escapeHtml(report.scan.project_root)} - ${escapeHtml(report.scan.profile)} - ${escapeHtml(report.scan.scanned_at)}</p>
  </header>
  <main>
    <section>
      <h2>Executive Summary</h2>
      <div class="grid">
        ${metric('Findings', report.summary.total_findings)}
        ${metric('Contradictions', report.summary.total_contradictions)}
        ${metric('Patch Candidates', report.summary.total_patch_candidates)}
        ${metric('Highest Severity', report.summary.highest_severity)}
        ${metric('Known-Good Matches', report.known_good.matches.length)}
        ${metric('Known-Good Mismatches', report.known_good.mismatches.length)}
        ${metric('Risky Assumptions', (report.risky_assumptions?.weak_or_possible_findings?.length ?? 0) + (report.risky_assumptions?.contradictions_without_winner?.length ?? 0))}
      </div>
    </section>

    <section>
      <h2>Risk Map</h2>
      ${htmlKeyValueTable(report.summary.by_severity, 'Severity', 'Count')}
    </section>

    <section>
      <h2>Contradictions</h2>
      ${contradictions.length === 0 ? '<p class="muted">No contradictions detected.</p>' : htmlTable(
        ['Severity', 'Confidence', 'Title', 'Likely Winner', 'Action'],
        contradictions.map(item => [
          severityBadge(item.severity),
          item.confidence,
          item.title,
          item.likely_winner ?? '(unknown)',
          item.recommended_action,
        ])
      )}
    </section>

    <section>
      <h2>Path Problems</h2>
      ${pathProblems.length === 0 ? '<p class="muted">No unresolved path references detected.</p>' : evidenceTable(pathProblems)}
    </section>

    <section>
      <h2>Placeholder And Stub List</h2>
      ${placeholders.length === 0 ? '<p class="muted">No placeholder or TODO/FIXME/STUB markers detected.</p>' : evidenceTable(placeholders)}
    </section>

    <section>
      <h2>Patch Candidates</h2>
      ${report.patch_candidates.length === 0 ? '<p class="muted">No patch candidates generated.</p>' : htmlTable(
        ['Group', 'Risk', 'Title', 'Target', 'Expected Result'],
        report.patch_candidates.map(item => [
          item.group,
          item.risk_level,
          item.title,
          item.target_file ?? '(none)',
          item.expected_result,
        ])
      )}
    </section>

    <section>
      <h2>Known-Good Comparison</h2>
      <div class="two-col">
        <div>
          <h3>Matches</h3>
          ${report.known_good.matches.length === 0 ? '<p class="muted">No matches.</p>' : htmlTable(
            ['Key', 'Expected', 'Observed', 'Source'],
            report.known_good.matches.map(item => [item.key, String(item.expected), item.observed, `${item.file}:${item.line}`])
          )}
        </div>
        <div>
          <h3>Mismatches</h3>
          ${report.known_good.mismatches.length === 0 ? '<p class="muted">No mismatches.</p>' : htmlTable(
            ['Key', 'Expected', 'Observed', 'Source'],
            report.known_good.mismatches.map(item => [item.key, String(item.expected), item.observed, `${item.file}:${item.line}`])
          )}
        </div>
      </div>
    </section>

    <section>
      <h2>File Inventory</h2>
      <div class="grid">
        ${metric('Files Total', report.tree_inventory.counts.files_total)}
        ${metric('Files Scanned', report.tree_inventory.counts.files_scanned)}
        ${metric('Files Skipped', report.tree_inventory.counts.files_skipped)}
        ${metric('Important Files', report.tree_inventory.important_files.length)}
      </div>
    </section>

    <section>
      <h2>Evidence Table</h2>
      ${topFindings.length === 0 ? '<p class="muted">No evidence generated.</p>' : evidenceTable(topFindings)}
    </section>

    <section>
      <h2>Validation Checklist</h2>
      <ul>
        ${report.commands_to_run.map(command => `<li><code>${escapeHtml(command)}</code></li>`).join('\n')}
      </ul>
    </section>

    <section>
      <h2>Risky Assumptions</h2>
      <p>Weak or possible findings: ${escapeHtml(String(report.risky_assumptions?.weak_or_possible_findings?.length ?? 0))}. Contradictions without a winner: ${escapeHtml(String(report.risky_assumptions?.contradictions_without_winner?.length ?? 0))}.</p>
    </section>

    <section>
      <h2>Agent Handoff</h2>
      <p>JSON and JSONL are the source of truth. The HTML report is a dashboard. Agents should continue from <code>agent_handoff/summary.md</code>, <code>contradictions.json</code>, <code>patch_candidates.json</code>, <code>commands_to_run.md</code>, <code>known_good_facts.json</code>, and <code>risky_assumptions.json</code>.</p>
    </section>
  </main>
</body>
</html>
`;
}

function metric(label, value) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(String(value))}</div></div>`;
}

function evidenceTable(items) {
  return htmlTable(
    ['Severity', 'Confidence', 'Category', 'Claim', 'Source'],
    items.map(item => [
      severityBadge(item.severity),
      item.confidence,
      item.category,
      item.normalized_claim,
      `${item.source_file}:${item.source_line_start}`,
    ])
  );
}

function severityBadge(severity) {
  return rawHtml(`<span class="badge ${escapeHtml(severity)}">${escapeHtml(severity)}</span>`);
}

function htmlKeyValueTable(object, firstHeader, secondHeader) {
  return htmlTable(
    [firstHeader, secondHeader],
    Object.entries(object).sort(sortSeverityDesc),
  );
}

function htmlTable(headers, rows) {
  const head = headers.map(header => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${renderCell(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function rawHtml(html) {
  return { __html: html };
}

function renderCell(cell) {
  if (cell && typeof cell === 'object' && typeof cell.__html === 'string') {
    return cell.__html;
  }
  return escapeHtml(String(cell));
}

function markdownTable(headers, rows) {
  if (rows.length === 0) {
    return '_None._';
  }
  const safeHeaders = headers.map(markdownCell);
  const divider = headers.map(() => '---');
  const safeRows = rows.map(row => row.map(markdownCell));
  return [
    `| ${safeHeaders.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...safeRows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .slice(0, 240);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compareFindings(a, b) {
  const severity = severityRank(b.severity) - severityRank(a.severity);
  if (severity !== 0) return severity;
  return a.source_file.localeCompare(b.source_file) || a.source_line_start - b.source_line_start;
}

function compareContradictions(a, b) {
  const severity = severityRank(b.severity) - severityRank(a.severity);
  if (severity !== 0) return severity;
  return a.title.localeCompare(b.title);
}

function severityRank(severity) {
  return { BLOCKER: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 }[severity] ?? 0;
}

function sortSeverityDesc(a, b) {
  return severityRank(b[0]) - severityRank(a[0]) || String(a[0]).localeCompare(String(b[0]));
}
