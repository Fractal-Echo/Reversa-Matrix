# Reversa Training Operation - 2026-06-30

This pass corrected the training baseline and recovery workflow after the
classifier-only smoke proof was found to be too small to treat as completion.

## Operating Rules

- WSL/Ubuntu is the standard execution environment for Reversa repo work.
- Windows paths are only for Windows game/tool inspection.
- Do not delete training material until it has all three proofs:
  recovered source location, hashed corpus membership, and held-out eval output.
- Generated model, corpus, and scan outputs stay under `local/` and are not
  public repo authority.
- Deterministic scanner evidence remains above model advice.

## Restored Source Material

Recovered deleted Reversa files from Git history:

```text
data/training/reversa-restored-docs/
```

Count:

```text
105 files
```

These files are retained inside the repo as training material, but outside the
public docs tree so `check:public-clean` still protects the published surface.

## Target Scans

Run root:

```text
local/reversa-training/run-20260630T030500Z
```

Target scan profiles:

```text
reversa-matrix/semantic_policy
reversa-matrix/agentic_gateway
reversa-matrix/claude_code_modern
reversa-matrix/known_good_frontier
droidspaces-nebula/child_libpath
droidspaces-nebula/nebula_vulkan_loader
droidspaces-nebula/frontier_guard
droidspaces-nebula/droidspaces_dock_lease
```

## Policy Classifier Baseline

Dataset:

```text
local/reversa-training/run-20260630T030500Z/training-pack-combined/agentic-training-pack.jsonl
```

Dataset shape:

```text
records: 234
source policy cases: 41
labels: allowlist, blocked, notice_required, permissive, personal_local
```

CUDA result:

```text
out: local/reversa-training/run-20260630T030500Z/policy-classifier-combined-stratified-500
device: cuda:0 NVIDIA GeForce RTX 5090 total_memory=34190458880
samples: 225
train/test: 180/45
split: stratified, test_ratio=0.2
test accuracy: 1.0000
test macro F1: 1.0000
```

Important boundary: this is still a small policy classifier baseline, not a
full LLM fine-tune.

## Retrieval Corpus

Corpus:

```text
local/reversa-training/run-20260630T030500Z/private-corpus
```

Corpus shape:

```text
sources: 9
records: 69170
skipped: 3781
local_only: true
```

Indexed material includes Reversa code/docs/tests, restored Reversa training
docs, Claude-code upstream caches, skill upstream caches, wrapper upstream
caches, and the recovered deleted-file archive.

## Local Coder SFT Lane

Dataset:

```text
local/reversa-training/run-20260630T030500Z/local-coder-sft
```

Dataset shape:

```text
examples: 2277
train/val/test: 1865/211/201
agentic pack examples: 229/234
private corpus examples: 2048/69170
```

Task mix:

```text
classify_source_import_policy: 41
plan_reversa_owned_capability: 11
rank_evidence_category: 174
summarize_gpu_proof: 3
summarize_local_evidence_chunk: 2048
```

Boundary:

```text
local_only: true
export_allowed: false
advisory_only: true
deterministic_truth_above_model: true
include_local_experimental_corpus: true
```

The SFT builder preserves the answer side during truncation so long prompts do
not create label-empty batches.

## Full Local Coder SFT Pack

Dataset:

```text
local/reversa-training/run-20260630T030500Z/local-coder-sft-full
```

Dataset shape:

```text
examples: 65261
train/val/test: 53631/5749/5881
```

Task mix:

```text
classify_source_import_policy: 41
plan_reversa_owned_capability: 11
rank_evidence_category: 174
summarize_gpu_proof: 3
summarize_local_evidence_chunk: 65032
```

Source membership:

```text
agentic_pack: 229/234 examples from training-pack-combined
private_corpus: 65032/69170 examples from private-corpus
```

Hashes:

