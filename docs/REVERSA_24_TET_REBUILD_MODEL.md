# Reversa 24-TET Rebuild Model

## Core Analogy

Current Reversa behaves too much like 12-TET: useful, simple, and playable, but coarse. It can classify broad lanes, but it collapses nearby distinctions that matter in real project work.

The rebuild target is closer to 24-TET with true-temperament compensation: more intervals, more local context, and fewer false equivalences between things that sound similar but require different fixes.

The only way to be dead-on is fretless or microtonal. For Reversa, that means preserving fine-grained diagnostic intervals until the evidence proves which note the project is actually playing.

This is not a style note. It is an architecture requirement.

## What 12-TET Means In Reversa

Coarse labels are useful for first-pass routing:

- `allowed`
- `blocked`
- `notice_required`
- `permissive`
- `wrapper`
- `kernel`
- `driver`
- `runtime`
- `training`
- `asset`
- `repo`
- `unknown`

The problem is that these labels are too wide. They can hide critical distinctions:

- kernel config blocker vs app-side runtime issue
- metadata-only training input vs source-authority corpus
- driver profile tuning vs graphics wrapper translation
- local-only experiment vs publishable artifact
- proven frontier vs newer failed run
- model advice vs deterministic scanner truth

## What 24-TET Means In Reversa

The rebuild needs higher-resolution facets that stay separate until the final presentation layer.

Reversa should classify evidence across independent axes:

- **Subsystem**: kernel, app, runtime, graphics, wrapper, model, repo, asset, UI, device.
- **Authority**: source file, build log, runtime log, scan output, hash, screenshot, operator steer, generated artifact.
- **Boundary**: public-safe, local-only, reference-only, metadata-only, blocked, caution-only.
- **Mutation Risk**: read-only, reversible config, patch candidate, binary mutation, device flash, account/service mutation.
- **Proof Level**: unverified, observed, reproduced, hashed, tested, gated, regression-tested.
- **Temporal Status**: old context, current stack, active run, stale run, superseded run, known-good frontier.
- **Operator Steer State**: hypothesis, confirmed, disproven, locked blocker, unknown until verified.
- **Model Role**: classifier, retriever, advisor, patch-dossier drafter, never source authority.

The scanner should not flatten these into one label too early.

## Required Data Shape

Every meaningful finding should be represented as a multi-axis record:

```json
{
  "classification": "DROIDSPACES_KERNEL_BLOCKER_CURRENT_KERNEL",
  "subsystem": "kernel",
  "authority": "runtime_requirements_check",
  "boundary": "device_local_evidence",
  "mutation_risk": "kernel_boot_image_rebuild",
  "proof_level": "observed",
  "temporal_status": "current_stack",
  "operator_steer_state": "confirmed",
  "model_role": "advisory_only",
  "deterministic_truth_above_model": true,
  "required_next_artifact": "running kernel config"
}
```

## Rebuild Consequences

The deterministic scanner remains source of truth.

The policy classifier should rank risk and source-boundary posture, not decide truth.

The retrieval/reranker lane should recall nearby evidence without merging unrelated domains.

The local coder LoRA should explain, draft checklists, and prepare patch dossiers, but it must not override hashes, logs, configs, tests, or operator-locked blockers.

The patch wizard should stay review-only until an operator approves a specific mutation.

## Training Consequences

Training examples should include near-miss distinctions:

- kernel namespace blocker vs Android app setting
- wrapper metadata summary vs copied wrapper source
- Steam library organization vs Steam bypass/mutation tooling
- driver cleanup tool inventory vs driver mutation plan
- BO3 wrapper research vs online-cheat/anti-cheat bypass claims
- newer failed run vs older known-good frontier
- generated artifact pretending to be source authority
- partial coverage run pretending to be all-data training

This is how Reversa learns the microtones.

## Evaluation Consequences

Eval should not only ask whether the model got the broad class right.

It should also check:

- Did it preserve the source boundary?
- Did it keep deterministic evidence above model advice?
- Did it lock confirmed operator steers?
- Did it refuse stale-summary promotion?
- Did it avoid broadening after a blocker was proven?
- Did it demand rollback/hash proof before mutation?
- Did it classify local-only material as local-only?

## Practical Rule

If two problems look similar but require different proof or a different rollback path, they are different notes.

Reversa should hear that difference.
