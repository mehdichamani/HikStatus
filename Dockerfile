FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .

# Since we pinned requirements.txt, pip will install pre-compiled wheels directly.
# No build compilers (build-essential) are needed, bypassing Debian repository issues entirely.
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "28888"]