#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

# Set PYTHONPATH to include the project root
export PYTHONPATH=/opt/sam2:$PYTHONPATH

# Print environment variables for debugging (optional)
echo "--- Entrypoint: Starting Gunicorn ---"
echo "GUNICORN_WORKERS=${GUNICORN_WORKERS}"
echo "GUNICORN_THREADS=${GUNICORN_THREADS}"
echo "GUNICORN_PORT=${GUNICORN_PORT}"
echo "PYTHONPATH=${PYTHONPATH}"

# Execute the Gunicorn command
exec gunicorn --worker-tmp-dir /dev/shm \
    --worker-class gthread app:app \
    --log-level info \
    --access-logfile /dev/stdout \
    --log-file /dev/stderr \
    --workers "${GUNICORN_WORKERS}" \
    --threads "${GUNICORN_THREADS}" \
    --bind "0.0.0.0:${GUNICORN_PORT}" \
    --timeout 60 \
    --reload 