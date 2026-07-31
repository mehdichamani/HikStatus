FROM public.ecr.aws/docker/library/python:3.12-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# استفاده از کش پیپ برای افزایش سرعت بیلدها
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

RUN useradd -m -s /bin/bash appuser

COPY --chown=appuser:appuser . .

RUN mkdir -p data && chown -R appuser:appuser data

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:28888/api/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "28888"]
