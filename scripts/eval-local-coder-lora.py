#!/usr/bin/env python3
"""Evaluate a local Reversa coder LoRA adapter on held-out chat SFT rows.

This is an offline adapter-loss evaluator. It does not serve a model endpoint,
does not mutate scanner findings, and does not treat model output as source
authority. It writes hashes and metrics so a Reversa rebuild can prove what was
actually evaluated.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import platform
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

import torch
from peft import PeftModel
from torch.utils.data import DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, help="SFT dataset dir or JSONL file")
    parser.add_argument("--adapter", required=True, help="PEFT adapter directory")
    parser.add_argument("--out", required=True, help="Output directory for eval artifacts")
    parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-7B-Instruct")
    parser.add_argument("--split", default="test", choices=["train", "val", "test", "all"])
    parser.add_argument("--eval-file", help="Override eval JSONL path")
    parser.add_argument("--max-records", type=int, default=0, help="0 means all rows")
    parser.add_argument("--max-seq-length", type=int, default=768)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--no-4bit", action="store_true", help="Load base model without 4-bit quantization")
    parser.add_argument("--local-files-only", action="store_true", default=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    train_mod = load_training_module()
    eval_path = resolve_eval_path(args)
    adapter_dir = Path(args.adapter).resolve()
    if not adapter_dir.exists():
        raise SystemExit(f"adapter directory does not exist: {adapter_dir}")

    rows = train_mod.read_jsonl(eval_path)
    rows_total = len(rows)
    if args.max_records > 0:
        rows = rows[: args.max_records]
    if not rows:
        raise SystemExit(f"eval file has no rows: {eval_path}")

    tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=args.local_files_only, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    dataset = train_mod.TokenizedChatDataset(rows, tokenizer, args.max_seq_length)

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available; refusing to evaluate this LoRA on CPU by accident.")

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization_config = None
    if not args.no_4bit:
        quantization_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=dtype,
            bnb_4bit_use_double_quant=True,
        )

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        local_files_only=args.local_files_only,
        trust_remote_code=True,
        torch_dtype=dtype,
        device_map="auto",
        quantization_config=quantization_config,
    )
    model = PeftModel.from_pretrained(model, str(adapter_dir), is_trainable=False)
    model.eval()

    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False)
    batch_rows = []
    weighted_loss_total = 0.0
    rows_evaluated = 0
    finite_loss = True

    with torch.no_grad():
        for batch_index, batch in enumerate(loader):
            row_index = batch.pop("row_index", None)
            batch_size = int(batch["input_ids"].shape[0])
            batch = train_mod.move_batch(batch, train_mod.first_device(model))
            outputs = model(**batch)
            loss = float(outputs.loss.detach().cpu())
            if not math.isfinite(loss):
                finite_loss = False
            weighted_loss_total += loss * batch_size
            rows_evaluated += batch_size
            batch_rows.append({
                "batch": batch_index,
                "first_row_index": int(row_index[0].item()) if row_index is not None and len(row_index) else None,
                "rows": batch_size,
                "loss": loss,
            })
            if batch_index == 0 or (batch_index + 1) % 50 == 0:
                print(json.dumps({
                    "event": "eval_batch",
                    "batch": batch_index + 1,
                    "rows_evaluated": rows_evaluated,
                    "loss": loss,
                }, sort_keys=True), flush=True)

    mean_loss = weighted_loss_total / max(1, rows_evaluated)
    report = {
        "schema": "reversa.local_coder_lora_eval.v1",
        "model": args.model,
        "adapter_dir": str(adapter_dir),
        "adapter_model_sha256": sha256_file(adapter_dir / "adapter_model.safetensors"),
        "eval_file": str(eval_path),
        "eval_sha256": sha256_file(eval_path),
        "split": args.split,
        "rows_total": rows_total,
        "rows_evaluated": rows_evaluated,
        "max_records": args.max_records,
        "max_seq_length": args.max_seq_length,
        "batch_size": args.batch_size,
        "mean_loss": mean_loss,
        "perplexity": math.exp(mean_loss) if mean_loss < 20 else None,
        "finite_loss": finite_loss,
        "device": train_mod.describe_device(),
        "python": sys.version,
        "platform": platform.platform(),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "quantization": "4bit-nf4" if quantization_config is not None else "none",
        "local_only": True,
        "advisory_only": True,
        "deterministic_truth_above_model": True,
        "command": shlex.join([sys.executable, *sys.argv]),
    }

    write_json(out_dir / "eval_report.json", report)
    write_markdown(out_dir / "eval_report.md", report)
    (out_dir / "eval_batches.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in batch_rows),
        encoding="utf-8",
    )
    (out_dir / "environment.txt").write_text(build_environment_text(train_mod), encoding="utf-8")
    write_hashes(out_dir)

    print(f"Reversa local coder LoRA eval complete: {out_dir}", flush=True)
    print(f"- rows: {rows_evaluated}/{rows_total}", flush=True)
    print(f"- mean_loss: {mean_loss}", flush=True)
    print(f"- finite_loss: {finite_loss}", flush=True)
    return 0 if finite_loss else 2


def load_training_module() -> Any:
    script_path = Path(__file__).resolve().with_name("train-local-coder-lora.py")
    spec = importlib.util.spec_from_file_location("reversa_train_local_coder_lora", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load training helpers from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_eval_path(args: argparse.Namespace) -> Path:
    if args.eval_file:
        path = Path(args.eval_file).resolve()
    else:
        root = Path(args.dataset).resolve()
        if root.is_dir():
            if args.split == "all":
                file_name = "local-coder-sft.jsonl"
            else:
                file_name = f"local-coder-sft-{args.split}.jsonl"
            path = root / file_name
        else:
            path = root
    if not path.exists():
        raise SystemExit(f"eval file does not exist: {path}")
    return path


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    path.write_text(
        "\n".join([
            "# Reversa Local Coder LoRA Eval",
            "",
            f"- Model: `{report['model']}`",
            f"- Adapter: `{report['adapter_dir']}`",
            f"- Eval file: `{report['eval_file']}`",
            f"- Rows evaluated: `{report['rows_evaluated']}/{report['rows_total']}`",
            f"- Mean loss: `{report['mean_loss']}`",
            f"- Perplexity: `{report['perplexity']}`",
            f"- Finite loss: `{report['finite_loss']}`",
            f"- Device: `{report['device']}`",
            f"- Adapter hash: `{report['adapter_model_sha256']}`",
            f"- Eval hash: `{report['eval_sha256']}`",
            "",
            "This eval is advisory only. Deterministic scanner evidence, hashes, tests, and source artifacts remain above model output.",
            "",
        ]),
        encoding="utf-8",
    )


def build_environment_text(train_mod: Any) -> str:
    lines = [
        f"python={sys.version}",
        f"platform={platform.platform()}",
        f"torch={torch.__version__}",
        f"cuda_available={torch.cuda.is_available()}",
        f"cuda_version={torch.version.cuda}",
        f"device={train_mod.describe_device()}",
    ]
    try:
        result = subprocess.run(["nvidia-smi"], check=False, text=True, capture_output=True, timeout=10)
        lines.extend(["", "nvidia-smi:", result.stdout.strip(), result.stderr.strip()])
    except Exception as exc:
        lines.append(f"nvidia_smi_error={exc}")
    return "\n".join(line for line in lines if line is not None) + "\n"


def write_hashes(out_dir: Path) -> None:
    rows = []
    for path in sorted(item for item in out_dir.rglob("*") if item.is_file() and item.name != "sha256sums.txt"):
        rows.append(f"{sha256_file(path)}  {path.relative_to(out_dir)}")
    (out_dir / "sha256sums.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
