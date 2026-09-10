"""Fetch and verify the MediaPipe PoseLandmarker model bundle.

The model is NOT committed to the repository (see .gitignore) because it is a
~9 MB binary owned by Google. It is fetched deterministically instead, and its
SHA-256 is recorded on first download so that later runs detect a changed or
truncated artifact.

Model provenance
----------------
Source    : https://storage.googleapis.com/mediapipe-models/pose_landmarker/
Publisher : Google / MediaPipe
Licence   : Apache License 2.0
Card      : https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker

Usage
-----
    python scripts/download_model.py                # default: full
    python scripts/download_model.py --variant lite
    python scripts/download_model.py --verify-only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"

VARIANTS: dict[str, str] = {
    "lite": f"{BASE_URL}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    "full": f"{BASE_URL}/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "heavy": f"{BASE_URL}/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
}

MODEL_DIR = Path(__file__).resolve().parent.parent / "app" / "pose" / "model"
CHECKSUM_FILE = MODEL_DIR / "checksums.json"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_checksums() -> dict[str, str]:
    if CHECKSUM_FILE.exists():
        return json.loads(CHECKSUM_FILE.read_text(encoding="utf-8"))
    return {}


def save_checksums(data: dict[str, str]) -> None:
    CHECKSUM_FILE.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def download(variant: str, force: bool = False) -> Path:
    url = VARIANTS[variant]
    target = MODEL_DIR / f"pose_landmarker_{variant}.task"
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    if target.exists() and not force:
        print(f"[skip]  {target.name} already present ({target.stat().st_size:,} bytes)")
        return target

    print(f"[fetch] {url}")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            payload = response.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"[error] Download failed: {exc}", file=sys.stderr)
        print(
            "        The pose service cannot start without this file.\n"
            "        Retry when a network connection is available, or copy the\n"
            f"        file manually to {target}",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    if len(payload) < 1_000_000:
        print(
            f"[error] Downloaded only {len(payload):,} bytes - that is not a model bundle.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    target.write_bytes(payload)
    print(f"[ok]    Saved {target.name} ({len(payload):,} bytes)")
    return target


def verify(variant: str) -> bool:
    target = MODEL_DIR / f"pose_landmarker_{variant}.task"
    if not target.exists():
        print(f"[fail]  {target.name} is missing. Run without --verify-only.")
        return False

    checksums = load_checksums()
    actual = sha256_of(target)
    expected = checksums.get(variant)

    if expected is None:
        # First sighting: record it so future runs can detect drift.
        checksums[variant] = actual
        save_checksums(checksums)
        print(f"[ok]    Recorded SHA-256 for {variant}: {actual}")
        return True

    if actual != expected:
        print(
            f"[fail]  Checksum mismatch for {variant}\n"
            f"        expected {expected}\n"
            f"        actual   {actual}",
            file=sys.stderr,
        )
        return False

    print(f"[ok]    Checksum verified for {variant}: {actual[:16]}...")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=sorted(VARIANTS), default="full")
    parser.add_argument("--force", action="store_true", help="re-download even if present")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    if not args.verify_only:
        download(args.variant, force=args.force)

    return 0 if verify(args.variant) else 1


if __name__ == "__main__":
    raise SystemExit(main())