```text
local-coder-sft.jsonl: 3aeecbcf6cc2e13c9e8b097e3447a0f0572d13a92e1de12bf10552b029af2930
local-coder-sft-train.jsonl: 4c571343eed92b1e70e50722541e8980b1bd03dd118ad095d29ef2e4d70eb62d
local-coder-sft-val.jsonl: 60af0e312b9168b6a299c5dc41b3d1ca18c6f2b986ebae33d9b24b019c650bcb
local-coder-sft-test.jsonl: 756c471b5afb7e3f5d355d2953462dcfad377cfef8d104a54dc31c27b80b16e4
local-coder-sft-summary.md: 59addf5e6b58abdf62de5371907929f74271bc0c6803f5fe17b5a735d5b57416
source-summary.tsv: 0119186d649cfbc7b1894cbe277823d9882d38dff6c3014145dfdc70c8402115
```

Important bug fix: Python `splitlines()` treated U+0085 inside JSON string
content as a line break and corrupted JSONL row parsing. The builder now
escapes U+0085, U+2028, and U+2029, and the trainer reads JSONL by LF-delimited
lines with `newline=""`.

## Local Coder LoRA Baseline

Clean baseline:

```text
out: local/reversa-training/run-20260630T030500Z/local-coder-lora-qwen7b-baseline-v2
base: Qwen/Qwen2.5-Coder-7B-Instruct
adapter: adapter/adapter_model.safetensors
quantization: 4bit-nf4
trainable params: 40,370,176 / 7,655,986,688
device: cuda:0 NVIDIA GeForce RTX 5090 total_memory=34190458880
train rows used: 96
val rows used: 16
steps: 8
max_seq_length: 768
batch_size: 1
grad_accum: 4
```

Loss trace:

```text
step 1 train_loss=1.930135577917099 val_loss=1.4265658110380173
step 5 train_loss=1.0885312110185623 val_loss=0.6561267450451851
step 8 train_loss=0.5422119684517384 val_loss=0.3119897493161261
```

The first local baseline directory without the `-v2` suffix produced a
non-finite train loss at step 8. It is superseded by `baseline-v2` and should
not be treated as proof. The trainer now hard-fails on non-finite losses.

## Full-Pack LoRA Baselines

100-step adapter:

```text
out: local/reversa-training/run-20260630T030500Z/local-coder-lora-qwen7b-full-100step
base: Qwen/Qwen2.5-Coder-7B-Instruct
adapter sha256: 5418f0a2b88b55cb1d08672667d4b66e74cc5ee51462097f61363dfa42a91242
metrics sha256: 2688444c15949c413dac8fe6bedf28435d84e1693ffa167a40510da066c37e35
effective rows seen estimate: 400/53631
coverage status: partial
```

1,000-step continued adapter:

```text
out: local/reversa-training/run-20260630T030500Z/local-coder-lora-qwen7b-full-1000step
base: Qwen/Qwen2.5-Coder-7B-Instruct
resumed from: local-coder-lora-qwen7b-full-100step/adapter
device: cuda:0 NVIDIA GeForce RTX 5090 total_memory=34190458880
train rows: 53631
val rows: 5749
batch_size: 1
grad_accum: 4
steps: 1000
effective rows seen estimate: 4000/53631
coverage fraction estimate: 0.07458
coverage status: partial; no unique-row coverage proof in this pre-logging run
```

1,000-step command:

```text
env HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 /home/richtofen/.local/share/reversa/venvs/policy-train-py314/bin/python scripts/train-local-coder-lora.py --dataset local/reversa-training/run-20260630T030500Z/local-coder-sft-full --out local/reversa-training/run-20260630T030500Z/local-coder-lora-qwen7b-full-1000step --resume-adapter local/reversa-training/run-20260630T030500Z/local-coder-lora-qwen7b-full-100step/adapter --max-val-records 32 --max-seq-length 768 --max-steps 1000 --eval-steps 100 --save-steps 250 --batch-size 1 --grad-accum 4 --learning-rate 5e-5
```

1,000-step validation trend:

