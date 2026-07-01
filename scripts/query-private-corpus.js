#!/usr/bin/env node

import { existsSync, statSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { EVIDENCE_FACET_KEYS, deriveEvidenceFacets } from '../lib/scan/facets.js';

const TOKEN_RE = /[A-Za-z0-9_./+-]+/g;
const STOP_WORDS = new Set([
  'and', 'are', 'for', 'from', 'has', 'have', 'into', 'only', 'that', 'the',
  'this', 'with', 'what', 'when', 'where', 'which', 'why',
]);

export async function queryPrivateCorpus(options) {
  const corpusPath = await resolveCorpusPath(options.corpus);
  const query = requireValue('query', options.query);
  const top = Number(options.top ?? 8);
  const records = await readJsonl(corpusPath);
  const queryTerms = terms(query);
  const facetFilters = normalizeFacetFilters(options.facets ?? options.facetFilters ?? []);
  const queryFacetIntent = inferFacetIntent(query, queryTerms);
  const scored = records
    .filter(record => record.retrieval_allowed !== false)
    .map(record => scoreRecord(record, query, queryTerms, { facetFilters, queryFacetIntent }))
    .filter(result => (result.score > 0 || result.matchedTerms.length > 0 || result.matchedFacets.length > 0) && facetsMatch(result.facets, facetFilters))
    .sort((a, b) => b.score - a.score
      || b.facetScore - a.facetScore
      || authorityRank(b.record) - authorityRank(a.record)
      || a.record.source_id.localeCompare(b.record.source_id)
      || a.record.relative_path.localeCompare(b.record.relative_path))
    .slice(0, top);

  const result = {
    schema: 'reversa.private_corpus_query_result.v1',
    query,
    corpus_path: corpusPath,
    facet_filters: facetFilters,
    query_facet_intent: queryFacetIntent,
    facet_summary: summarizeFacetResults(scored),
    total_records: records.length,
    returned: scored.length,
    results: scored.map(item => formatResult(item)),
  };

  if (options.out) {
    const outDir = resolve(options.out);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'private-corpus-query-results.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
    await writeFile(join(outDir, 'private-corpus-query-results.md'), resultMarkdown(result), 'utf8');
  }

  return result;
}

export async function resolveCorpusPath(input) {
  const resolved = resolve(requireValue('corpus', input));
  if (!existsSync(resolved)) {
    throw new Error(`Corpus path does not exist: ${resolved}`);
  }
  if (statSync(resolved).isDirectory()) {
    const candidate = join(resolved, 'private-corpus-records.jsonl');
    if (!existsSync(candidate)) {
      throw new Error(`Corpus directory does not contain private-corpus-records.jsonl: ${resolved}`);
    }
    return candidate;
  }
  return resolved;
}

export async function readJsonl(path) {
  const text = await readFile(resolve(path), 'utf8');
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

export function scoreRecord(record, rawQuery, queryTerms, options = {}) {
  const text = `${record.relative_path ?? ''}\n${(record.retrieval_tags ?? []).join(' ')}\n${record.text ?? ''}`.toLowerCase();
  const lowerQuery = rawQuery.toLowerCase();
  const matchedTerms = [];
  const facets = facetsForRecord(record);
  const facetResult = scoreFacets(facets, {
    queryFacetIntent: options.queryFacetIntent ?? inferFacetIntent(rawQuery, queryTerms),
    facetFilters: normalizeFacetFilters(options.facetFilters ?? []),
  });
  let score = 0;

  if (text.includes(lowerQuery)) {
    score += 30;
  }

  for (const term of queryTerms) {
    if (!term) continue;
    const count = countOccurrences(text, term);
    if (count > 0) {
      matchedTerms.push(term);
      score += Math.min(12, count * 3);
    }
    if ((record.retrieval_tags ?? []).some(tag => tag.toLowerCase() === term)) {
      score += 6;
    }
  }

  if (record.source_authority) score += 4;
  if (record.raw_proof) score += 12;
  if ((record.retrieval_tags ?? []).includes('known_good')) score += 8;
  if ((record.retrieval_tags ?? []).includes('frontier')) score += 4;
  if (record.generated_artifact) score -= 30;
  if (record.training_allowed) score += 1;
  score += facetResult.score;

  return {
    score,
    facetScore: facetResult.score,
    matchedFacets: facetResult.matches,
    facets,
    matchedTerms: [...new Set(matchedTerms)].sort(),
    record,
  };
}

export function facetsForRecord(record) {
  const haystack = `${record.relative_path ?? ''}\n${(record.retrieval_tags ?? []).join(' ')}\n${record.text ?? ''}`;
  const evidence = {
    category: categoryForRecord(record, haystack),
    severity: record.generated_artifact ? 'LOW' : 'HIGH',
    confidence: record.raw_proof || record.source_authority ? 'confirmed' : record.generated_artifact ? 'weak' : 'likely',
    source_file: record.relative_path ?? '',
    source_line_start: record.line_start ?? 1,
    source_line_end: record.line_end ?? record.line_start ?? 1,
    evidence_type: evidenceTypeForRecord(record),
    raw_evidence: Boolean(record.raw_proof),
    normalized_claim: `${record.source_id ?? ''}:${record.relative_path ?? ''}:${haystack}`,
    extracted_text: haystack,
  };
  const facets = deriveEvidenceFacets(evidence, { profileId: profileForRecord(record, haystack) });

  if (record.raw_proof) {
    facets.authority = 'raw_artifact';
    facets.source_boundary = 'source_authority';
    facets.proof_level = 'artifact_backed';
  } else if (record.generated_artifact) {
    facets.authority = 'generated_artifact';
    facets.source_boundary = 'generated_non_authority';
    facets.proof_level = 'weak';
    facets.model_role = 'not_source_authority';
  } else if (record.source_authority) {
    facets.source_boundary = 'source_authority';
    facets.proof_level = 'observed';
  } else if (record.authority_class === 'operator_note') {
    facets.authority = 'operator_note';
    facets.source_boundary = 'local_only';
    facets.proof_level = 'unverified';
  } else if (record.local_experimental_training_allowed) {
    facets.source_boundary = 'local_only';
  }

  facets.deterministic_truth_above_model = true;
  return facets;
}

function scoreFacets(facets, { queryFacetIntent, facetFilters }) {
  const matches = [];
  let score = 0;

  for (const filter of facetFilters) {
    if (facets[filter.key] === filter.value) {
      matches.push(`${filter.key}=${filter.value}`);
      score += 12;
    }
  }

  for (const [key, value] of Object.entries(queryFacetIntent ?? {})) {
    if (!value) continue;
    if (facets[key] === value) {
      matches.push(`${key}=${value}`);
      score += 10;
    }
  }

  if (facets.authority === 'raw_artifact') score += 8;
  else if (facets.authority === 'generated_artifact') score -= 6;
  else if (facets.authority === 'operator_note') score -= 2;
  else if (facets.authority === 'source_line') score += 2;

  if (facets.source_boundary === 'source_authority') score += 6;
  else if (facets.source_boundary === 'generated_non_authority') score -= 6;
  else if (facets.source_boundary === 'copy_forbidden') score -= 6;

  if (facets.proof_level === 'artifact_backed') score += 8;
  else if (facets.proof_level === 'observed') score += 4;
  else if (facets.proof_level === 'weak') score -= 3;

  if (facets.temporal_status === 'known_good_frontier') score += 6;
  else if (facets.temporal_status === 'stale_or_historical') score -= 8;

  if (facets.operator_steer_state === 'confirmed_or_locked') score += 8;
  else if (facets.operator_steer_state === 'unknown_until_verified') score -= 4;

  if (facets.mutation_risk === 'boot_or_kernel_rebuild_required') score += 4;
  if (facets.deterministic_truth_above_model) score += 1;

  return { score, matches: [...new Set(matches)].sort() };
}

function authorityRank(record) {
  if (record.raw_proof) return 4;
  if (record.source_authority) return 3;
  if (record.authority_class === 'operator_note') return 2;
  if (record.generated_artifact) return 0;
  return 1;
}

function formatResult(item) {
  const record = item.record;
  return {
    score: Number(item.score.toFixed(3)),
    facet_score: Number(item.facetScore.toFixed(3)),
    record_id: record.record_id ?? record.id,
    source_id: record.source_id,
    source_role: record.source_role,
    authority_class: record.authority_class,
    source_authority: Boolean(record.source_authority),
    generated_artifact: Boolean(record.generated_artifact),
    raw_proof: Boolean(record.raw_proof),
    training_allowed: Boolean(record.training_allowed),
    relative_path: record.relative_path,
    chunk_index: record.chunk_index,
    chunk_count: record.chunk_count,
    line_start: record.line_start ?? null,
    line_end: record.line_end ?? null,
    content_sha256: record.content_sha256,
    chunk_sha256: record.chunk_sha256,
    retrieval_tags: record.retrieval_tags ?? [],
    matched_terms: item.matchedTerms,
    facet_matches: item.matchedFacets,
    facets: orderedFacets(item.facets),
    excerpt: excerpt(record.text ?? '', item.matchedTerms),
  };
}

function resultMarkdown(result) {
  return [
    '# Reversa Private Corpus Query',
    '',
    `- Query: \`${result.query}\``,
    `- Facet filters: ${result.facet_filters.length ? result.facet_filters.map(item => `\`${item.key}=${item.value}\``).join(', ') : 'none'}`,
    `- Query facet intent: ${Object.keys(result.query_facet_intent).length ? Object.entries(result.query_facet_intent).map(([key, value]) => `\`${key}=${value}\``).join(', ') : 'none'}`,
    `- Corpus records: ${result.total_records}`,
    `- Returned: ${result.returned}`,
    '',
    '## Facet Summary',
    '',
    ...facetSummaryMarkdown(result.facet_summary),
    '',
    ...result.results.flatMap((item, index) => [
      `## ${index + 1}. ${item.source_id}/${item.relative_path}`,
      '',
      `- Score: ${item.score}`,
      `- Facet score: ${item.facet_score}`,
      `- Authority: ${item.authority_class}`,
      `- Source authority: ${item.source_authority}`,
      `- Generated artifact: ${item.generated_artifact}`,
      `- Raw proof: ${item.raw_proof}`,
      `- Facets: ${Object.entries(item.facets).map(([key, value]) => `${key}=${value}`).join(', ')}`,
      `- Facet matches: ${item.facet_matches.length ? item.facet_matches.join(', ') : 'none'}`,
      `- Lines: ${item.line_start ?? '?'}-${item.line_end ?? '?'}`,
      `- Chunk SHA256: \`${item.chunk_sha256}\``,
      '',
      '```text',
      item.excerpt,
      '```',
      '',
    ]),
  ].join('\n');
}

