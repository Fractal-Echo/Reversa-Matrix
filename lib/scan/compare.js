import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { scanProject, stableId } from './scanner.js';

const VARIABLE_CATEGORIES = new Set([
  'build_variables',
  'device_identity',
  'soc_platform_identity',
  'partition_sizes',
  'kernel_header_assumptions',
  'avb_vbmeta_assumptions',
  'display_touch_framebuffer_config',
  'ld_library_path_linker_namespace_issues',
]);

const COMPARE_CATEGORIES = [
  ['fstab_differences', item => item.category === 'fstab_entries'],
  ['init_rc_differences', item => item.category === 'init_rc_services'],
  ['vendor_blob_list_differences', item => item.category === 'vendor_blobs'],
  ['decrypt_stack_differences', item => item.category === 'keymaster_keymint_gatekeeper_decrypt_dependencies'],
  ['display_touch_theme_differences', item => item.category === 'display_touch_framebuffer_config'],
  ['partition_image_rule_differences', item => item.category === 'partition_sizes' || item.category === 'kernel_header_assumptions'],
];

export async function compareProjects(options) {
  const profile = options.profile ?? 'generic_source_tree';
  const comparedAt = new Date().toISOString();
  const leftRoot = resolve(options.left);
  const rightRoot = resolve(options.right);

  const leftReport = await scanProject({
    projectRoot: leftRoot,
    profile,
    knownGood: options.knownGood,
    knownGoodPath: options.knownGoodPath,
    outDir: options.outDir,
  });
  const rightReport = await scanProject({
    projectRoot: rightRoot,
    profile,
    knownGood: options.knownGood,
    knownGoodPath: options.knownGoodPath,
    outDir: options.outDir,
  });

  const findings = [
    ...compareFileInventory(leftReport, rightReport),
    ...compareVariables(leftReport, rightReport),
    ...compareEvidenceCategories(leftReport, rightReport),
  ];

  const safeImportCandidates = buildSafeImportCandidates(findings);
  const riskyImportCandidates = buildRiskyImportCandidates(findings);

  return {
    schema_version: 1,
    tool: 'reversa',
    compare: {
      left_root: leftRoot,
      right_root: rightRoot,
      profile,
      known_good_path: options.knownGoodPath ?? null,
      compared_at: comparedAt,
    },
    summary: {
      total_findings: findings.length,
      files_only_left: findings.filter(item => item.category === 'files_only_left').length,
      files_only_right: findings.filter(item => item.category === 'files_only_right').length,
      variable_differences: findings.filter(item => item.category === 'variable_differences').length,
      safe_import_candidates: safeImportCandidates.length,
      risky_import_candidates: riskyImportCandidates.length,
    },
    findings,
    safe_import_candidates: safeImportCandidates,
    risky_import_candidates: riskyImportCandidates,
    left_scan_summary: leftReport.summary,
    right_scan_summary: rightReport.summary,
  };
}

