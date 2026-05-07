#!/bin/sh
set -eu

if [ "${KURA_AUTO_MIGRATE:-true}" = "true" ]; then
  echo "Running Prisma migrations..."
  npm run prisma:migrate:deploy
fi

exec "$@"
