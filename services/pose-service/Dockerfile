# ---------------------------------------------------------------------------
# FastAPI pose-analysis service
#
# Python 3.12 rather than 3.13: MediaPipe publishes wheels for both, and 3.12
# has the wider ecosystem of prebuilt manylinux wheels for OpenCV and NumPy,
# which keeps the image build fast and reproducible.
# ---------------------------------------------------------------------------

FROM python:3.12-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# libGL / libglib are needed by OpenCV even in headless builds.
# curl is used by the compose healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /service

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app app
COPY scripts scripts
COPY pytest.ini .

# Fetch the MediaPipe model at BUILD time, not first request. A container that
# starts and then fails every session because it could not reach Google Storage
# is far worse than a build that fails loudly.
RUN python scripts/download_model.py --variant full

RUN useradd --create-home --uid 10001 poseuser \
 && chown -R poseuser:poseuser /service
USER poseuser

EXPOSE 8000
# Shell form so ${PORT} expands. Railway (and most PaaS) assign a random port
# at runtime and route only to it; a hard-coded 8000 is unreachable there.
# Falls back to 8000 for docker-compose and local runs, which do not set PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
