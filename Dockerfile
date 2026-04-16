FROM python:3.11-slim

# Prevents .pyc files and enables unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run injects $PORT at runtime; default to 8080 for local docker runs
ENV PORT=8080

CMD exec gunicorn app:app --bind "0.0.0.0:$PORT" --workers 2 --timeout 120
