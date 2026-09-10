#!/usr/bin/env python
"""Fetch the YOLOv8 pose weights and record a checksum.

    python scripts/download_model.py            # yolov8n-pose (default)
    python scripts/download_model.py --variant s
    python scripts/download_model.py --verify   # check what is already there

Model     : YOLOv8 pose (ultralytics)
Source    : https://github.com/ultralytics/assets/releases
Licence   : AGPL-3.0
Card      : https://docs.ultralytics.com/tasks/pose/

Why a script rather than letting ultralytics do it
---------------------------------------------------
`YOLO("yolov8n-pose.pt")` downloads on first use, into whatever the current
working directory happens to be. That means the weights land in a different
place depending on how the service was started, and the first patient session
pays a network download. This puts them in one known location next to the
service, records the SHA-256 so a corrupted or swapped file is detectable, and
fails loudly at startup if they are absent.

Nothing is committed to git: the weights are ignored, exactly as the MediaPipe
bundle was.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = SERVICE_ROOT / "app" / "pose" / "model"
CHECKSUM_FILE = MODEL_DIR / "checksums.json"

#: n = nano (fastest, ~6.5 MB) - the variant the prototype used.
#: s/m are larger and more accurate; anything beyond that is not realistic on
#: a CPU at 10 fps.
VARIANTS = ("n", "s", "m")
DEFAULT_VARIANT = "n"


def weights_name(variant: str) -> str:
    return f"yolov8{variant}-pose.pt"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def record_checksum(target: Path) -> str:
    digest = sha256_of(target)
    existing = {}
    if CHECKSUM_FILE.exists():
        try:
            existing = json.loads(CHECKSUM_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}
    existing[target.name] = {"sha256": digest, "bytes": target.stat().st_size}
    CHECKSUM_FILE.write_text(
        json.dumps(existing, indent=2) + "\n", encoding="utf-8"
    )
    return digest


def download(variant: str) -> int:
    name = weights_name(variant)
    target = MODEL_DIR / name
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    if target.exists():
        print(f"Already present: {target} ({target.stat().st_size:,} bytes)")
        print(f"  sha256: {record_checksum(target)}")
        return 0

    try:
        from ultralytics import YOLO
    except ImportError:
        print(
            "ultralytics is not installed. Run:\n"
            "  .venv/Scripts/python -m pip install -r requirements.txt",
            file=sys.stderr,
        )
        return 2

    print(f"Downloading {name} ...")
    # Loading by bare name triggers ultralytics' own download into the CWD.
    YOLO(name)

    landed = Path.cwd() / name
    if not landed.exists():
        print(f"Expected {landed} after download but it is missing.", file=sys.stderr)
        return 1

    shutil.move(str(landed), str(target))
    print(f"Saved: {target} ({target.stat().st_size:,} bytes)")
    print(f"  sha256: {record_checksum(target)}")
    return 0


def verify(variant: str) -> int:
    target = MODEL_DIR / weights_name(variant)
    if not target.exists():
        print(f"MISSING: {target}", file=sys.stderr)
        print("Run: python scripts/download_model.py", file=sys.stderr)
        return 1

    digest = sha256_of(target)
    print(f"Present : {target}")
    print(f"Bytes   : {target.stat().st_size:,}")
    print(f"sha256  : {digest}")

    if CHECKSUM_FILE.exists():
        try:
            recorded = json.loads(CHECKSUM_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            recorded = {}
        entry = recorded.get(target.name)
        if entry and entry.get("sha256") != digest:
            print(
                "CHECKSUM MISMATCH - the file on disk is not the one that was "
                "recorded. Delete it and download again.",
                file=sys.stderr,
            )
            return 1
        if entry:
            print("Checksum matches the recorded value.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=VARIANTS, default=DEFAULT_VARIANT)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()

    return verify(args.variant) if args.verify else download(args.variant)


if __name__ == "__main__":
    raise SystemExit(main())