```text
step 1 val_loss=0.00010489239843991527
step 100 val_loss=3.726680756699352e-05
step 200 val_loss=8.219118058150343e-05
step 300 val_loss=1.7781823430595978e-05
step 400 val_loss=1.9118794583050658e-05
step 500 val_loss=1.5780863606096318e-05
step 600 val_loss=8.232411677511209e-05
step 700 val_loss=4.554542434220821e-05
step 800 val_loss=2.3612372672232596e-05
step 900 val_loss=1.4601097092281634e-05
step 1000 val_loss=9.141904783405153e-06
```

1,000-step hashes:

```text
adapter/adapter_model.safetensors: 428f533e293005d0f3077a6436688aff959a1a40eb99bdd330a79cf3de23de08
metrics.json: 183c19d74083c750dbd566e0fa99056bfd1425a7c69ca699a76c87c28e8ee0a0
training-history.jsonl: 55ff0f9570c5c4488077037229a39cb5783b132508fea00800dad66f10efbe6d
checkpoint-step-000250/adapter_model.safetensors: b77b847580e22211421e4e9e1112e127f609610ddc9c8582bbde184a48a0ec28
checkpoint-step-000500/adapter_model.safetensors: ff36d6151561e9e39d02c9fe850e84893714df2cfffbb277afe70625b84dd3f9
checkpoint-step-000750/adapter_model.safetensors: 901fea5081b349f2998cdd0f43b40aa0ba207cd343524a5a0bb686909a99eb53
checkpoint-step-001000/adapter_model.safetensors: 428f533e293005d0f3077a6436688aff959a1a40eb99bdd330a79cf3de23de08
```

## Trainer Logging Patch

The trainer now writes live proof instead of making us wait for the final
artifact:

```text
train_log.jsonl
metrics-live.json
row-coverage.tsv
```

Added runtime controls:

```text
--eval-start-step
--log-steps
--save-metrics-every
--resume-adapter
--save-steps
```

The trainer logs train rows before eval rows, flushes stdout, stores the exact
command in metrics, and writes unique row coverage. A resumed 1-step smoke run
proved the new files and coverage accounting:

```text
out: local/reversa-training/run-20260630T030500Z/local-coder-lora-logging-smoke
coverage: 2/8 rows
coverage_fraction: 0.25
```

## Full-Epoch Run Plan

Next run:

```text
out: local/reversa-training/run-20260630T030500Z/local-coder-lora-qwen7b-full-epoch01
resume adapter: local-coder-lora-qwen7b-full-1000step/adapter
target: at least one pass over 53631 train rows
estimated optimizer steps: 13408 with batch_size=1 and grad_accum=4
checkpoint cadence: 1000 steps
eval cadence: 500 steps, starting at step 500
live metrics cadence: 100 steps
```

This run must be labeled incomplete unless `row-coverage.tsv` and metrics show
`coverage_complete: true`.

Current full-epoch milestone:

```text
step: 11000/13408
unique_rows_seen: 44000/53631
coverage_fraction: 0.8204210251533628
missing_rows: 9631
coverage_complete: false
latest_eval_step: 11000
latest_eval_val_loss: 1.6314873985123768e-06
checkpoint: checkpoint-step-011000
checkpoint_size: 155M
metrics-live.json: advanced past 10000, last flushed at step 10400
row-coverage.tsv: finalization artifact; not written until trainer exit
row-coverage-live.tsv: generated from train_log.jsonl without interrupting run
row-coverage-live.tsv sha256: f904aadf0fd7e5a55a35fc32831450bcc0ce78daa10d9919a2a628179502b097
row coverage sidecar check: linear delta_unique in {0, 4}; latest delta=4
observed_gpu: 15585 MiB / 32607 MiB, 40% utilization, 60C, 243W
disk: /dev/sdd 1007G total, 382G free, 61% used
eta: about 1.9 hours
status: healthy; keep running
```

## Game Wrapper Supplement Gate

