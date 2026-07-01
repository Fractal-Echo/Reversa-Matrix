const KERNEL_CATEGORIES = new Set([
  'kernel_header_assumptions',
  'droidspaces_kernel_blocker',
  'init_rc_services',
]);

const GRAPHICS_CATEGORIES = new Set([
  'display_touch_framebuffer_config',
  'gpu_upscale_framegen_runtime',
  'widescreen_framegen_runtime',
  'nebula_runtime_regression',
]);

const POLICY_CATEGORIES = new Set([
  'approval_required',
  'approval_bypass',
  'attribution_missing',
  'attribution_required',
  'commit_allowed',
  'commit_forbidden',
  'destructive_action',
  'device_action_allowed',
  'device_action_forbidden',
  'memory_authoritative',
  'memory_reference_only',
  'network_allowed',
  'network_forbidden',
  'proprietary_copy_forbidden',
  'proprietary_reference_only',
  'push_allowed',
  'push_forbidden',
  'read_only',
  'sandbox_bypass',
  'sandbox_required',
  'source_authority',
  'source_patch_allowed',
  'source_patch_forbidden',
  'stale_agent',
  'active_agent',
  'write_allowed',
  'write_forbidden',
]);

const MUTATION_BLOCK_CATEGORIES = new Set([
  'approval_required',
  'commit_forbidden',
  'destructive_action',
  'device_action_forbidden',
  'network_forbidden',
  'proprietary_copy_forbidden',
  'push_forbidden',
  'sandbox_required',
  'source_patch_forbidden',
  'write_forbidden',
]);

const OPERATOR_STEER_CATEGORIES = new Set([
  'droidspaces_kernel_blocker',
  'known_good_frontier',
  'profile_fit',
]);

export const EVIDENCE_FACET_KEYS = [
  'subsystem',
  'authority',
  'source_boundary',
  'mutation_risk',
  'proof_level',
  'temporal_status',
  'operator_steer_state',
  'model_role',
  'deterministic_truth_above_model',
  'required_next_artifact',
];

export function deriveEvidenceFacets(evidence, context = {}) {
  const category = String(evidence.category ?? '');
  const normalizedClaim = String(evidence.normalized_claim ?? evidence.extracted_text ?? '');
  const profileId = String(context.profile?.id ?? context.profileId ?? '');
  const sourceFile = String(evidence.source_file ?? '');

  const facets = {
    subsystem: subsystemFor({ category, normalizedClaim, profileId, sourceFile }),
    authority: authorityFor(evidence),
    source_boundary: sourceBoundaryFor({
      category,
      normalizedClaim,
      sourceFile,
      evidenceType: evidence.evidence_type,
    }),
    mutation_risk: mutationRiskFor({ category, normalizedClaim, severity: evidence.severity }),
    proof_level: proofLevelFor(evidence),
    temporal_status: temporalStatusFor({ category, normalizedClaim, sourceFile }),
    operator_steer_state: operatorSteerStateFor({ category, normalizedClaim }),
    model_role: 'advisory_only',
    deterministic_truth_above_model: true,
    required_next_artifact: requiredNextArtifactFor({ category, normalizedClaim }),
  };

  return {
    ...facets,
    ...(evidence.facets && typeof evidence.facets === 'object' ? evidence.facets : {}),
    deterministic_truth_above_model: evidence.facets?.deterministic_truth_above_model ?? true,
  };
}

function subsystemFor({ category, normalizedClaim, profileId, sourceFile }) {
  const haystack = `${category} ${normalizedClaim} ${profileId} ${sourceFile}`.toLowerCase();
  if (KERNEL_CATEGORIES.has(category) || /\b(config_pid_ns|config_ipc_ns|kernel|vendor_boot|vendor_dlkm|dtbo|vbmeta)\b/i.test(haystack)) {
    return 'kernel';
  }
  if (GRAPHICS_CATEGORIES.has(category) || /\b(vulkan|dxvk|vkd3d|reshade|specialk|dlss|fsr|xess|framegen|gpu|display|wayland|xwayland)\b/i.test(haystack)) {
    return 'graphics_runtime';
  }
  if (POLICY_CATEGORIES.has(category) || profileId === 'semantic_policy') {
    return 'policy';
  }
  if (/\b(bo3|blackops3|pcgamingwiki|dosbox|pandemonium|wrapper|steam_appid|proton|wine)\b/i.test(haystack)) {
    return 'game_runtime';
  }
  if (/\b(agent|provider|claude|codex|toolchain|gateway|model|lora|training|dataset)\b/i.test(haystack)) {
    return 'agentic_toolchain';
  }
  if (/\b(asset|texture|video|upscale|flowframes|cupscale|umodel|vbf)\b/i.test(haystack)) {
    return 'asset_pipeline';
  }
  if (/\b(path|file|missing|invalid|placeholder|todo|fixme|stub)\b/i.test(haystack)) {
    return 'source_tree';
  }
  return 'unknown';
}