function terms(value) {
  return [...String(value).toLowerCase().matchAll(TOKEN_RE)]
    .map(match => match[0])
    .filter(term => term.length > 1 && !STOP_WORDS.has(term));
}

function categoryForRecord(record, haystack) {
  const lower = haystack.toLowerCase();
  if (/\bdroidspaces_kernel_blocker_current_kernel|pid namespace|ipc namespace|config_pid_ns|config_ipc_ns\b/i.test(lower)) {
    return 'droidspaces_kernel_blocker';
  }
  if (record.generated_artifact) return 'generated_evidence_boundary';
  if (record.raw_proof) return 'source_authority';
  if (record.authority_class === 'operator_note') return 'memory_reference_only';
  if ((record.retrieval_tags ?? []).includes('policy')) return 'source_authority';
  if ((record.retrieval_tags ?? []).includes('training')) return 'training_dataset_surface';
  return record.source_authority ? 'source_authority' : 'context';
}

function evidenceTypeForRecord(record) {
  if (record.generated_artifact) return 'generated_artifact';
  if (record.raw_proof) return 'raw_artifact';
  if (record.authority_class === 'operator_note') return 'operator_note';
  return 'source_line';
}

function profileForRecord(record, haystack) {
  const lower = haystack.toLowerCase();
  if ((record.retrieval_tags ?? []).includes('policy')) return 'semantic_policy';
  if (/\b(agent|claude|codex|toolchain|gateway)\b/i.test(lower)) return 'agentic_gateway';
  if (/\b(dosbox|wrapper|dxvk|vulkan|pcgamingwiki|game)\b/i.test(lower)) return 'game_package_runtime';
  return 'private_corpus';
}

