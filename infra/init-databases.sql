-- Create separate databases for services that share this Postgres instance.
-- Steadfirm backend, Immich, and Paperless each get their own database
-- within a single Postgres container.
--
-- Using ghcr.io/immich-app/postgres which bundles VectorChord + pgvectors.

CREATE DATABASE immich;
CREATE DATABASE paperless;

-- Extensions needed by Immich (bundled in the immich-app/postgres image)
\c immich
CREATE EXTENSION IF NOT EXISTS vchord CASCADE;
CREATE EXTENSION IF NOT EXISTS vectors;
CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;

-- Back to default
\c steadfirm
