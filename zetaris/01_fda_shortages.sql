-- openFDA drug shortages as a Zetaris REST source (public domain, CC0).
-- The feed holds ~1,600 entries; openFDA pages at 1,000, so two raw tables.
-- Run with: npm run zetaris:setup

CREATE LIGHTNING DATABASE FDA_REST DESCRIBE BY "openFDA drug shortages, NDC directory";

CREATE LIGHTNING REST TABLE shortages_p0 FROM FDA_REST REQUEST(
    endpoint "https://api.fda.gov/drug/shortages.json?limit=1000&skip=0",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ();

CREATE LIGHTNING REST TABLE shortages_p1 FROM FDA_REST REQUEST(
    endpoint "https://api.fda.gov/drug/shortages.json?limit=1000&skip=1000",
    method "get",
    response_type "json",
    http_encoding "URLENCODED"
) HEADER (
) BODY ();

CACHE TABLE fda_rest.shortages_p0;

CACHE TABLE fda_rest.shortages_p1;

CREATE SCHEMASTORE CONTAINER fda;

CREATE SCHEMASTORE VIEW shortages WITH CONTAINER fda AS
SELECT
    r.package_ndc,
    r.generic_name,
    r.company_name,
    r.status,
    r.availability,
    r.presentation,
    r.dosage_form,
    r.update_date,
    r.update_type,
    r.initial_posting_date,
    r.related_info,
    r.discontinued_date,
    r.therapeutic_category,
    to_json(r.openfda) AS openfda_json
FROM fda_rest.shortages_p0
LATERAL VIEW explode(results) AS r
UNION ALL
SELECT
    r.package_ndc,
    r.generic_name,
    r.company_name,
    r.status,
    r.availability,
    r.presentation,
    r.dosage_form,
    r.update_date,
    r.update_type,
    r.initial_posting_date,
    r.related_info,
    r.discontinued_date,
    r.therapeutic_category,
    to_json(r.openfda) AS openfda_json
FROM fda_rest.shortages_p1
LATERAL VIEW explode(results) AS r;