function inferFacetIntent(rawQuery, queryTerms = terms(rawQuery)) {
  const text = `${rawQuery} ${queryTerms.join(' ')}`.toLowerCase();
  const intent = {};

  if (/\b(kernel|pid[_ -]?ns|pid namespace|ipc[_ -]?ns|ipc namespace|config_pid_ns|config_ipc_ns|vendor_boot|vendor_dlkm|dtbo|vbmeta)\b/i.test(text)) {
    intent.subsystem = 'kernel';
    intent.mutation_risk = 'boot_or_kernel_rebuild_required';
    intent.required_next_artifact = 'running_kernel_config_and_requirements_check';
  } else if (/\b(vulkan|dxvk|vkd3d|gpu|framegen|display|wayland|xwayland)\b/i.test(text)) {
    intent.subsystem = 'graphics_runtime';
  } else if (/\b(bo3|pcgamingwiki|dosbox|pandemonium|wrapper|proton|wine)\b/i.test(text)) {
    intent.subsystem = 'game_runtime';
  } else if (/\b(agent|claude|codex|toolchain|lora|training|dataset|rebuild)\b/i.test(text)) {
    intent.subsystem = 'agentic_toolchain';
  }

  if (/\b(raw proof|raw_proof|artifact[-_ ]backed|hash|sha256)\b/i.test(text)) {
    intent.authority = 'raw_artifact';
    intent.proof_level = 'artifact_backed';
  } else if (/\bsource authority|source_authority|authoritative source\b/i.test(text)) {
    intent.source_boundary = 'source_authority';
  } else if (/\bgenerated|generated_artifact|model output\b/i.test(text)) {
    intent.source_boundary = 'generated_non_authority';
  } else if (/\blocal[-_ ]only|private|reference_only|reference-only\b/i.test(text)) {
    intent.source_boundary = 'local_only';
  }

  if (/\bknown[_ -]?good|frontier\b/i.test(text)) {
    intent.temporal_status = 'known_good_frontier';
  } else if (/\bstale|historical|superseded\b/i.test(text)) {
    intent.temporal_status = 'stale_or_historical';
  } else if (/\bcurrent|active|live|running\b/i.test(text)) {
    intent.temporal_status = 'current_stack';
  }

  if (/\bconfirmed|locked|blocker|operator steer|steer_lock\b/i.test(text)) {
    intent.operator_steer_state = 'confirmed_or_locked';
  } else if (/\bunknown|unverified|todo|fixme\b/i.test(text)) {
    intent.operator_steer_state = 'unknown_until_verified';
  }

  return intent;
}

