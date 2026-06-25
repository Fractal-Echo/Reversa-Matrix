export const EVIDENCE_REQUIRED_FIELDS = [
  'id',
  'category',
  'severity',
  'confidence',
  'source_file',
  'source_line_start',
  'source_line_end',
  'extracted_text',
  'normalized_claim',
  'related_paths',
  'related_symbols',
  'related_build_vars',
  'related_device_props',
  'evidence_type',
  'suggested_action',
  'rationale',
  'contradiction_group_id',
  'patch_candidate_id',
  'timestamp',
];

const CONTRADICTION_REQUIRED_FIELDS = [
  'id',
  'category',
  'severity',
  'confidence',
  'title',
  'conflicting_claims',
  'evidence_ids',
  'likely_winner',
  'rationale',
  'recommended_action',
  'investigation_command',
  'safe_next_action',
];

const PATCH_CANDIDATE_REQUIRED_FIELDS = [
  'id',
  'title',
  'target_file',
  'proposed_change',
  'reason',
  'evidence_ids',
  'risk_level',
  'rollback_plan',
  'validation_commands',
  'expected_result',
  'failure_signs',
  'group',
];

const REPORT_REQUIRED_FIELDS = [
  'schema_version',
  'tool',
  'scan',
  'summary',
  'findings',
  'evidence',
  'contradictions',
  'patch_candidates',
  'known_good',
  'tree_inventory',
  'risky_assumptions',
  'commands_to_run',
  'questions_for_human',
];

const TREE_FILE_REQUIRED_FIELDS = [
  'path',
  'size',
  'important',
  'scanned',
  'skipped_reason',
];

const KNOWN_GOOD_REQUIRED_FIELDS = [
  'source_file',
  'facts',
  'matches',
  'mismatches',
  'not_observed',
];

const VALID_SEVERITIES = new Set(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const VALID_CONFIDENCE = new Set(['confirmed', 'likely', 'possible', 'weak']);

export function validateEvidenceItem(item, path = 'evidence') {
  const errors = [];
  requireFields(item, EVIDENCE_REQUIRED_FIELDS, path, errors);
  if (!item || typeof item !== 'object') {
    return errors;
  }

  if (!VALID_SEVERITIES.has(item.severity)) {
    errors.push(`${path}.severity must be one of ${[...VALID_SEVERITIES].join(', ')}`);
  }
  if (!VALID_CONFIDENCE.has(item.confidence)) {
    errors.push(`${path}.confidence must be one of ${[...VALID_CONFIDENCE].join(', ')}`);
  }
  for (const key of ['related_paths', 'related_symbols', 'related_build_vars', 'related_device_props']) {
    if (!Array.isArray(item[key])) {
      errors.push(`${path}.${key} must be an array`);
    }
  }
  for (const key of ['source_line_start', 'source_line_end']) {
    if (!Number.isInteger(item[key])) {
      errors.push(`${path}.${key} must be an integer`);
    }
  }
  return errors;
}

export function validateContradiction(item, path = 'contradiction') {
  const errors = [];
  requireFields(item, CONTRADICTION_REQUIRED_FIELDS, path, errors);
  if (!item || typeof item !== 'object') {
    return errors;
  }

  if (!Array.isArray(item.conflicting_claims)) {
    errors.push(`${path}.conflicting_claims must be an array`);
  }
  if (!Array.isArray(item.evidence_ids)) {
    errors.push(`${path}.evidence_ids must be an array`);
  }
  if (!VALID_SEVERITIES.has(item.severity)) {
    errors.push(`${path}.severity must be one of ${[...VALID_SEVERITIES].join(', ')}`);
  }
  if (!VALID_CONFIDENCE.has(item.confidence)) {
    errors.push(`${path}.confidence must be one of ${[...VALID_CONFIDENCE].join(', ')}`);
  }
  return errors;
}

export function validatePatchCandidate(item, path = 'patch_candidate') {
  const errors = [];
  requireFields(item, PATCH_CANDIDATE_REQUIRED_FIELDS, path, errors);
  if (!item || typeof item !== 'object') {
    return errors;
  }

  if (!Array.isArray(item.evidence_ids)) {
    errors.push(`${path}.evidence_ids must be an array`);
  }
  if (!Array.isArray(item.validation_commands)) {
    errors.push(`${path}.validation_commands must be an array`);
  }
  return errors;
}

export function validateKnownGoodComparison(item, path = 'known_good') {
  const errors = [];
  requireFields(item, KNOWN_GOOD_REQUIRED_FIELDS, path, errors);
  if (!item || typeof item !== 'object') {
    return errors;
  }

  for (const key of ['matches', 'mismatches', 'not_observed']) {
    if (!Array.isArray(item[key])) {
      errors.push(`${path}.${key} must be an array`);
    }
  }
  if (!item.facts || typeof item.facts !== 'object' || Array.isArray(item.facts)) {
    errors.push(`${path}.facts must be an object`);
  }
  return errors;
}

export function validateTreeInventory(item, path = 'tree_inventory') {
  const errors = [];
  requireFields(item, ['project_root', 'profile', 'scanned_at', 'files', 'important_files', 'skipped_files', 'missing_expected_patterns', 'counts'], path, errors);
  if (!item || typeof item !== 'object') {
    return errors;
  }

  if (!Array.isArray(item.files)) {
    errors.push(`${path}.files must be an array`);
  } else {
    item.files.forEach((file, index) => requireFields(file, TREE_FILE_REQUIRED_FIELDS, `${path}.files[${index}]`, errors));
  }
  for (const key of ['important_files', 'skipped_files', 'missing_expected_patterns']) {
    if (!Array.isArray(item[key])) {
      errors.push(`${path}.${key} must be an array`);
    }
  }
  return errors;
}

export function validateScanReport(report) {
  const errors = [];
  requireFields(report, REPORT_REQUIRED_FIELDS, 'report', errors);
  if (!report || typeof report !== 'object') {
    return { valid: false, errors };
  }

  if (!Array.isArray(report.evidence)) {
    errors.push('report.evidence must be an array');
  } else {
    report.evidence.forEach((item, index) => errors.push(...validateEvidenceItem(item, `report.evidence[${index}]`)));
  }

  if (!Array.isArray(report.findings)) {
    errors.push('report.findings must be an array');
  }
  if (!Array.isArray(report.contradictions)) {
    errors.push('report.contradictions must be an array');
  } else {
    report.contradictions.forEach((item, index) => errors.push(...validateContradiction(item, `report.contradictions[${index}]`)));
  }
  if (!Array.isArray(report.patch_candidates)) {
    errors.push('report.patch_candidates must be an array');
  } else {
    report.patch_candidates.forEach((item, index) => errors.push(...validatePatchCandidate(item, `report.patch_candidates[${index}]`)));
  }

  errors.push(...validateKnownGoodComparison(report.known_good));
  errors.push(...validateTreeInventory(report.tree_inventory));

  return {
    valid: errors.length === 0,
    errors,
  };
}

function requireFields(item, fields, path, errors) {
  if (!item || typeof item !== 'object') {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const field of fields) {
    if (!(field in item)) {
      errors.push(`${path}.${field} is required`);
    }
  }
}
