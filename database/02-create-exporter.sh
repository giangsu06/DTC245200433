#!/bin/sh
set -eu

case "$MYSQL_EXPORTER_USER" in
  *[!A-Za-z0-9_]*|"") echo "MYSQL_EXPORTER_USER may contain only letters, digits, and underscores" >&2; exit 1 ;;
esac
case "$MYSQL_EXPORTER_PASSWORD" in
  *[!A-Za-z0-9_-]*|"") echo "MYSQL_EXPORTER_PASSWORD may contain only letters, digits, underscores, and hyphens" >&2; exit 1 ;;
esac
if [ "${#MYSQL_EXPORTER_PASSWORD}" -lt 32 ]; then
  echo "MYSQL_EXPORTER_PASSWORD must contain at least 32 characters" >&2
  exit 1
fi

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE USER IF NOT EXISTS '${MYSQL_EXPORTER_USER}'@'%' IDENTIFIED BY '${MYSQL_EXPORTER_PASSWORD}';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO '${MYSQL_EXPORTER_USER}'@'%';
SQL