Do not claim "all requested game sources" from the full-epoch run alone.

Confirmed represented in the current train split:

```text
DOSBox: 7440
DOSBox-X: 18
wrapper/wrappers: about 31k each
dgVoodoo: 91
dgVoodoo2: 77
Glide: 22
3dfx: 24
dxwrapper: 2326
cnc-ddraw: 1073
ddraw: 3964
dinput8: 220
winmm: 45
dxgi: 1456
DXVK: 4589
VKD3D: 35
ReShade: 376
SpecialK: 13562
Wine: 147
Proton: 36
```

Underrepresented:

```text
Pandemonium: 1 train example
BO3: 1 train example
PCGamingWiki: 4 train examples
Gamescope: 5 train examples
```

Missing or blocked:

```text
nGlide appears trainable in the raw corpus but is not in the train split.
3DMigoto, SUWSF, and OptiScaler are present but training_allowed=false.
```

After the full-epoch run shows `coverage_complete: true`, build a targeted
game-wrapper supplement pack with forced stratified train coverage for nGlide,
Pandemonium, BO3, PCGamingWiki, and Gamescope. Include 3DMigoto, SUWSF, and
OptiScaler only through license-clean metadata summaries or other allowed
source records. Then run a short supplemental LoRA continuation before claiming
the game-wrapper/DOSBox lane is broadly covered.

## Legal Release Gate

Open-source use does not require "applying" for the license. Reversa must
either comply with the license already attached to each dependency/source, or
obtain explicit permission when no license is present or the intended public
use exceeds the license.

Public release rules:

```text
MIT/BSD/Apache-style sources: keep notices and license text when copied or
substantially reused.

GPL/LGPL/AGPL sources: do not transplant internals unless Reversa deliberately
accepts the resulting copyleft/redistribution obligations.

No license observed: treat as all-rights-reserved for public release. Use only
as local experimental training/reference until permission or clean metadata is
available.

Game files/assets/modified executables: do not redistribute. Release original
Reversa code, configs, patch descriptions, signatures, source, and local build
or patch application instructions instead.

SDK/EULA-governed systems such as DLSS, Unreal, Steam, BO3 tools, and game
modding kits: comply with their SDK/EULA terms separately from source-code
licenses.
```

The public-clean target is independent Reversa-owned implementation, with
third-party notices, source manifests, hashes, and rollback plans. Local
training artifacts may stay local-only; they are not automatically public
release material.

## Hyperon / DAS Symbolic Reasoning Lane

Hyperon Experimental and DAS were added as a local symbolic-memory research
lane for Reversa. This is intended to teach architecture around typed atoms,
MeTTa, queryable evidence graphs, DAS query routing, AtomDB, inference agents,
attention brokers, API contracts, and CLI/runtime orchestration.

Observed local upstreams:

```text
trueagi-io/hyperon-experimental: 3f76dc460da6961f57f69f6c3e550c59c74ada83
singnet/das: f6834298077ba37f2e089f6ca02b78accf111e67
singnet/das-proto: d7cd8ecc4eb997279aa8a786498331acf67ea539
singnet/das-toolbox: dcac735f3ab80f931e4f3bbe3c6e4dbce0138c21
```

License boundary:

```text
hyperon-experimental: MIT license file observed.
das/das-proto/das-toolbox: no root license file observed in shallow clones;
keep as local_experimental/reference-only until explicit license evidence is
found.
```

Independent GitHub license endpoint check:

```text
trueagi-io/hyperon-experimental: spdx=MIT, path=LICENSE
singnet/das: HTTP 404 license endpoint
singnet/das-proto: HTTP 404 license endpoint
singnet/das-toolbox: HTTP 404 license endpoint
```

Expanded corpus:

```text
path: local/reversa-training/run-20260630T030500Z/hyperon-das-suite-private-corpus-20260630T210700Z
chunks: 4450
sources: 4
trueagi_io_hyperon_experimental: 1471 chunks
singnet_das: 2139 chunks
singnet_das_proto: 9 chunks
singnet_das_toolbox: 831 chunks
metta chunks indexed: 154
proto chunks indexed: 4
```

