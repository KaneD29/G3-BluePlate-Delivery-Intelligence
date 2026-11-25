FROM python:3.14.7-slim-bookworm
WORKDIR /opt/blueplate
COPY requirements.txt requirements-lock.txt requirements-deploy.txt ./
RUN pip install --no-cache-dir -c requirements-lock.txt -r requirements-deploy.txt
COPY . .
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BLUEPLATE_ENV=production
USER 65534:65534
CMD ["gunicorn","--workers","1","--threads","4","--bind","127.0.0.1:5000","--forwarded-allow-ips","","web_app_example.flask_db_connector:app"]
