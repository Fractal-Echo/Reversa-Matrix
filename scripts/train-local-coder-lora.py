#!/usr/bin/env python3
"""Train a local advisory LoRA for Reversa coder reasoning.

This lane is deliberately separate from deterministic scanner truth. It trains
on local-only chat SFT examples and saves a PEFT adapter plus hashes. It does
not claim source authority, patch binaries, or export private training data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import random
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, PeftModel, TaskType, get_peft_model, prepare_model_for_kbit_training
from torch.utils.data import DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, help="SFT dataset dir or local-coder-sft.jsonl path")
    parser.add_argument("--out", required=True, help="Output directory for adapter artifacts")
    parser.add_argument("--model", default="Qwen/Qwen2.5-Coder-7B-Instruct")
    parser.add_argument("--train-file", help="Override train JSONL")
    parser.add_argument("--val-file", help="Override validation JSONL")
    parser.add_argument("--max-train-records", type=int, default=0)
    parser.add_argument("--max-val-records", type=int, default=64)
    parser.add_argument("--max-seq-length", type=int, default=768)
    parser.add_argument("--max-steps", type=int, default=25)
    parser.add_argument("--eval-steps", type=int, default=25)
    parser.add_argument("--eval-start-step", type=int, default=25)
    parser.add_argument("--log-steps", type=int, default=10)
    parser.add_argument("--save-metrics-every", type=int, default=0)
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--resume-adapter", help="Existing PEFT adapter directory to resume from")
    parser.add_argument("--save-steps", type=int, default=0, help="Save checkpoint-step-XXXX adapters every N optimizer steps")
    parser.add_argument("--seed", type=int, default=20260630)
    parser.add_argument("--no-4bit", action="store_true", help="Load base model in bf16/fp16 instead of 4-bit")
    parser.add_argument("--dry-run", action="store_true", help="Validate dataset/tokenization without loading the base model")
    parser.add_argument("--local-files-only", action="store_true", default=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    train_path, val_path = resolve_dataset_paths(args)
    train_sha256 = sha256_file(train_path)
    val_sha256 = sha256_file(val_path) if val_path and val_path.exists() else None
    train_rows = read_jsonl(train_path)
    val_rows = read_jsonl(val_path) if val_path and val_path.exists() else []
    if args.max_train_records > 0:
        train_rows = train_rows[: args.max_train_records]
    if args.max_val_records > 0:
        val_rows = val_rows[: args.max_val_records]
    if not train_rows:
        raise SystemExit(f"training file has no rows: {train_path}")

    tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=args.local_files_only, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    train_dataset = TokenizedChatDataset(train_rows, tokenizer, args.max_seq_length)
    val_dataset = TokenizedChatDataset(val_rows, tokenizer, args.max_seq_length) if val_rows else None

    if args.dry_run:
        write_json(out_dir / "dry-run-summary.json", {
            "model": args.model,
            "train_file": str(train_path),
            "val_file": str(val_path) if val_path else None,
            "train_sha256": train_sha256,
            "val_sha256": val_sha256,
            "train_rows": len(train_rows),
            "val_rows": len(val_rows),
            "max_seq_length": args.max_seq_length,
            "first_train_tokens": int(train_dataset[0]["attention_mask"].sum().item()),
            "local_only": True,
            "advisory_only": True,
        })
        write_hashes(out_dir)
        print(f"Reversa local coder LoRA dry-run complete: {out_dir}")
        return 0

    if not torch.cuda.is_available():
        raise SystemExit("CUDA is not available; refusing to run local LoRA training on CPU by accident.")

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
    model.config.use_cache = False
    if quantization_config is not None:
        model = prepare_model_for_kbit_training(model)
    if hasattr(model, "gradient_checkpointing_enable"):
        model.gradient_checkpointing_enable()

    if args.resume_adapter:
        model = PeftModel.from_pretrained(model, args.resume_adapter, is_trainable=True)
    else:
        peft_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=args.lora_r,
            lora_alpha=args.lora_alpha,
            lora_dropout=args.lora_dropout,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            bias="none",
        )
        model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    optimizer = torch.optim.AdamW((param for param in model.parameters() if param.requires_grad), lr=args.learning_rate)
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size, shuffle=False) if val_dataset else None

    history: list[dict[str, Any]] = []
    train_log_path = out_dir / "train_log.jsonl"
    live_metrics_path = out_dir / "metrics-live.json"
    row_coverage_path = out_dir / "row-coverage.tsv"
    for stale_path in [train_log_path, live_metrics_path, row_coverage_path]:
        if stale_path.exists():
            stale_path.unlink()
    row_seen_counts = [0] * len(train_dataset)
    rows_seen_total = 0

    model.train()
    optimizer.zero_grad(set_to_none=True)
    step = 0
    accum = 0
    total_loss = 0.0
    max_updates = args.max_steps
    max_epochs = max(1, math.ceil(args.epochs))

    for epoch in range(max_epochs):
        for batch in train_loader:
            row_indices = batch.pop("row_index", None)
            if row_indices is not None:
                for row_index in row_indices.tolist():
                    if 0 <= int(row_index) < len(row_seen_counts):
                        row_seen_counts[int(row_index)] += 1
                        rows_seen_total += 1
            batch = move_batch(batch, first_device(model))
            outputs = model(**batch)
            if not torch.isfinite(outputs.loss):
                raise RuntimeError(f"non-finite training loss before optimizer step {step + 1}")
            loss = outputs.loss / args.grad_accum
            loss.backward()
            accum += 1
            total_loss += float(loss.detach().cpu()) * args.grad_accum

            if accum % args.grad_accum == 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                step += 1
                mean_loss = total_loss / max(1, args.grad_accum)
                row = {
                    "event": "train_step",
                    "step": step,
                    "epoch": epoch + 1,
                    "train_loss": mean_loss,
                    "learning_rate": args.learning_rate,
                    **coverage_summary(row_seen_counts, rows_seen_total),
                }
                history.append(row)
                append_jsonl(train_log_path, row)
                if step == 1 or step % max(1, args.log_steps) == 0 or step == max_updates:
                    print(json.dumps(row, sort_keys=True), flush=True)

                should_eval = (
                    val_loader
                    and step >= args.eval_start_step
                    and (step % max(1, args.eval_steps) == 0 or step == max_updates)
                )
                if should_eval:
                    eval_row = {
                        "event": "eval",
                        "step": step,
                        "epoch": epoch + 1,
                        "val_loss": evaluate(model, val_loader),
                        **coverage_summary(row_seen_counts, rows_seen_total),
                    }
                    row["val_loss"] = eval_row["val_loss"]
                    append_jsonl(train_log_path, eval_row)
                    print(json.dumps(eval_row, sort_keys=True), flush=True)

                if args.save_metrics_every > 0 and step % args.save_metrics_every == 0:
                    write_json(live_metrics_path, partial_metrics(args, train_path, val_path, train_sha256, val_sha256, train_rows, val_rows, step, history, row_seen_counts, rows_seen_total))

                if args.save_steps > 0 and step % args.save_steps == 0:
                    checkpoint_dir = out_dir / f"checkpoint-step-{step:06d}"
                    model.save_pretrained(checkpoint_dir)
                total_loss = 0.0
                if step >= max_updates:
                    break
        remainder = accum % args.grad_accum
        if remainder and step < max_updates:
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            mean_loss = total_loss / max(1, remainder)
            row = {
                "event": "train_step",
                "step": step,
                "epoch": epoch + 1,
                "train_loss": mean_loss,
                "learning_rate": args.learning_rate,
                "partial_grad_accum_step": True,
                **coverage_summary(row_seen_counts, rows_seen_total),
            }
            history.append(row)
            append_jsonl(train_log_path, row)
            print(json.dumps(row, sort_keys=True), flush=True)
            should_eval = (
                val_loader
                and step >= args.eval_start_step
                and (step % max(1, args.eval_steps) == 0 or step == max_updates or epoch + 1 >= max_epochs)
            )
            if should_eval:
                eval_row = {
                    "event": "eval",
                    "step": step,
                    "epoch": epoch + 1,
                    "val_loss": evaluate(model, val_loader),
                    **coverage_summary(row_seen_counts, rows_seen_total),
                }
                row["val_loss"] = eval_row["val_loss"]
                append_jsonl(train_log_path, eval_row)
                print(json.dumps(eval_row, sort_keys=True), flush=True)
            if args.save_metrics_every > 0 and step % args.save_metrics_every == 0:
                write_json(live_metrics_path, partial_metrics(args, train_path, val_path, train_sha256, val_sha256, train_rows, val_rows, step, history, row_seen_counts, rows_seen_total))
            if args.save_steps > 0 and step % args.save_steps == 0:
                checkpoint_dir = out_dir / f"checkpoint-step-{step:06d}"
                model.save_pretrained(checkpoint_dir)
            total_loss = 0.0
        if step >= max_updates:
            break

    adapter_dir = out_dir / "adapter"
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    write_row_coverage(row_coverage_path, row_seen_counts)

    metrics = {
        "schema": "reversa.local_coder_lora_result.v1",
        "model": args.model,
        "adapter_dir": str(adapter_dir),
        "train_file": str(train_path),
        "train_sha256": train_sha256,
        "val_file": str(val_path) if val_path else None,
        "val_sha256": val_sha256,
        "train_rows": len(train_rows),
        "val_rows": len(val_rows),
        "max_seq_length": args.max_seq_length,
        "steps": step,
        "eval_steps": args.eval_steps,
        "eval_start_step": args.eval_start_step,
        "log_steps": args.log_steps,
        "save_metrics_every": args.save_metrics_every,
        "epochs_requested": args.epochs,
        "batch_size": args.batch_size,
        "grad_accum": args.grad_accum,
        "learning_rate": args.learning_rate,
        "lora_r": args.lora_r,
        "lora_alpha": args.lora_alpha,
        "lora_dropout": args.lora_dropout,
        "resume_adapter": args.resume_adapter,
        "save_steps": args.save_steps,
        "quantization": "4bit-nf4" if quantization_config is not None else "none",
        "device": describe_device(),
        "python": sys.version,
        "platform": platform.platform(),
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "local_only": True,
        "advisory_only": True,
        "deterministic_truth_above_model": True,
        "command": shlex.join([sys.executable, *sys.argv]),
        "argv": [sys.executable, *sys.argv],
        "row_coverage": coverage_summary(row_seen_counts, rows_seen_total),
        "history": history,
    }
    write_json(out_dir / "metrics.json", metrics)
    (out_dir / "training-history.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in history),
        encoding="utf-8",
    )
    (out_dir / "environment.txt").write_text(build_environment_text(), encoding="utf-8")
    write_hashes(out_dir)

    print(f"Reversa local coder LoRA trained: {out_dir}", flush=True)
    print(f"- adapter: {adapter_dir}", flush=True)
    print(f"- steps: {step}", flush=True)
    print(f"- row coverage: {metrics['row_coverage']['unique_rows_seen']}/{metrics['row_coverage']['train_rows']} ({metrics['row_coverage']['coverage_fraction']:.6f})", flush=True)
    print(f"- device: {metrics['device']}", flush=True)
    return 0


class TokenizedChatDataset(torch.utils.data.Dataset):
    def __init__(self, rows: list[dict[str, Any]], tokenizer: Any, max_length: int) -> None:
        self.rows = rows
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        messages = self.rows[index].get("messages")
        if not isinstance(messages, list) or len(messages) < 2:
            raise ValueError(f"row {index} missing chat messages")
        prompt_messages = messages[:-1]
        full_text = self.tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        prompt_text = self.tokenizer.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True)
        full_ids = self.tokenizer(full_text, add_special_tokens=False)["input_ids"]
        prompt_ids = self.tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
        answer_ids = full_ids[len(prompt_ids):] if full_ids[:len(prompt_ids)] == prompt_ids else []
        if not answer_ids:
            answer_ids = self.tokenizer(
                str(messages[-1].get("content", "")) + str(self.tokenizer.eos_token or ""),
                add_special_tokens=False,
            )["input_ids"]
        if not answer_ids:
            raise ValueError(f"row {index} produced no assistant training tokens")

        if len(prompt_ids) + len(answer_ids) <= self.max_length:
            prompt_part = prompt_ids
            answer_part = answer_ids
        else:
            answer_budget = min(len(answer_ids), max(16, self.max_length // 2))
            prompt_budget = max(1, self.max_length - answer_budget)
            prompt_part = prompt_ids[-prompt_budget:]
            answer_part = answer_ids[: self.max_length - len(prompt_part)]
        if not answer_part:
            raise ValueError(f"row {index} lost assistant tokens after truncation")

        input_values = prompt_part + answer_part
        pad_count = self.max_length - len(input_values)
        input_ids = torch.tensor(input_values + [self.tokenizer.pad_token_id] * pad_count, dtype=torch.long)
        attention_mask = torch.tensor([1] * len(input_values) + [0] * pad_count, dtype=torch.long)
        labels = input_ids.clone()
        labels[:len(prompt_part)] = -100
        labels[attention_mask == 0] = -100
        return {
            "row_index": torch.tensor(index, dtype=torch.long),
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "labels": labels,
        }


@torch.no_grad()
def evaluate(model: torch.nn.Module, loader: DataLoader) -> float:
    model.eval()
    losses = []
    for index, batch in enumerate(loader):
        if index >= 16:
            break
        batch.pop("row_index", None)
        batch = move_batch(batch, first_device(model))
        outputs = model(**batch)
        losses.append(float(outputs.loss.detach().cpu()))
    model.train()
    return float(sum(losses) / max(1, len(losses)))


def resolve_dataset_paths(args: argparse.Namespace) -> tuple[Path, Path | None]:
    root = Path(args.dataset).resolve()
    if args.train_file:
        train = Path(args.train_file).resolve()
    elif root.is_dir():
        train = root / "local-coder-sft-train.jsonl"
    else:
        train = root

    if args.val_file:
        val = Path(args.val_file).resolve()
    elif root.is_dir():
        val = root / "local-coder-sft-val.jsonl"
    else:
        candidate = train.with_name(train.stem.replace("-train", "-val") + train.suffix)
        val = candidate if candidate.exists() else None

    if not train.exists():
        raise SystemExit(f"train file does not exist: {train}")
    return train, val


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        for line_number, line in enumerate(handle, 1):
            line = line.rstrip("\n")
            if line.endswith("\r"):
                line = line[:-1]
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSONL row {line_number} in {path}: {exc}") from exc
    return rows


def move_batch(batch: dict[str, torch.Tensor], device: torch.device) -> dict[str, torch.Tensor]:
    return {key: value.to(device) for key, value in batch.items()}


def first_device(model: torch.nn.Module) -> torch.device:
    for parameter in model.parameters():
        return parameter.device
    return torch.device("cuda")


def describe_device() -> str:
    if not torch.cuda.is_available():
        return "cpu"
    index = torch.cuda.current_device()
    props = torch.cuda.get_device_properties(index)
    return f"cuda:{index} {props.name} total_memory={props.total_memory}"


def build_environment_text() -> str:
    lines = [
        f"python={sys.version}",
        f"platform={platform.platform()}",
        f"torch={torch.__version__}",
        f"cuda_available={torch.cuda.is_available()}",
        f"cuda_version={torch.version.cuda}",
        f"device={describe_device()}",
    ]
    try:
        result = subprocess.run(["nvidia-smi"], check=False, text=True, capture_output=True, timeout=10)
        lines.extend(["", "nvidia-smi:", result.stdout.strip(), result.stderr.strip()])
    except Exception as exc:
        lines.append(f"nvidia-smi_error={exc}")
    return "\n".join(line for line in lines if line is not None) + "\n"


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def append_jsonl(path: Path, value: Any) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, sort_keys=True) + "\n")


def coverage_summary(row_seen_counts: list[int], rows_seen_total: int) -> dict[str, Any]:
    train_rows = len(row_seen_counts)
    unique_rows_seen = sum(1 for count in row_seen_counts if count > 0)
    max_row_repeats = max(row_seen_counts) if row_seen_counts else 0
    missing_rows = train_rows - unique_rows_seen
    return {
        "train_rows": train_rows,
        "rows_seen_total": rows_seen_total,
        "effective_rows_seen": rows_seen_total,
        "unique_rows_seen": unique_rows_seen,
        "missing_rows": missing_rows,
        "coverage_fraction": unique_rows_seen / train_rows if train_rows else 0.0,
        "coverage_complete": missing_rows == 0,
        "max_row_repeats": max_row_repeats,
    }


def partial_metrics(
    args: argparse.Namespace,
    train_path: Path,
    val_path: Path | None,
    train_sha256: str,
    val_sha256: str | None,
    train_rows: list[dict[str, Any]],
    val_rows: list[dict[str, Any]],
    step: int,
    history: list[dict[str, Any]],
    row_seen_counts: list[int],
    rows_seen_total: int,
) -> dict[str, Any]:
    return {
        "schema": "reversa.local_coder_lora_live_metrics.v1",
        "model": args.model,
        "train_file": str(train_path),
        "train_sha256": train_sha256,
        "val_file": str(val_path) if val_path else None,
        "val_sha256": val_sha256,
        "train_rows": len(train_rows),
        "val_rows": len(val_rows),
        "step": step,
        "max_steps": args.max_steps,
        "batch_size": args.batch_size,
        "grad_accum": args.grad_accum,
        "learning_rate": args.learning_rate,
        "resume_adapter": args.resume_adapter,
        "command": shlex.join([sys.executable, *sys.argv]),
        "row_coverage": coverage_summary(row_seen_counts, rows_seen_total),
        "last_history_rows": history[-20:],
    }


def write_row_coverage(path: Path, row_seen_counts: list[int]) -> None:
    rows = ["row_index\tseen_count"]
    rows.extend(f"{index}\t{count}" for index, count in enumerate(row_seen_counts))
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")


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
