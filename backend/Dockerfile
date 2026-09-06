FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
COPY scripts ./scripts
RUN pip install --no-cache-dir .

EXPOSE 8000
# Run migrations, then serve. DB must be reachable at start (compose depends_on).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
