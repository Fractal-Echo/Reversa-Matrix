#!/usr/bin/env python3
"""Train a small Reversa agentic import-policy classifier.

This is an intentionally narrow first training lane. It consumes the
metadata/evidence-only agentic training pack and learns to classify source
import policy classes from license evidence, recommended concepts, and Reversa
scan category summaries. It does not copy third-party source text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import random
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.metrics import accuracy_score, classification_report, f1_score


TOKEN_RE = re.compile(r"[A-Za-z0-9_./+-]+")


@dataclass(frozen=True)
class Sample:
    sample_id: str
    group: str
    label: str
    text: str
    count: float
    kind: str


class PolicyClassifier(torch.nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int, class_count: int) -> None:
        super().__init__()
        self.net = torch.nn.Sequential(
            torch.nn.Linear(input_dim, hidden_dim),
            torch.nn.LayerNorm(hidden_dim),
            torch.nn.GELU(),
            torch.nn.Dropout(0.15),
            torch.nn.Linear(hidden_dim, class_count),
        )

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return self.net(features)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", required=True, help="Path to agentic-training-pack.jsonl")
    parser.add_argument("--out", required=True, help="Output directory for model artifacts")
    parser.add_argument("--target-scan-root", help="Optional directory containing target scan report.json files")
    parser.add_argument("--epochs", type=int, default=350)
    parser.add_argument("--feature-buckets", type=int, default=4096)
    parser.add_argument("--hidden-dim", type=int, default=192)
    parser.add_argument("--seed", type=int, default=20260627)
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--split-mode", choices=["repo", "stratified"], default="repo")
    parser.add_argument("--test-ratio", type=float, default=0.20)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    records = read_jsonl(Path(args.pack))
    samples = build_samples(records)
    if len(samples) < 8:
        raise SystemExit(f"not enough samples to train: {len(samples)}")

    labels = sorted({sample.label for sample in samples})
    label_to_id = {label: index for index, label in enumerate(labels)}
    train_indices, test_indices = split_samples(samples, args.seed, args.split_mode, args.test_ratio)

    features = vectorize(samples, args.feature_buckets)
    target = torch.tensor([label_to_id[sample.label] for sample in samples], dtype=torch.long)

    device = pick_device(args.device)
    model = PolicyClassifier(features.shape[1], args.hidden_dim, len(labels)).to(device)

    x_train = features[train_indices].to(device)
    y_train = target[train_indices].to(device)
    x_test = features[test_indices].to(device)
    y_test = target[test_indices].to(device)

    class_weights = compute_class_weights(y_train, len(labels)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2.5e-3, weight_decay=1e-3)
    criterion = torch.nn.CrossEntropyLoss(weight=class_weights)

    history: list[dict[str, Any]] = []
    best_state: dict[str, torch.Tensor] | None = None
    best_macro_f1 = -1.0

    for epoch in range(1, args.epochs + 1):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        logits = model(x_train)
        loss = criterion(logits, y_train)
        loss.backward()
        optimizer.step()

        if epoch == 1 or epoch % 25 == 0 or epoch == args.epochs:
            metrics = evaluate(model, x_test, y_test, labels)
            metrics["epoch"] = epoch
            metrics["loss"] = float(loss.detach().cpu())
            history.append(metrics)
            if metrics["macro_f1"] >= best_macro_f1:
                best_macro_f1 = metrics["macro_f1"]
                best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    final_metrics = evaluate(model, x_test, y_test, labels)
    train_metrics = evaluate(model, x_train, y_train, labels)
    predictions = predict_samples(model, features.to(device), samples, labels)
    target_predictions = predict_target_scans(model, labels, args.feature_buckets, device, args.target_scan_root)

    checkpoint = {
        "model_state_dict": model.state_dict(),
        "labels": labels,
        "feature_buckets": args.feature_buckets,
        "hidden_dim": args.hidden_dim,
        "input_dim": features.shape[1],
        "seed": args.seed,
        "training_pack": str(Path(args.pack).resolve()),
        "sample_count": len(samples),
        "source_text_policy": "metadata/evidence only; third-party source text is not copied",
    }

    checkpoint_path = out_dir / "policy-classifier.pt"
    torch.save(checkpoint, checkpoint_path)

    metrics = {
        "model": "agentic_policy_classifier_v1",
        "device": describe_device(device),
        "python": sys.version,
        "platform": platform.platform(),
        "torch": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "cuda_version": torch.version.cuda,
        "samples": len(samples),
        "train_samples": len(train_indices),
        "test_samples": len(test_indices),
        "split_mode": args.split_mode,
        "test_ratio": args.test_ratio,
        "labels": labels,
        "train_repos": sorted({samples[index].group for index in train_indices}),
        "test_repos": sorted({samples[index].group for index in test_indices}),
        "train_metrics": train_metrics,
        "test_metrics": final_metrics,
        "history": history,
        "source_text_policy": "No third-party source text copied; pack metadata only.",
    }

    write_json(out_dir / "metrics.json", metrics)
    write_json(out_dir / "labels.json", {"labels": labels, "label_to_id": label_to_id})
    write_json(out_dir / "vectorizer.json", {"type": "stable_hashing_bow", "feature_buckets": args.feature_buckets})
    write_jsonl(out_dir / "predictions.jsonl", predictions)
    write_jsonl(out_dir / "target-advisory-predictions.jsonl", target_predictions)
    (out_dir / "training-history.jsonl").write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in history),
        encoding="utf-8",
    )
    (out_dir / "environment.txt").write_text(build_environment_text(device), encoding="utf-8")
    (out_dir / "dataset-summary.md").write_text(build_dataset_summary(samples, metrics), encoding="utf-8")
    write_hashes(out_dir)

    print(f"Reversa policy classifier trained: {out_dir}")
    print(f"- checkpoint: {checkpoint_path}")
    print(f"- test accuracy: {final_metrics['accuracy']:.4f}")
    print(f"- test macro_f1: {final_metrics['macro_f1']:.4f}")
    print(f"- device: {metrics['device']}")
    return 0


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def build_samples(records: list[dict[str, Any]]) -> list[Sample]:
    source_records = {
        record["repo"]: record
        for record in records
        if record.get("type") == "source_import_policy" and record.get("import_policy_class")
    }
    samples: list[Sample] = []

    for repo, record in source_records.items():
        scan_summary = record.get("scan_summary") or {}
        top_categories = scan_summary.get("top_categories", []) or []
        text_parts = [
            record.get("repo", ""),
            record.get("url", ""),
            record.get("license_evidence", ""),
            record.get("import_stance", ""),
            record.get("copy_boundary", ""),
            "local_experimental_training_allowed"
            if record.get("local_experimental_training_allowed")
            else "local_experimental_training_not_allowed",
            "redistribution_allowed" if record.get("redistribution_allowed") else "redistribution_not_allowed",
            "commercial_use_allowed" if record.get("commercial_use_allowed") else "commercial_use_not_allowed",
            " ".join(record.get("recommended_goodies", []) or []),
            " ".join(category for category, _count in top_categories),
        ]
        samples.append(Sample(
            sample_id=f"source:{repo}",
            group=repo,
            label=record["import_policy_class"],
            text=" ".join(text_parts),
            count=float(scan_summary.get("findings") or 0),
            kind="source",
        ))

    category_index = 0
    for record in records:
        if record.get("type") != "evidence_category_weight":
            continue
        repo = record.get("repo")
        source = source_records.get(repo)
        if not source:
            continue
        text = " ".join([
            str(repo),
            str(record.get("category", "")),
            str(source.get("license_evidence", "")),
            str(source.get("import_stance", "")),
            str(source.get("copy_boundary", "")),
            "local_experimental_training_allowed"
            if source.get("local_experimental_training_allowed")
            else "local_experimental_training_not_allowed",
            "redistribution_allowed" if source.get("redistribution_allowed") else "redistribution_not_allowed",
            "commercial_use_allowed" if source.get("commercial_use_allowed") else "commercial_use_not_allowed",
            " ".join(source.get("recommended_goodies", []) or []),
        ])
        samples.append(Sample(
            sample_id=f"category:{category_index}:{repo}:{record.get('category', '')}",
            group=str(repo),
            label=str(record.get("import_policy_class")),
            text=text,
            count=float(record.get("count") or 0),
            kind="category",
        ))
        category_index += 1

    capability_index = 0
    for record in records:
        if record.get("type") != "functionality_capability":
            continue
        repo = record.get("target_repo", "functionality")
        text = " ".join([
            str(repo),
            str(record.get("capability_id", "")),
            " ".join(record.get("source_paths", []) or []),
            " ".join(record.get("reversa_targets", []) or []),
            str(record.get("absorption_stance", "")),
            " ".join(record.get("test_targets", []) or []),
            str(record.get("notes", "")),
            str(record.get("copy_boundary", "")),
        ])
        samples.append(Sample(
            sample_id=f"functionality:{capability_index}:{repo}:{record.get('capability_id', '')}",
            group=str(repo),
            label=str(record.get("import_policy_class") or "permissive"),
            text=text,
            count=float(record.get("training_weight") or 1),
            kind="functionality",
        ))
        capability_index += 1

    return samples


def split_samples(samples: list[Sample], seed: int, mode: str, test_ratio: float) -> tuple[list[int], list[int]]:
    if mode == "stratified":
        return split_stratified(samples, seed, test_ratio)
    return split_by_repo(samples, seed)


def split_by_repo(samples: list[Sample], seed: int) -> tuple[list[int], list[int]]:
    repos_by_label: dict[str, list[str]] = {}
    for sample in samples:
        repos_by_label.setdefault(sample.label, [])
        if sample.group not in repos_by_label[sample.label]:
            repos_by_label[sample.label].append(sample.group)

    holdout_repos: set[str] = set()
    rng = random.Random(seed)
    for label, repos in repos_by_label.items():
        if len(repos) <= 1:
            continue
        shuffled = repos[:]
        rng.shuffle(shuffled)
        holdout_repos.add(shuffled[0])

    max_holdout = max(1, math.ceil(len({sample.group for sample in samples}) * 0.30))
    if len(holdout_repos) > max_holdout:
        holdout_repos = set(sorted(holdout_repos)[:max_holdout])

    train_indices = [index for index, sample in enumerate(samples) if sample.group not in holdout_repos]
    test_indices = [index for index, sample in enumerate(samples) if sample.group in holdout_repos]
    train_labels = {samples[index].label for index in train_indices}
    if len(train_labels) != len({sample.label for sample in samples}) or not test_indices:
        indices = list(range(len(samples)))
        rng.shuffle(indices)
        split = max(1, int(len(indices) * 0.80))
        train_indices = sorted(indices[:split])
        test_indices = sorted(indices[split:])
    return ensure_label_coverage(samples, train_indices, test_indices, rng)


def split_stratified(samples: list[Sample], seed: int, test_ratio: float) -> tuple[list[int], list[int]]:
    ratio = min(max(test_ratio, 0.05), 0.50)
    rng = random.Random(seed)
    train_indices: list[int] = []
    test_indices: list[int] = []

    labels = sorted({sample.label for sample in samples})
    for label in labels:
      label_indices = [index for index, sample in enumerate(samples) if sample.label == label]
      rng.shuffle(label_indices)
      if len(label_indices) <= 1:
          train_indices.extend(label_indices)
          continue
      test_count = max(1, int(round(len(label_indices) * ratio)))
      test_count = min(test_count, len(label_indices) - 1)
      test_indices.extend(label_indices[:test_count])
      train_indices.extend(label_indices[test_count:])

    return ensure_label_coverage(samples, sorted(train_indices), sorted(test_indices), rng)


def ensure_label_coverage(
    samples: list[Sample],
    train_indices: list[int],
    test_indices: list[int],
    rng: random.Random,
) -> tuple[list[int], list[int]]:
    train_set = set(train_indices)
    test_set = set(test_indices)
    all_labels = sorted({sample.label for sample in samples})

    for label in all_labels:
        label_indices = [index for index, sample in enumerate(samples) if sample.label == label]
        if len(label_indices) < 2:
            continue
        if any(index in test_set for index in label_indices):
            continue
        candidates = [index for index in label_indices if index in train_set]
        if len(candidates) < 2:
            continue
        chosen = rng.choice(candidates)
        train_set.remove(chosen)
        test_set.add(chosen)

    for label in all_labels:
        label_indices = [index for index, sample in enumerate(samples) if sample.label == label]
        if len(label_indices) < 2:
            continue
        if any(index in train_set for index in label_indices):
            continue
        candidates = [index for index in label_indices if index in test_set]
        if len(candidates) < 2:
            continue
        chosen = rng.choice(candidates)
        test_set.remove(chosen)
        train_set.add(chosen)

    return sorted(train_set), sorted(test_set)


def vectorize(samples: list[Sample], buckets: int) -> torch.Tensor:
    matrix = np.zeros((len(samples), buckets + 4), dtype=np.float32)
    for row, sample in enumerate(samples):
        for token in TOKEN_RE.findall(sample.text.lower()):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            bucket = int.from_bytes(digest[:8], "little") % buckets
            matrix[row, bucket] += 1.0
        norm = np.linalg.norm(matrix[row, :buckets])
        if norm > 0:
            matrix[row, :buckets] /= norm
        matrix[row, buckets] = math.log1p(sample.count) / 12.0
        matrix[row, buckets + 1] = 1.0 if sample.kind == "source" else 0.0
        matrix[row, buckets + 2] = 1.0 if sample.kind == "category" else 0.0
        matrix[row, buckets + 3] = 1.0 if sample.kind == "functionality" else 0.0
    return torch.tensor(matrix, dtype=torch.float32)


def vectorize_texts(items: list[tuple[str, float, str]], buckets: int) -> torch.Tensor:
    samples = [Sample(f"target:{index}", "target", "unknown", text, count, kind) for index, (text, count, kind) in enumerate(items)]
    return vectorize(samples, buckets)


def pick_device(requested: str) -> torch.device:
    if requested == "cpu":
        return torch.device("cpu")
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise SystemExit("CUDA requested but torch.cuda.is_available() is false")
        return torch.device("cuda")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def compute_class_weights(labels: torch.Tensor, class_count: int) -> torch.Tensor:
    counts = torch.bincount(labels.detach().cpu(), minlength=class_count).float()
    counts = torch.clamp(counts, min=1.0)
    weights = counts.sum() / (counts * class_count)
    return weights


@torch.no_grad()
def evaluate(model: PolicyClassifier, features: torch.Tensor, target: torch.Tensor, labels: list[str]) -> dict[str, Any]:
    model.eval()
    logits = model(features)
    pred = logits.argmax(dim=1).detach().cpu().numpy()
    truth = target.detach().cpu().numpy()
    report = classification_report(
        truth,
        pred,
        labels=list(range(len(labels))),
        target_names=labels,
        zero_division=0,
        output_dict=True,
    )
    return {
        "accuracy": float(accuracy_score(truth, pred)),
        "macro_f1": float(f1_score(truth, pred, average="macro", zero_division=0)),
        "classification_report": report,
    }


@torch.no_grad()
def predict_samples(model: PolicyClassifier, features: torch.Tensor, samples: list[Sample], labels: list[str]) -> list[dict[str, Any]]:
    model.eval()
    probabilities = torch.softmax(model(features), dim=1).detach().cpu().numpy()
    output = []
    for sample, probs in zip(samples, probabilities):
        order = np.argsort(probs)[::-1]
        output.append({
            "sample_id": sample.sample_id,
            "repo": sample.group,
            "kind": sample.kind,
            "truth": sample.label,
            "prediction": labels[int(order[0])],
            "confidence": float(probs[order[0]]),
            "top": [{"label": labels[int(index)], "probability": float(probs[index])} for index in order[:3]],
        })
    return output


def predict_target_scans(
    model: PolicyClassifier,
    labels: list[str],
    buckets: int,
    device: torch.device,
    target_scan_root: str | None,
) -> list[dict[str, Any]]:
    if not target_scan_root:
        return []
    root = Path(target_scan_root)
    reports = sorted(root.glob("**/report.json"))
    items: list[tuple[str, float, str]] = []
    report_names: list[str] = []
    for report_path in reports:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        by_category = report.get("summary", {}).get("by_category", {}) or {}
        top = sorted(by_category.items(), key=lambda item: (-item[1], item[0]))[:16]
        scan_name = str(report_path.parent.relative_to(root))
        text = " ".join([scan_name, " ".join(category for category, _ in top)])
        items.append((text, float(report.get("summary", {}).get("total_findings") or 0), "target_scan"))
        report_names.append(scan_name)
    if not items:
        return []
    features = vectorize_texts(items, buckets).to(device)
    model.eval()
    with torch.no_grad():
        probabilities = torch.softmax(model(features), dim=1).detach().cpu().numpy()
    output = []
    for name, probs in zip(report_names, probabilities):
        order = np.argsort(probs)[::-1]
        output.append({
            "target_scan": name,
            "advisory_prediction": labels[int(order[0])],
            "confidence": float(probs[order[0]]),
            "top": [{"label": labels[int(index)], "probability": float(probs[index])} for index in order[:3]],
            "note": "advisory only; target repo policy is not promoted from this prediction",
        })
    return output


def describe_device(device: torch.device) -> str:
    if device.type == "cuda":
        name = torch.cuda.get_device_name(device)
        memory = torch.cuda.get_device_properties(device).total_memory
        return f"cuda:{device.index or 0} {name} total_memory={memory}"
    return "cpu"


def build_environment_text(device: torch.device) -> str:
    lines = [
        f"python={sys.executable}",
        f"python_version={sys.version}",
        f"platform={platform.platform()}",
        f"torch={torch.__version__}",
        f"cuda_available={torch.cuda.is_available()}",
        f"cuda_version={torch.version.cuda}",
        f"device={describe_device(device)}",
    ]
    try:
        smi = subprocess.run(["nvidia-smi"], check=False, capture_output=True, text=True)
        lines.append("nvidia_smi_rc=" + str(smi.returncode))
        lines.append(smi.stdout)
        if smi.stderr:
            lines.append("nvidia_smi_stderr=" + smi.stderr)
    except FileNotFoundError:
        lines.append("nvidia_smi=missing")
    return "\n".join(lines).rstrip() + "\n"


def build_dataset_summary(samples: list[Sample], metrics: dict[str, Any]) -> str:
    by_label: dict[str, int] = {}
    by_repo: dict[str, int] = {}
    for sample in samples:
        by_label[sample.label] = by_label.get(sample.label, 0) + 1
        by_repo[sample.group] = by_repo.get(sample.group, 0) + 1
    return "\n".join([
        "# Reversa Agentic Policy Classifier Training",
        "",
        f"- Samples: {len(samples)}",
        f"- Train samples: {metrics['train_samples']}",
        f"- Test samples: {metrics['test_samples']}",
        f"- Device: `{metrics['device']}`",
        f"- Test accuracy: `{metrics['test_metrics']['accuracy']:.4f}`",
        f"- Test macro F1: `{metrics['test_metrics']['macro_f1']:.4f}`",
        "- Source text policy: no third-party source text copied.",
        "",
        "## Label Counts",
        "",
        markdown_table(["Label", "Count"], sorted(by_label.items())),
        "",
        "## Repo Sample Counts",
        "",
        markdown_table(["Repo", "Samples"], sorted(by_repo.items())),
        "",
    ])


def markdown_table(headers: list[str], rows: list[tuple[Any, ...]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(item) for item in row) + " |")
    return "\n".join(lines)


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


def write_hashes(out_dir: Path) -> None:
    files = [
        "policy-classifier.pt",
        "metrics.json",
        "labels.json",
        "vectorizer.json",
        "predictions.jsonl",
        "target-advisory-predictions.jsonl",
        "training-history.jsonl",
        "environment.txt",
        "dataset-summary.md",
    ]
    rows = []
    for name in files:
        path = out_dir / name
        if path.exists():
            rows.append(f"{sha256(path)}  {name}")
    (out_dir / "sha256sums.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
