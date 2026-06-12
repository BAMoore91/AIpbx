# ============================================================================
# AIpbx AI Engine — real-time AI voice service
# Runs the FastAPI control API (8080) and the AudioSocket TCP server (9092).
# ============================================================================
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# ffmpeg/libsndfile are handy for offline/local audio providers (piper/whisper).
# build tooling kept minimal — wheels cover the core deps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY app ./app

# non-root runtime
RUN useradd --system --uid 10001 --create-home appuser
USER appuser

EXPOSE 8080 9092

CMD ["python", "-m", "app.main"]