function authorityFor(evidence) {
  if (evidence.raw_evidence) {
    return 'raw_artifact';
  }
  if (evidence.evidence_type === 'generated_artifact') {
    return 'generated_artifact';
  }
  if (evidence.evidence_type === 'known_good') {
    return 'known_good_file';
  }
  if (evidence.evidence_type === 'project_policy') {
    return 'project_policy_file';
  }
  if (evidence.evidence_type === 'source_line' || !evidence.evidence_type) {
    return 'source_line';
  }
  return String(evidence.evidence_type);
}

function sourceBoundaryFor({ category, normalizedClaim, sourceFile, evidenceType }) {
  const haystack = `${category} ${normalizedClaim} ${sourceFile}`.toLowerCase();
  if (evidenceType === 'generated_artifact' || /\bgenerated artifact|generated_artifact|non-authority|non_authority\b/i.test(haystack)) {
    return 'generated_non_authority';
  }
  if (category === 'source_authority' || /\bsource=authoritative_or_vendored\b/i.test(haystack)) {
    return 'source_authority';
  }
  if (category === 'proprietary_reference_only' || category === 'memory_reference_only' || /\breference_only\b/i.test(haystack)) {
    return 'reference_only';
  }
  if (category === 'proprietary_copy_forbidden') {
    return 'copy_forbidden';
  }
  if (/\blocal-only|local_only|private corpus|local_inventory_only\b/i.test(haystack)) {
    return 'local_only';
  }
  return 'scanned_source';
}

function mutationRiskFor({ category, normalizedClaim, severity }) {
  const haystack = `${category} ${normalizedClaim}`.toLowerCase();
  if (category === 'read_only' || /\bread[_ -]?only\b/i.test(haystack)) {
    return 'read_only';
  }
  if (MUTATION_BLOCK_CATEGORIES.has(category)) {
    return category === 'destructive_action' || severity === 'BLOCKER'
      ? 'destructive_or_device_mutation'
      : 'approval_or_boundary_required';
  }
  if (/\b(fastboot flash|adb reboot|mkfs|dd if=|git reset --hard|driver mutation|achievement mutation)\b/i.test(haystack)) {
    return 'destructive_or_device_mutation';
  }
  if (/\b(kernel|boot\.img|vendor_boot|vendor_dlkm|dtbo|vbmeta|config_pid_ns|config_ipc_ns)\b/i.test(haystack)) {
    return 'boot_or_kernel_rebuild_required';
  }
  if (/\b(patch|write|commit|push|mutate|replace)\b/i.test(haystack)) {
    return 'patch_review_required';
  }
  return 'evidence_only';
}

function proofLevelFor(evidence) {
  if (evidence.confidence === 'confirmed') {
    return evidence.raw_evidence ? 'artifact_backed' : 'observed';
  }
  if (evidence.confidence === 'likely') {
    return 'likely';
  }
  if (evidence.confidence === 'weak') {
    return 'weak';
  }
  return 'unverified';
}

function temporalStatusFor({ category, normalizedClaim, sourceFile }) {
  const haystack = `${category} ${normalizedClaim} ${sourceFile}`.toLowerCase();
  if (/\bknown[_ -]?good|frontier\b/i.test(haystack)) {
    return 'known_good_frontier';
  }
  if (/\bstale|old|superseded|archived\b/i.test(haystack)) {
    return 'stale_or_historical';
  }
  if (/\bactive|current|live|running\b/i.test(haystack)) {
    return 'current_stack';
  }
  return 'current_scan';
}

function operatorSteerStateFor({ category, normalizedClaim }) {
  const haystack = `${category} ${normalizedClaim}`.toLowerCase();
  if (/\bconfirmed|classification:|blocker_current|current_kernel\b/i.test(haystack) || OPERATOR_STEER_CATEGORIES.has(category)) {
    return 'confirmed_or_locked';
  }
  if (/\bdisproven|contradicted|mismatch\b/i.test(haystack)) {
    return 'disproven';
  }
  if (/\bunknown|unverified|todo|fixme|placeholder\b/i.test(haystack)) {
    return 'unknown_until_verified';
  }
  return 'unreviewed';
}

function requiredNextArtifactFor({ category, normalizedClaim }) {
  const haystack = `${category} ${normalizedClaim}`.toLowerCase();
  if (/\b(config_pid_ns|config_ipc_ns|pid namespace|ipc namespace|kernel)\b/i.test(haystack)) {
    return 'running_kernel_config_and_requirements_check';
  }
  if (/\b(vulkan|dxvk|vkd3d|framegen|dlss|fsr|xess|gpu|display)\b/i.test(haystack)) {
    return 'runtime_trace_or_gpu_proof';
  }
  if (/\b(proprietary|reference_only|license|notice|attribution)\b/i.test(haystack)) {
    return 'license_or_notice_evidence';
  }
  if (/\b(patch|write|mutate|replace|commit|push)\b/i.test(haystack)) {
    return 'rollback_plan_and_test_command';
  }
  if (/\b(generated|artifact|model|lora|training|dataset)\b/i.test(haystack)) {
    return 'source_artifact_hash_and_eval_report';
  }
  return 'nearest_source_artifact';
}