function normalizeFacetFilters(filters) {
  return (Array.isArray(filters) ? filters : [filters])
    .filter(Boolean)
    .map(filter => {
      if (typeof filter === 'object' && filter.key && filter.value) {
        return { key: String(filter.key), value: String(filter.value) };
      }
      const match = String(filter).match(/^([A-Za-z0-9_]+)=(.+)$/);
      if (!match) {
        throw new Error(`Invalid facet filter: ${filter}. Expected key=value.`);
      }
      const [, key, value] = match;
      if (!EVIDENCE_FACET_KEYS.includes(key)) {
        throw new Error(`Unknown facet key: ${key}`);
      }
      return { key, value };
    });
}

function facetsMatch(facets, filters) {
  return filters.every(filter => facets[filter.key] === filter.value);
}

function orderedFacets(facets) {
  return Object.fromEntries(EVIDENCE_FACET_KEYS.map(key => [key, facets[key] ?? null]));
}

function summarizeFacetResults(scored) {
  const summary = {};
  for (const key of EVIDENCE_FACET_KEYS) {
    summary[key] = {};
  }
  for (const item of scored) {
    for (const key of EVIDENCE_FACET_KEYS) {
      const value = item.facets[key] ?? 'unknown';
      summary[key][value] = (summary[key][value] ?? 0) + 1;
    }
  }
  return summary;
}

function facetSummaryMarkdown(summary) {
  const rows = [];
  for (const key of EVIDENCE_FACET_KEYS) {
    const entries = Object.entries(summary?.[key] ?? {}).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) continue;
    rows.push(`- ${key}: ${entries.map(([value, count]) => `${value}=${count}`).join(', ')}`);
  }
  return rows.length ? rows : ['- none'];
}

function countOccurrences(text, term) {
  let count = 0;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(term, start);
    if (index === -1) break;
    count += 1;
    start = index + term.length;
  }
  return count;
}

function excerpt(text, matchedTerms) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= 420) return clean;
  const lower = clean.toLowerCase();
  const firstMatch = matchedTerms
    .map(term => lower.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 160);
  const end = Math.min(clean.length, start + 420);
  return `${start > 0 ? '...' : ''}${clean.slice(start, end)}${end < clean.length ? '...' : ''}`;
}

function requireValue(label, value) {
  if (!value) throw new Error(`Missing required ${label}`);
  return value;
}

function parseArgs(argv) {
  const options = { facets: [], help: false, top: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, null];
    const value = inlineValue ?? argv[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--corpus':
        options.corpus = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--query':
        options.query = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      case '--top':
        options.top = Number(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--facet':
        options.facets.push(requireValue(flag, value));
        if (inlineValue === null) index += 1;
        break;
      case '--out':
        options.out = requireValue(flag, value);
        if (inlineValue === null) index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
query-private-corpus

Usage:
  node scripts/query-private-corpus.js \\
    --corpus <private-corpus-dir-or-jsonl> \\
    --query "known good wayland real buffer" \\
    --facet subsystem=graphics_runtime \\
    --top 8 \\
    --out <query-output-dir>

This command is offline and read-only. It ranks existing corpus chunks, derives
24-TET facets from deterministic metadata, and can write query results to --out.
`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.corpus || !options.query) {
    printHelp();
    return options.help ? 0 : 1;
  }
  const result = await queryPrivateCorpus(options);
  console.log(`Private corpus query: ${result.query}`);
  for (const [index, item] of result.results.entries()) {
    console.log(`${index + 1}. score=${item.score} ${item.source_id}/${item.relative_path}#${item.chunk_index}`);
  }
  if (options.out) {
    console.log(`Results written to ${resolve(options.out)}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
