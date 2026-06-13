#!/bin/sh
set -eu

if [ "${KURA_AUTO_MIGRATE:-false}" = "true" ]; then
  echo "KURA_AUTO_MIGRATE is no longer supported by the slim web image." >&2
  echo "Run the migrator image or Docker Compose migrate service before starting Kura web." >&2
  exit 1
fi

exec "$@"
