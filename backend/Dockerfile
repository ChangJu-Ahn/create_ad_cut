# syntax=docker/dockerfile:1.7

# -------- Stage 1: builder --------
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip wheel --wheel-dir=/wheels \
      "fastapi>=0.115.0" \
      "uvicorn[standard]>=0.32.0" \
      "python-multipart>=0.0.12" \
      "pydantic>=2.9.0" \
      "pydantic-settings>=2.5.0" \
      "openai>=1.54.0" \
      "azure-identity>=1.19.0" \
      "azure-storage-blob>=12.23.0" \
      "azure-cosmos>=4.7.0" \
      "Pillow>=11.0.0" \
      "httpx>=0.27.0"

# -------- Stage 2: runtime --------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# Non-root user
RUN groupadd -r app && useradd -r -g app app

WORKDIR /app

COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels /wheels/* && \
    rm -rf /wheels

COPY app ./app

USER app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
