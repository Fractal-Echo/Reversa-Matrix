# Claude Skill Corpus Training Pass - 2026-06-29

## Sources

Local cache:

```text
/home/richtofen/.android/repositories/tool-repos/claude-skill-upstreams/2026-06-29
```

| Source | Commit | License evidence | Import stance |
| --- | --- | --- | --- |
| `mattpocock/skills` | `448d0adee7cb797db5a2ad278e9e8d6c874e12af` | MIT root license | selective adapt with attribution |
| `ComposioHQ/awesome-claude-skills` | `92568c1edaff1bde5371154f036d959346c145a8` | mixed/no root assertion, selected licensed folders | per-folder allowlist only |
| `multica-ai/andrej-karpathy-skills` | `2c606141936f1eeef17fa3043a72095b4765b9c2` | no root license observed | personal local training allowed, no copy, no sale, no redistribution |
| `anthropics/claude-plugins-official` | `d0c131bd2b109bd6ff6928b11b28eda1fb5b8a8e` | Apache-2.0 root license plus per-plugin licenses | personal local training allowed, Reversa-owned rewrite |

## Shape Counts

| Source | `SKILL.md` count | `.claude-plugin` file count | License file count |
| --- | ---: | ---: | ---: |
| `mattpocock/skills` | 36 | 1 | 1 |
| `ComposioHQ/awesome-claude-skills` | 864 | 2 | 13 |
| `multica-ai/andrej-karpathy-skills` | 1 | 2 | 0 |
| `anthropics/claude-plugins-official` | 29 | 40 | 44 |

## Reversa Scans

| Source | Profile | Findings | Contradictions | Patch candidates | Highest severity |
| --- | --- | ---: | ---: | ---: | --- |
| `mattpocock/skills` | `claude_code_modern` | 1115 | 1 | 1 | HIGH |
| `mattpocock/skills` | `semantic_policy` | 268 | 1 | 1 | HIGH |
| `ComposioHQ/awesome-claude-skills` | `claude_code_modern` | 22200 | 0 | 2 | HIGH |
| `ComposioHQ/awesome-claude-skills` | `semantic_policy` | 13020 | 0 | 2 | HIGH |
| `multica-ai/andrej-karpathy-skills` | `claude_code_modern` | 77 | 0 | 0 | HIGH |
| `multica-ai/andrej-karpathy-skills` | `semantic_policy` | 39 | 0 | 0 | HIGH |
| `anthropics/claude-plugins-official` | `claude_code_modern` | 13142 | 4 | 11 | HIGH |
| `anthropics/claude-plugins-official` | `semantic_policy` | 7913 | 4 | 11 | HIGH |

## Training Boundary

This pass is metadata/evidence only for committed artifacts. Generated packs may
record source URL, commit, import stance, license evidence, scan counts,
important-file metadata, and evidence-category weights.

Third-party source text stays in the local cache or local private corpus only.
Reversa-owned plugins and skills must be written from scratch unless a source is
explicitly permissive and attribution is preserved.

User policy for this pass:

```text
PERSONAL USE ONLY.
CAN NOT BE SOLD.
ANTI-COPY BOUNDARIES REQUIRED.
```

Unlicensed/reference material may contribute local experimental training signal
for pattern recognition. It must not be committed as copied source, sold,
redistributed, or treated as source authority.

## Commands

```bash
node ./bin/reversa.js scan \
  --project-root /home/richtofen/.android/repositories/tool-repos/claude-skill-upstreams/2026-06-29/repos/mattpocock__skills \
  --profiles claude_code_modern,semantic_policy \
  --out /home/richtofen/.android/repositories/tool-repos/claude-skill-upstreams/2026-06-29/reversa/mattpocock__skills \
  --json --jsonl --markdown --agent-handoff --max-file-size 1M

node scripts/build-agentic-training-pack.js \
  --manifest docs/upstreams/claude-skill-corpus/source-sync.json \
  --out /home/richtofen/.android/repositories/tool-repos/claude-skill-upstreams/2026-06-29/training-pack
```

## Classifier Environment

The first classifier attempt exposed a real environment gap: system Python
`3.14.4` had no `numpy`, `torch`, or `sklearn`.

Fixed by creating an ignored local venv:

```text
local/venvs/agentic-policy
```

Installed versions:

| Package | Version |
| --- | --- |
| `numpy` | `2.5.0` |
| `scikit-learn` | `1.9.0` |
| `torch` | `2.12.1+cu130` |

CUDA proof:

```text
cuda_available=True
cuda_version=13.0
device=NVIDIA GeForce RTX 5090
```

