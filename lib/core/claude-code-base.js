export const CLAUDE_CODE_BASE_PROFILE_ID = 'claude_code_modern';

export const CLAUDE_CODE_BASE_ALIASES = Object.freeze([
  'claude_code',
  'codex_agent',
  'agent_workflow',
  'ai_coding_surface',
  'claude_matrix',
]);

export const CLAUDE_CODE_BASE_CAPABILITY_IDS = Object.freeze([
  'provider_catalog_and_registry',
  'model_router_and_gateway_ids',
  'dual_protocol_proxy_contract',
  'client_launcher_and_model_catalog_contract',
  'agent_instruction_and_permission_base',
  'admin_control_surface',
  'messaging_bridge_and_turn_intake',
  'safe_diagnostics_and_redaction',
  'smoke_capabilities',
  'process_registry_runtime_boundary',
  'voice_and_transcription_lane',
]);

export const CLAUDE_CODE_BASE_EVIDENCE_CATEGORIES = Object.freeze([
  'agent_instruction_surface',
  'agent_skill_contracts',
  'hook_lifecycle_policy',
  'permission_safety_policy',
  'memory_context_injection',
  'provider_routing_surface',
  'provider_catalog_surface',
  'model_routing_surface',
  'protocol_adapter_surface',
  'client_launcher_surface',
  'admin_config_surface',
  'smoke_coverage_surface',
  'messaging_bridge_surface',
  'secret_redaction_surface',
  'subagent_orchestration',
  'worktree_isolation',
  'mcp_plugin_surface',
  'proprietary_source_risk',
  'attribution_license_surface',
  'claude_memory_instruction',
  'claude_settings_scope',
  'claude_hook_policy',
  'claude_subagent_surface',
  'claude_mcp_surface',
  'claude_plugin_surface',
  'claude_skill_surface',
  'claude_command_surface',
  'claude_generated_boundary',
  'claude_frontier_guard',
  'claude_code_modern_guard',
  'functionality_capability',
]);

export const CLAUDE_CODE_BASE_GUARD_CLAIMS = Object.freeze([
  'CLAUDE_MD_MEMORY',
  'AGENT_INSTRUCTION_SURFACE',
  'SETTINGS_SCOPE_MANAGED',
  'SETTINGS_SCOPE_PROJECT',
  'SETTINGS_SCOPE_LOCAL',
  'HOOK_MUTATION_RISK',
  'HOOK_SAFE_FORMATTER',
  'SUBAGENT_SCOPE_BOUNDARY',
  'MCP_TOOL_SURFACE',
  'PLUGIN_TOOL_SURFACE',
  'SKILL_WORKFLOW',
  'SLASH_COMMAND_SURFACE',
  'CI_CODE_REVIEW_AUTOMATION',
  'PERMISSION_POLICY_CONFLICT',
  'SANDBOX_REQUIRED',
  'GENERATED_ARTIFACT_NOT_AUTHORITY',
  'PATCH_PLAN_REVIEW_REQUIRED',
  'COMMAND_PLAN_UNSAFE',
  'STALE_AGENT_REFERENCE',
  'FRONTIER_REGRESSION_RISK',
  'ACTIVE_FIRST_AUTHORITY',
]);

export const CLAUDE_CODE_BASE_CONTRACT = Object.freeze({
  id: 'trained_claude_code_base',
  profileId: CLAUDE_CODE_BASE_PROFILE_ID,
  aliases: CLAUDE_CODE_BASE_ALIASES,
  capabilityIds: CLAUDE_CODE_BASE_CAPABILITY_IDS,
  evidenceCategories: CLAUDE_CODE_BASE_EVIDENCE_CATEGORIES,
  guardClaims: CLAUDE_CODE_BASE_GUARD_CLAIMS,
  sourceTextPolicy: 'metadata_only_no_third_party_source_text',
  copyBoundary: 'Reimplement mechanism shape in Reversa-owned code; do not vendor Claude Code or Free Claude Code implementation source.',
});

export function createClaudeCodeBaseAliases(label = 'Alias for modern Claude/Codex agent workflow surfaces') {
  return Object.fromEntries(
    CLAUDE_CODE_BASE_ALIASES.map(id => [
      id,
      {
        id,
        label,
        extends: CLAUDE_CODE_BASE_PROFILE_ID,
      },
    ])
  );
}

export function validateClaudeCodeBaseCapabilities(capabilities = []) {
  const present = new Set(capabilities.map(capability => capability.id));
  const missing = CLAUDE_CODE_BASE_CAPABILITY_IDS.filter(id => !present.has(id));
  const extra = capabilities
    .map(capability => capability.id)
    .filter(id => !CLAUDE_CODE_BASE_CAPABILITY_IDS.includes(id));

  return {
    valid: missing.length === 0,
    required: [...CLAUDE_CODE_BASE_CAPABILITY_IDS],
    missing,
    extra,
  };
}

export function buildClaudeCodeBaseTrainingLabels() {
  return {
    profile: CLAUDE_CODE_BASE_PROFILE_ID,
    base_contract: CLAUDE_CODE_BASE_CONTRACT.id,
    profile_id: CLAUDE_CODE_BASE_PROFILE_ID,
    aliases: [...CLAUDE_CODE_BASE_ALIASES],
    capability_ids: [...CLAUDE_CODE_BASE_CAPABILITY_IDS],
    guard_claims: [...CLAUDE_CODE_BASE_GUARD_CLAIMS],
    evidence_categories: [...CLAUDE_CODE_BASE_EVIDENCE_CATEGORIES],
  };
}
