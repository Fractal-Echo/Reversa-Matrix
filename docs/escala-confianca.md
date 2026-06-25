# Confidence Scale

Reversa-Matrix separates evidence strength from severity.

Severity answers: how serious is the issue?

Confidence answers: how strongly does the evidence support the claim?

---

## Labels

| Label | Meaning |
|---|---|
| `confirmed` | Directly supported by file content, known-good facts, or another reproducible artifact. |
| `likely` | Strongly supported by patterns or multiple related observations, but not fully proven. |
| `possible` | Plausible and worth tracking, but needs more evidence before action. |
| `weak` | Low-confidence signal. Treat as a prompt for investigation, not a conclusion. |

---

## How To Use Confidence

Use confidence before planning edits:

- `confirmed`: safe to cite as evidence, still review context before patching.
- `likely`: validate with another source before broad changes.
- `possible`: collect more evidence.
- `weak`: do not patch from this alone.

---

## Severity Is Separate

A finding can be high severity and low confidence. For example, a possible partition-size mismatch is important, but it still needs verification before acting.

A finding can also be low severity and confirmed. For example, a stale comment may be clearly present but not dangerous.

The dashboard exposes both fields so humans and agents do not confuse urgency with proof.