export async function writeCompareOutputs(report, outDir) {
  await mkdir(outDir, { recursive: true });
  const written = [];

  await writeFile(join(outDir, 'compare_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  written.push(join(outDir, 'compare_report.json'));

  await writeFile(join(outDir, 'compare_summary.md'), buildCompareMarkdown(report), 'utf8');
  written.push(join(outDir, 'compare_summary.md'));

  await writeFile(join(outDir, 'compare.html'), buildCompareHtml(report), 'utf8');
  written.push(join(outDir, 'compare.html'));

  const handoffDir = join(outDir, 'agent_handoff');
  await mkdir(handoffDir, { recursive: true });
  const handoffFiles = [
    ['compare_findings.json', report.findings],
    ['safe_import_candidates.json', report.safe_import_candidates],
    ['risky_import_candidates.json', report.risky_import_candidates],
  ];
  for (const [fileName, value] of handoffFiles) {
    await writeFile(join(handoffDir, fileName), JSON.stringify(value, null, 2) + '\n', 'utf8');
    written.push(join(handoffDir, fileName));
  }

  return written;
}

function compareFileInventory(leftReport, rightReport) {
  const leftFiles = new Set(leftReport.tree_inventory.files.map(file => file.path));
  const rightFiles = new Set(rightReport.tree_inventory.files.map(file => file.path));
  const findings = [];

  for (const path of [...leftFiles].sort()) {
    if (!rightFiles.has(path)) {
      findings.push(compareFinding('files_only_left', 'LOW', `File only in left: ${path}`, { path }, null));
    }
  }
  for (const path of [...rightFiles].sort()) {
    if (!leftFiles.has(path)) {
      findings.push(compareFinding('files_only_right', severityForPath(path), `File only in right: ${path}`, null, { path }));
    }
  }
  return findings;
}

function compareVariables(leftReport, rightReport) {
  const left = buildVariableMap(leftReport);
  const right = buildVariableMap(rightReport);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const findings = [];

  for (const key of keys) {
    const leftValues = left.get(key) ?? [];
    const rightValues = right.get(key) ?? [];
    if (sameValueSet(leftValues.map(item => item.value), rightValues.map(item => item.value))) {
      continue;
    }
    findings.push(compareFinding(
      'variable_differences',
      severityForVariable(key),
      `Variable differs: ${key}`,
      compactEvidenceRefs(leftValues),
      compactEvidenceRefs(rightValues),
      {
        variable: key,
        left_values: [...new Set(leftValues.map(item => item.value))],
        right_values: [...new Set(rightValues.map(item => item.value))],
      }
    ));
  }
  return findings;
}

function compareEvidenceCategories(leftReport, rightReport) {
  const findings = [];
  for (const [category, predicate] of COMPARE_CATEGORIES) {
    const leftClaims = claimSet(leftReport.evidence.filter(predicate));
    const rightClaims = claimSet(rightReport.evidence.filter(predicate));
    if (sameValueSet([...leftClaims], [...rightClaims])) {
      continue;
    }
    findings.push(compareFinding(
      category,
      category.includes('partition') || category.includes('decrypt') ? 'HIGH' : 'MEDIUM',
      `${category.replaceAll('_', ' ')} differ`,
      [...leftClaims].sort(),
      [...rightClaims].sort()
    ));
  }
  return findings;
}

function buildVariableMap(report) {
  const map = new Map();
  for (const evidence of report.evidence) {
    if (!VARIABLE_CATEGORIES.has(evidence.category)) {
      continue;
    }
    const parsed = parseAssignmentClaim(evidence.normalized_claim);
    if (!parsed) {
      continue;
    }
    if (!map.has(parsed.key)) {
      map.set(parsed.key, []);
    }
    map.get(parsed.key).push({
      value: parsed.value,
      evidence_id: evidence.id,
      file: evidence.source_file,
      line: evidence.source_line_start,
    });
  }
  return map;
}

function parseAssignmentClaim(claim) {
  if (!claim || claim.includes(':')) {
    return null;
  }
  const index = claim.indexOf('=');
  if (index <= 0) {
    return null;
  }
  return {
    key: claim.slice(0, index),
    value: claim.slice(index + 1),
  };
}

function claimSet(items) {
  return new Set(items.map(item => item.normalized_claim));
}

function compactEvidenceRefs(items) {
  return items.map(item => ({
    value: item.value,
    evidence_id: item.evidence_id,
    file: item.file,
    line: item.line,
  }));
}

function sameValueSet(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) {
    return false;
  }
  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      return false;
    }
  }
  return true;
}

function compareFinding(category, severity, title, left, right, extra = {}) {
  return {
    id: stableId('CMP', `${category}:${title}:${JSON.stringify(left)}:${JSON.stringify(right)}`),
    category,
    severity,
    confidence: 'likely',
    title,
    left,
    right,
    rationale: rationaleForCompareCategory(category),
    safe_next_action: 'Inspect both trees and decide manually; compare mode never imports or patches files.',
    ...extra,
  };
}