Expanded corpus hashes:

```text
private-corpus-records.jsonl: 11e52366976f2de1c52409731b1177295ce65cc7af0048fd1863213d54f328e0
private-corpus-train.jsonl: 6afb65974e86189f30df5ac041ff2afb14eb7b45bfcc5bcde66c3d47d648896e
private-corpus-val.jsonl: 67adb41c12dfe4fb1a7993bba47f47a30bd15eab1a9d2166caa69b1488de2f84
private-corpus-test.jsonl: 5ac79a76de7d046726886e9518d4de6fb57784e74a9da8fcabe311f8b58297f5
```

Query smoke:

```text
query: DAS proto gRPC das-cli Hyperon MeTTa query engine
returned: 10
top hits: DAS MeTTa integration, Hyperon DAS setup, das-dashboard architecture
view, gRPC build scripts, DAS README, Rust/Python bus clients
```

Expanded local coder SFT supplement:

```text
path: local/reversa-training/run-20260630T030500Z/local-coder-sft-hyperon-das-suite-supplement-20260630T211000Z
examples: 4025
train/val/test: 3280/358/387
include_local_experimental: true
advisory_only: true
deterministic_scanner_truth_above_model: true
```

Expanded local coder SFT supplement hashes:

```text
local-coder-sft.jsonl: 54b24b56147975c78d44667944e88eeacffb9b5e9495c8920bf74821eb1d9a47
local-coder-sft-train.jsonl: f903ac58b8f1d413ec942018d48b574b7bcf1753df8b05b56fcd5d8891161074
local-coder-sft-val.jsonl: dc66b85c338684c57e17faf7727a26b50d4a3a19d6570122321778faded2cee5
local-coder-sft-test.jsonl: 0cebec1d26dc4440bfdb889e4223972c55c6498aa3fc62a97a1a92db65dd50b4
```

This lane is staged only. Do not claim the active full-epoch Qwen adapter has
absorbed Hyperon/DAS until a post-epoch supplemental continuation is run and
its adapter hash, dataset hashes, eval report, and rollback path are recorded.

## Hardware Profile Gate

The full-epoch run intentionally uses a conservative proof profile:

```text
model: Qwen/Qwen2.5-Coder-7B-Instruct
quantization: 4bit-nf4
max_seq_length: 768
batch_size: 1
grad_accum: 4
observed RTX 5090 VRAM: about 15 GB of 32 GB
```

This is not a max-throughput 5090 profile. Do not use it as evidence that the
RTX 5090 is slow or saturated.

After the proof epoch completes, benchmark a 5090 throughput profile on the
targeted supplement pack before longer runs:

```text
profile A: max_seq_length=1536, batch_size=2, grad_accum=2
profile B: max_seq_length=2048, batch_size=2, grad_accum=2
profile C: max_seq_length=1536, batch_size=4, grad_accum=1
```

Pick the fastest stable profile by measured rows/sec, optimizer steps/sec,
VRAM use, eval loss sanity, and absence of CUDA OOM/non-finite loss. The 890M
lane should be treated as UI/preprocess/light-inference/offload support unless
a measured ROCm/DirectML/OpenCL path proves otherwise.

## Local Lab Hardware Note

Reversa is being trained and tested on a prototype GPD Duo from Droix with a
large local storage layout, WSL/Ubuntu repo workspace, AMD 890M/iGPU support,
and an external RTX 5090 CUDA lane. The downstream RM11Pro target is a
Snapdragon 8 Elite Gen 5 / Adreno device, so the local lab trifecta is:

```text
RTX 5090: CUDA training/eval and high-end desktop GPU path
AMD 890M: UI, display, preprocess, and light local inference path
Adreno: RM11Pro mobile Vulkan/runtime target path
```

