# ---------------------------------------------------------------------------
# FastAPI pose-analysis service
#
# Python 3.12 rather than 3.13: it has the wider ecosystem of prebuilt
# manylinux wheels for OpenCV, NumPy and torch, which keeps the image build
# fast and reproducible.
# ---------------------------------------------------------------------------

FROM python:3.12-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libGL / libglib are needed by OpenCV even in headless builds.
# curl backs the container healthcheck below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /service

# ---------------------------------------------------------------------------
# torch, from the CPU index, BEFORE anything else.
#
# `pip install torch` on linux/amd64 resolves to the CUDA build, which drags in
# the whole nvidia runtime - roughly 2.5-3 GB of wheels that cannot be used on
# a CPU-only EC2 instance and are never loaded. Installing the CPU wheels first
# means the later `-r requirements.txt` finds torch and torchvision already
# satisfied and leaves them alone.
#
# requirements.txt keeps its unpinned `torch>=2.0.0` so that a native install
# on a developer machine still resolves normally; this override is specific to
# the Linux image.
# ---------------------------------------------------------------------------
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch torchvision

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Non-root user created before the source is copied, so ownership is set by
# COPY --chown rather than by a recursive chown that would duplicate every
# layer it touches.
RUN useradd --create-home --uid 10001 poseuser

COPY --chown=poseuser:poseuser app app
COPY --chown=poseuser:poseuser scripts scripts

# ---------------------------------------------------------------------------
# Pose weights.
#
# Idempotent: the script verifies and checksums the file if it is already
# present (the 6.8 MB yolov8n-pose.pt is committed) and downloads it from the
# ultralytics release assets only when it is not. Doing this at BUILD time
# means a container that starts is a container that can actually analyse a
# frame, rather than one that accepts a session and then fails it.
#
# `--variant n` is the nano model, which is the one the service is configured
# for (POSE_MODEL_PATH defaults to app/pose/model/yolov8n-pose.pt). The value
# used to be `full`, a MediaPipe-era variant name that argparse rejects - it
# made this image unbuildable.
# ---------------------------------------------------------------------------
USER poseuser
RUN python scripts/download_model.py --variant n

EXPOSE 8000

# Present in the image itself, not only in docker-compose, so a plain
# `docker run` is still supervised. /ready rather than /health: it reports the
# pose model's state, and a service without a loaded model would answer
# /health perfectly while failing every session it accepted.
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/ready" || exit 1

# Shell form so ${PORT} expands. Platforms that assign a port at runtime route
# only to that port; a hard-coded 8000 is unreachable there. Falls back to 8000
# for docker-compose and local runs, which do not set PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
