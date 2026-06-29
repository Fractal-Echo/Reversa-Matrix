# Pattern Recognition Loop

This is the operator loop Reversa should learn from high-skill gameplay and
source-tree analysis.

## Model

Pattern recognition is not guessing faster. It is compressing repeated evidence
into a testable move.

```text
observe -> cluster -> predict -> test -> remember -> tighten
```

## Reversa Translation

| Human pattern skill | Reversa behavior |
| --- | --- |
| Notice repeated spawn rhythm | Detect repeated file/config/API shapes |
| Track audio and visual cues | Track logs, hashes, symbols, settings, and names |
| Know when a route flips unsafe | Detect contradictions and stale assumptions |
| Keep a fallback path | Require rollback and stop conditions |
| Improve by running the same map | Re-run scans with fixed inputs and compare deltas |
| Trust pressure-tested strats | Promote only independently verified evidence |

## Confidence Rule

A pattern is promoted only when it survives at least two independent checks:

- source artifact or config evidence;
- generated Reversa scan evidence;
- runtime log or test output;
- hash/version/commit proof;
- human observation recorded as an operator note and later corroborated.

Operator notes are valuable. They are not source authority until corroborated.

## Anti-Pattern

```text
Looks familiar -> must be true -> patch it
```

Correct form:

```text
Looks familiar -> gather proof -> compare contradictions -> propose smallest test
```

This is the same discipline as a clean high-round route: the pattern matters
because it predicts the next safe move.

## Anti-Copy Boundary

Reversa may learn local patterns from reference material. Reversa must create
its own artifacts.

Allowed:

- learn structure, rhythm, sequence, naming, validation shape, and failure
  modes;
- produce Reversa-owned skills, plugins, tests, policies, and scan checks;
- use synthetic fixtures to prove behavior.

Releasable work should follow the guitar-position rule: the same functional
phrase can be played in more than one position, with similar result but
different mechanics, tone, and timbre. Reversa may learn the phrase. It must
choose its own implementation position and verify the behavior with tests.

Not allowed:

- commit copied third-party prompt/source text;
- sell or redistribute copied material;
- claim unlicensed reference material as source authority;
- skip proof because a pattern feels familiar.
