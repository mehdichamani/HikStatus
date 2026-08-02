FROM public.ecr.aws/docker/library/python:3.12-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .

# نصب بسته‌ها بدون استفاده از کش پیپ (پیشنهاد استاندارد برای اکثر محیط‌ها)
# این خط می‌تواند در محیط‌های CI/CD مانند Railway یا DigitalOcean به‌صورت مستقیم استفاده شود.
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

RUN useradd -m -s /bin/bash appuser

COPY --chown=appuser:appuser . .

RUN mkdir -p data && chown -R appuser:appuser data

USER appuser

# تنظیمات پیش‌فرض برای پورت و هاست (قابل بازنویسی از طریق متغیرهای محیطی)
ENV HOST=0.0.0.0 \
    PORT=28888

# اعلام پورت برای ابزارهای اورکستری مانند Railway/DigitalOcean (قابل تغییر از طریق متغیر PORT)
EXPOSE $PORT

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import os, urllib.request; \
    host=os.getenv('HOST','0.0.0.0'); port=os.getenv('PORT','28888'); \
    urllib.request.urlopen(f'http://{host}:{port}/api/health')" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host $HOST --port $PORT"]
