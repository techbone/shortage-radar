-- Northwind General (fictional) pharmacy database as a Zetaris JDBC data source.
-- Postgres runs in this repo's docker compose (hospital-db) and is published on
-- the host at 5433; Zetaris's own containers reach it at host.docker.internal.
-- zetaris_reader is a read-only role on synthetic data (db/hospital/01_schema.sql).
--
-- Syntax found by trial against Zetaris 2.4.3.1 (see docs/build-log.md):
-- CREATE DATASOURCE needs `jdbcurl` (not `url`), and DESCRIBE BY accepts only
-- letters, digits, _ . - and comma.

CREATE DATASOURCE NORTHWIND_PG DESCRIBE BY "Northwind General pharmacy, synthetic" OPTIONS (
    jdbcdriver "org.postgresql.Driver",
    jdbcurl "jdbc:postgresql://host.docker.internal:5433/hospital",
    username "zetaris_reader",
    password "reader"
);

REGISTER DATASOURCE TABLES FROM NORTHWIND_PG;