Treat this as a local compatibility lab, not a generic laptop assumption.
Future wrapper/Vulkan/frame-generation work should record:

```text
game install path
wrapper/runtime path
GPU path used
display path used
driver/runtime versions
before/after hashes
rollback path
frame-time evidence
```

Visible local hardware pool includes the prototype GPD Duo, GPD Win Mini,
GPD Win 2, external/eGPU RTX setup, mini-PC/eGPU support hardware, and the
RM11Pro target. Current local compute classes include two 7840U systems, two
HX370 systems, one 8100Y system, RTX 3090-class hardware, and the RTX 5090
training path. Treat these as separate runtime profiles with their own thermal,
driver, display, storage, and wrapper constraints.

The historical game/hardware archive also spans multiple GPU eras. GTX
1080-era Pascal is now reference-only hardware history rather than a current
local test card. Reversa compatibility work should preserve that historical
spread as context for wrapper regressions, driver behavior, Vulkan migration,
frame pacing, and frame-generation experiments.

## Vulkan / DOOM 2016 Study Lane

Use DOOM 2016 / idTech 6 as a renderer architecture study case for why Vulkan
can feel unusually smooth when the engine is built around explicit GPU work.
This is research guidance for Reversa wrapper and compatibility tooling, not a
claim that an old game becomes idTech by wrapping it.

Study questions:

```text
How does the engine reduce driver overhead?
How are command buffers and worker threads used?
How are shader/pipeline caches warmed and invalidated?
How is frame pacing measured and stabilized?
How are present modes and swapchain stalls avoided?
Where does async compute help, and where does it hurt?
How are vendor-specific paths isolated from portable Vulkan paths?
```

Initial source:

```text
AMD GPUOpen: Vulkan and DOOM
https://gpuopen.com/learn/vulkan-and-doom/
```

Local benchmark family:

```text
DOOM games owned locally where installed/available
Use as known-good or historical renderer references, not as copied assets
Old DOOM: DOSBox/source-port/wrapper oriented
DOOM 3 / BFG / Resurrection of Evil: OpenGL-era wrapper and driver behavior
DOOM 2016: Vulkan-era frame pacing and explicit renderer anchor
DOOM Eternal / The Dark Ages: modern renderer behavior references
```

Future game preservation targets:

```text
PS1-era JRPG preservation/remaster study target; keep asset handling
clean, evidence-led, and separated from redistributable Reversa code.
```

Reversa should translate this into inspectable compatibility diagnostics:

```text
API path detected
shader cache state
pipeline cache state
swapchain/present mode
frame-time histogram
stutter source candidates
wrapper layer count
rollbackable config changes
```

## Hashes

Combined training pack:

```text
d1bce9a71bd810a2ec97c5db161a24932b8884efe071fda334308b36ec6b9e3b
```

Classifier checkpoint:

```text
62685ef9e0c7bde67b476f6f133387cf201904609fc2c107c36220ed07437cbc
```

Private corpus records:

```text
803d05c0b25bd0b3f1122b37a78a42174927c3211a5826f6acaf98ab0b4d0f8d
```

Local coder SFT dataset:

```text
d6f4e97be2f1d06cb96d9a2c5f6e1a34159b51befdc0e053deea1d0d5dd30212
```

Local coder SFT train split:

```text
e631ac2769e85e947f82da5807388a3393b693b033359a1ba0d0e2a0bd5745f4
```

Local coder LoRA adapter:

```text
e6b98092209f7ea9703fed27d44d4f47e614d3b5bc2d7d078516785ae22a5887
```

Local coder LoRA metrics:

```text
f319dd158428ebc0c9c6a05dd97f86a648dce7f71ba7d436ea3f53157dba9d14
```

## Verification

```text
npm test
204 passed
```

The test suite includes public-clean, SVG asset rendering, scanner tests,
dataset tests, private-corpus tests, and the agentic training pack regression
for personal-local sources without scan reports.