function buildSafeImportCandidates(findings) {
  return findings
    .filter(item => item.category === 'files_only_right' && item.severity !== 'HIGH')
    .map(item => ({
      id: stableId('IMPORT_SAFE', item.id),
      source_file: item.right.path,
      target_file: item.right.path,
      reason: 'File exists only in the reference tree and is not classified as a high-risk recovery control file.',
      risk_level: 'low',
      validation_commands: [`test -f "${item.right.path}"`],
      action: 'manual_review_only',
    }));
}

function buildRiskyImportCandidates(findings) {
  return findings
    .filter(item => item.category !== 'files_only_left' && !(item.category === 'files_only_right' && item.severity !== 'HIGH'))
    .map(item => ({
      id: stableId('IMPORT_RISKY', item.id),
      category: item.category,
      title: item.title,
      reason: item.rationale,
      risk_level: item.severity === 'HIGH' ? 'high' : 'medium',
      validation_commands: [],
      action: 'manual_review_only',
    }));
}

function severityForPath(path) {
  return /(^|\/)(BoardConfig.*\.mk|AndroidProducts\.mk|.*fstab.*|.*\.rc|vendor-files.*\.txt|proprietary-files.*\.txt)$/i.test(path)
    ? 'HIGH'
    : 'LOW';
}

function severityForVariable(key) {
  return /PLATFORM|DEVICE|BOOTLOADER|PARTITION_SIZE|BOOT_HEADER|FSTAB|CRYPT|KEYMINT|KEYMASTER|GATEKEEPER/i.test(key)
    ? 'HIGH'
    : 'MEDIUM';
}

function rationaleForCompareCategory(category) {
  const map = {
    files_only_left: 'The current tree contains a file absent from the reference tree.',
    files_only_right: 'The reference tree contains a file absent from the current tree.',
    variable_differences: 'The same build variable resolves to different active values.',
    fstab_differences: 'Mount and block-device declarations differ between trees.',
    init_rc_differences: 'Init service declarations differ between trees.',
    vendor_blob_list_differences: 'Vendor blob contracts differ between trees.',
    decrypt_stack_differences: 'Decrypt/security stack references differ between trees.',
    display_touch_theme_differences: 'Display, touch, or theme assumptions differ between trees.',
    partition_image_rule_differences: 'Partition or boot image rules differ between trees.',
  };
  return map[category] ?? 'The compared trees differ for this evidence category.';
}

function buildCompareMarkdown(report) {
  const lines = [];
  lines.push('# Reversa Compare Summary');
  lines.push('');
  lines.push(`- Left: \`${report.compare.left_root}\``);
  lines.push(`- Right: \`${report.compare.right_root}\``);
  lines.push(`- Profile: \`${report.compare.profile}\``);
  lines.push(`- Findings: ${report.summary.total_findings}`);
  lines.push(`- Safe import candidates: ${report.summary.safe_import_candidates}`);
  lines.push(`- Risky import candidates: ${report.summary.risky_import_candidates}`);
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('No compare differences detected.');
  } else {
    lines.push('| Severity | Category | Title |');
    lines.push('| --- | --- | --- |');
    for (const finding of report.findings) {
      lines.push(`| ${finding.severity} | ${finding.category} | ${finding.title.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildCompareHtml(report) {
  const rows = report.findings.map(item => `<tr><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.safe_next_action)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Reversa Compare Report</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; color: #1f2933; background: #f6f7f9; }
    header { padding: 24px 32px; background: #13201f; color: #f8fafc; }
    main { padding: 24px 32px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid #d9e2ec; vertical-align: top; }
    th { color: #52606d; background: #f8fafc; }
  </style>
</head>
<body>
  <header>
    <h1>Reversa Compare Report</h1>
    <p>${escapeHtml(report.compare.left_root)} -> ${escapeHtml(report.compare.right_root)}</p>
  </header>
  <main>
    <p>Findings: ${report.summary.total_findings}. Safe candidates: ${report.summary.safe_import_candidates}. Risky candidates: ${report.summary.risky_import_candidates}.</p>
    <table>
      <thead><tr><th>Severity</th><th>Category</th><th>Title</th><th>Safe Next Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
