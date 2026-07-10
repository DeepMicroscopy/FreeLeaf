FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

RUN useradd --create-home --uid 1000 appuser
USER appuser

EXPOSE 8100

CMD ["python", "main.py"]
