-- Create separate databases for services that share this Postgres instance.
-- Steadfirm backend, Immich, and Paperless each get their own database
-- within a single Postgres container.

CREATE DATABASE immich;
CREATE DATABASE paperless;

-- Extensions needed by Immich
\c immich
CREATE EXTENSION IF NOT EXISTS vectors;
CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;

-- Back to default
\c steadfirm
