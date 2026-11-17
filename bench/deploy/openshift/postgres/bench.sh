# Sourced by the image's run-postgresql on every start, while the server listens on its local
# socket only. Idempotent: Bifrost's role and database; neither role may open the other's database.
psql --set ON_ERROR_STOP=1 --set=password="$BIFROST_DB_PASSWORD" >/dev/null <<'SQL'
SELECT 'CREATE ROLE bifrost LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bifrost')\gexec
ALTER ROLE bifrost WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'password';
SELECT 'CREATE DATABASE bifrost OWNER bifrost' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bifrost')\gexec
REVOKE CONNECT ON DATABASE bench FROM PUBLIC;
REVOKE CONNECT ON DATABASE bifrost FROM PUBLIC;
SQL

# Network logins need TLS and scram; the superuser stays on the local socket (oc exec).
sed -i -e 's/^host all all all md5$/hostssl all all all scram-sha-256/' -e '/^host replication all all md5$/d' "$PGDATA/pg_hba.conf"
