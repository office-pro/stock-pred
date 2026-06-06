# ML engine: FastAPI + XGBoost/LightGBM/PyTorch (CPU wheels).
# docker build -f infrastructure/docker/ml-engine.Dockerfile apps/ml-engine
FROM python:3.11-slim

WORKDIR /service

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# CPU-only torch keeps the image several GB smaller than the CUDA build.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

COPY app ./app
COPY pytest.ini .

# Pre-create the models dir so the named volume initializes with mluser
# ownership (a volume mounted on a non-existent path is root-owned and the
# non-root runtime cannot write models into it).
RUN useradd --create-home mluser \
 && mkdir -p /service/ml-models \
 && chown -R mluser:mluser /service
USER mluser

EXPOSE 8000
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8000"]