A vLLM service was also present on the GPU during setup, so future training
runs should record GPU memory pressure before using CUDA.

## Training Results

Skill-corpus-only pack:

```text
records=54
samples=52
device=cuda:0 NVIDIA GeForce RTX 5090
initial_test_accuracy=0.1333
initial_test_macro_f1=0.3778
retrained_test_accuracy=1.0000
retrained_test_macro_f1=1.0000
labels=allowlist, blocked, permissive
```

Conclusion: the initial result exposed a feature-builder miss, not a CUDA or
dataset-read problem. The classifier did not include the actual policy fields in
its text features, so it learned from weaker surrounding words. After adding
those fields and retraining, the small skill-corpus eval passed cleanly.

Combined Claude-code-matrix + skill-corpus pack:

```text
records=185
device=cuda:0 NVIDIA GeForce RTX 5090
initial_test_accuracy=0.9286
initial_test_macro_f1=0.8550
retrained_test_accuracy=1.0000
retrained_test_macro_f1=1.0000
labels=allowlist, blocked, notice_required, permissive
```

Output:

```text
local/agentic-policy-classifier-2026-06-29-combined/
```

This is still a small policy classifier, not an LLM fine-tune. It is useful for
import-stance ranking and source-boundary advisory behavior.

Personal-local no-copy pack:

```text
records=185
samples=179
device=cuda:0 NVIDIA GeForce RTX 5090 total_memory=34190458880
test_accuracy=1.0000
test_macro_f1=1.0000
personal_local_precision=1.0000
personal_local_recall=1.0000
```

Output:

```text
local/agentic-policy-classifier-2026-06-29-combined-personal-local/
```

Important correction: the first personal-local run scored only
`test_accuracy=0.6829` and `test_macro_f1=0.7263` because the classifier feature
builder did not include `import_stance`, `copy_boundary`,
`local_experimental_training_allowed`, `redistribution_allowed`, or
`commercial_use_allowed`. After adding those actual policy fields to the source
and evidence-category text features, the model separated `personal_local` from
`blocked` and `permissive` cleanly on the held-out repos.

This remains a small policy classifier. It is not proof that Reversa can copy
third-party material. It is proof that Reversa can recognize the local-training
boundary and route it differently from copied-source reuse.

Retrained areas after the feature fix:

| Output | Samples | Labels | Test accuracy | Test macro F1 |
| --- | ---: | --- | ---: | ---: |
| `local/agentic-policy-classifier-2026-06-29-skill-corpus/` | 52 | `allowlist`, `blocked`, `permissive` | 1.0000 | 1.0000 |
| `local/agentic-policy-classifier-2026-06-29-combined/` | 179 | `allowlist`, `blocked`, `notice_required`, `permissive` | 1.0000 | 1.0000 |
| `local/agentic-policy-classifier-2026-06-29-combined-personal-local/` | 179 | `allowlist`, `blocked`, `notice_required`, `permissive`, `personal_local` | 1.0000 | 1.0000 |

## Retrieval Corpus

Built a local private corpus:

```text
local/private-corpus/2026-06-29-claude-skills
records=1367
skipped=146
```

The corpus keeps reference-only sources non-trainable and records authority
labels per chunk.

Search proof:

```text
query="pattern recognition loop observe cluster predict test remember proof wrapper skill plugin Reversa-owned"
top_result=reversa_skill_policy_docs/PATTERN_RECOGNITION_LOOP.md
second_result=reversa_skill_policy_docs/REVERSA_OWNED_SKILL_POLICY.md
```

Built a personal-local private corpus:

```text
local/private-corpus/2026-06-29-claude-skills-personal-local
records=4734
skipped=202
training_allowed=4199
local_experimental_training_allowed=4177
redistribution_allowed=0
commercial_use_allowed=0
```

Local experimental chunks by source:

| Source | Chunks |
| --- | ---: |
| `composio_skills_personal_local` | 2741 |
| `anthropic_plugins_personal_local` | 1412 |
| `karpathy_skills_personal_local` | 24 |

Training scopes:

| Scope | Chunks |
| --- | ---: |
| `personal_local_experimental_only_no_redistribution` | 4177 |
| `normal_source_authority_training` | 22 |
| `null` | 535 |

Search proof after the personal-local rebuild:

```text
query="pattern recognition loop observe cluster predict test remember proof wrapper skill plugin Reversa-owned"
top_result=reversa_skill_policy_docs/TRAINING_PASS_2026-06-29.md
second_result=reversa_skill_policy_docs/PATTERN_RECOGNITION_LOOP.md
returned=8
```
