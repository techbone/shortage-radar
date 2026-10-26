# Build log

Each entry: what surprised us, the dead end, the path we chose, and what guards it. This feeds the README's "hard problem" section.

---

## 2026-10-22 · Recalls don't predict shortages, so the agent doesn't predict

**Idea we started with.** Shortages leave fingerprints before the FDA lists them (a recall at the maker's plant, a warning letter), so an agent could flag a drug before it shows up on the list.

**What the data said.** For the 142 ingredients whose shortage was first posted in 2025–26, we checked whether a recall of the same ingredient happened in the window before the posting, against 357 ANDA generics that were never on the list, at matched dates.

| Window | Shortage drugs with a prior recall | Never-short drugs | Lift |
|---|---|---|---|
| 180 days | 12.7% | 13.4% | 0.9× |
| 365 days | 16.2% | 24.8% | 0.7× |

Recalls by the same company that later reported the shortage: 2–3 of 142. Discontinuations give no notice either: all 448 "To Be Discontinued" entries were posted the same day as their discontinuation date.

**Path chosen.** Drop prediction. The real job is triage: the list changed 746 entries in the 7 days to 22 Oct, and the buyer needs the three that touch their formulary, the days of stock left, and the NDC to buy instead.

**Guard.** `research/recall_backtest.py`, output in `docs/evidence/2026-10-22-recall-backtest.md`. `AGENTS.md` forbids prediction claims.

**Caveats.** Ingredient matching is a crude name key, and the shortage feed only holds entries still listed. A better-controlled test could find a weak signal; it would not be strong enough to demo honestly.

---

## 2026-10-23 · Zetaris on Apple Silicon

Preflight: platform images are amd64 only, and Docker had 7 GB of the recommended 8 GB. Fix: Rosetta emulation on and Docker memory raised to 12 GB before the first pull.

---

## 2026-10-23 · World Model: no fuzzy merges for drugs, and no O(n²) writes

**Surprise 1.** The reference engine auto-merges name-keyed entities at ≥ 0.85 name similarity. For drugs that is dangerous: look-alike drug names are a known cause of medication errors, and a fuzzy merge would fold two different products into one. **Path:** every drug-side entity is keyed by an identifier (package NDC, normalized substance, normalized company), so the fuzzy resolver never sees them. The resolver still exists and passes `band-001` for name-keyed entities.

**Surprise 2.** The reference rewrites its whole JSON file on every event. A single FDA snapshot is 7,343 events. **Path:** append-only JSONL, buffered and flushed once per write batch; an index of open edges per slot so superseding is O(1). Baseline ingest takes ~60 ms. **Guard:** `tests/world-model-shortages.test.ts` (re-ingest appends 0 events; reload from disk replays to the same canonical state).

**Surprise 3.** 26 NDCs appear twice in the feed (e.g. "Current / Unavailable" and "To Be Discontinued"). **Path:** two bitemporal edge slots per product, `shortage-state` and `discontinuation`.

---

## 2026-10-23 · Scout Intent: poisoned FDA text must not blank the brief

**Context.** FDA free text (`related_info`, `presentation`) and every Zetaris row from a public API reach the model. That text is written by third parties.

**Dead end.** The spec's `guard()` blocks the whole request when any snippet is poisoned. In our flow that turns one poisoned record into a denial of service on the morning brief.

**Path.** Guard per field, withhold only the poisoned field (`[withheld: suspected prompt injection]`), keep numbers and the rest of the row, and tell the model which sources were withheld. The prompt builder accepts only a `GuardedContext`, which only `src/agent/untrusted.ts` can create, and fences each block as escaped `<data>` so content cannot close its own fence.

**Surprises.** (1) A real manufacturer phrase, "Please disregard previous communication regarding NDC …", tripped the override rule; blocking it would hide a legitimate update. (2) Capital Cyrillic look-alikes slipped through because folding ran in the wrong order. (3) The official runner's gate fails any injection-only run on intent/tool metrics with zero examples.

**Guard.** `tests/scout-intent.test.ts` (targets on each corpus, 0 blocks on 2,242 real FDA fields, field-level withholding, credential redaction, fence escaping). Evidence: `docs/evidence/scout-injection-evals.md`.

---

## 2026-10-25 · Nemotron answered with nothing: the token cap ate the answer

**Symptom.** First live request through Nightshift returned `502 provider_error … nemotron-3.5-lightning-30b-a3b_empty_response`. Auth, model discovery and routing all worked; the request reached NVIDIA.

**Cause.** Our check capped the reply at 80 tokens. Nemotron 3.5 Lightning is a reasoning model: a one-sentence answer cost 530–590 completion tokens, nearly all of it thinking, so an 80-token cap left no room for visible text.

**Path.** Never cap `max_tokens` below ~1024 (rule added to `AGENTS.md`), and plan for 5–9 s per call, which shapes how many model calls one run can afford (plan once, critique once). **Guard:** `npm run nightshift:check` now uses 1024 and prints the answering model.

**Also hit.** Pasting Nightshift's "Copy setup" block into `.env` put the token on a line with spaces and left six non-`KEY=value` lines behind. Fixed by extracting the token into one line; a malformed `.env` is now something to check first when a key "doesn't work".

---

## 2026-10-25 · Zetaris: the hospital database and the FDA feed in one query

**FDA feed as a REST table.** `CREATE LIGHTNING REST TABLE` over `api.fda.gov/drug/shortages.json` (two pages of 1,000), `CACHE TABLE`, then a SchemaStore view with `LATERAL VIEW explode(results)`. Registering took 39–71 s per page and caching 33–61 s, so the cache is refreshed by a separate step, never inside a run. **Check:** `fda.shortages` returns 1,611 rows and 1,585 distinct NDCs, matching openFDA's own total and our snapshot.

**Postgres as a JDBC data source, by trial.** The getting-started repo marks this path unconfirmed, and the API reference needs a password login, so the syntax came from the parser's own errors: `REGISTER DATASOURCE x` fails (only `REGISTER DATASOURCE TABLES FROM x` exists); `CREATE LIGHTNING DATABASE … OPTIONS (jdbc…)` is accepted but makes the wrong kind of object; `CREATE DATASOURCE` works once the option is `jdbcurl` (not `url`) and `DESCRIBE BY` has no parentheses. Tables are then `northwind_pg.<table>` (a two-part name; `northwind_pg.public.x` is rejected). Zetaris's containers reach the database at `host.docker.internal:5433` with a read-only role. **Guard:** `zetaris/02_hospital.sql`.

**First federated query.** Formulary ⨝ stock (Postgres) ⨝ FDA shortages (REST) in one statement, 2.7 s.

**Data quality surfaced.** The FDA availability field has typos and free text ("Limited Availalbility", "Unvailable", "Limited Supply Available. Next Delivery and Estimated Recovery: June 2027"). Status mapping matches on prefixes, so all three land in the right state.

**Safety catch.** The naive "same drug, marked Available" alternate list mixed 10 mg/mL with 20 mg/mL and premixed lidocaine-in-dextrose drips. "Buy instead" now requires the same single ingredient at the same concentration; different strengths are shown as "needs pharmacist review", combinations are excluded.

---

## 2026-10-25 · openFDA revises records without changing `last_updated`

**Symptom.** The live feed read through Zetaris disagreed with our 23 Oct snapshot on one NDC (clonazepam 0093-3213-01: limited in the file, available live), though both said `last_updated: 2026-10-23`.

**Cause.** openFDA revised that record in place later on 23 Oct (`update_type: Revised`) without bumping the feed date. Our snapshot job skipped any day it had already saved, so it would silently miss same-day revisions. The World Model caught it only because the live Zetaris feed is ingested on top of the snapshots and the diff came out non-empty.

**Path.** The snapshot job compares content, not the date, and saves a same-day revision as `fda-shortages-<date>-<HHMM>z.json.gz`; snapshots replay date-first, original before revision (`-` sorts before `.`, which first put the revision ahead of the original and "undid" it). Separately, 6 NDCs carry two entries with the same status and date; the more severe state now wins, so ordering never decides what a buyer sees. **Guard:** `tests/world-model-shortages.test.ts` (ordering), `npm run replay` shows 14 + 1 changes in order.

---

## 2026-10-26 · A known-vulnerable Next.js, caught by a log line in the Docker build

**Symptom.** The Docker build's `npm ci` printed `npm warn deprecated next@15.3.3: This version has a security vulnerability (CVE-2025-66478)`. We had pinned 15.3.3 on day 4 without checking it.

**Path.** Checked which releases were clean (`npm view next@<v> deprecated`): 15.3.6, 15.4.8 and 15.5.7 were themselves deprecated for the follow-up advisory; 15.3.8 and 15.5.9+ were not. Upgraded to 15.5.28, ran `npm audit fix`, and upgraded the dev tools that had advisories (vitest 5, yaml, pptxgenjs 4). Rebuilt, re-ran the 76 tests, the official runners, and every browser flow (decisions, reload, Forget, a live Nemotron run, `POST /run`).

**Left, on purpose.** `npm audit` still reports `postcss` inside Next's build (fixable only by moving to Next 16, a breaking change) and `image-size` in the PPTX builder script. Both only process our own files at build time; neither is reachable from a network request. **Lesson:** read the install log of a fresh build, not just the exit code.

---

## 2026-10-26 · The daily refresh emptied Zetaris's cache when openFDA was down

**Symptom.** Every Zetaris query failed with `REST API call failed: api.fda.gov ... skip=1000`, and a re-recorded live run spent 3 minutes before the brief.

**Cause.** The 07:15 UTC job re-cached the FDA tables on every run, even though the feed had not changed since 23 Oct. A refresh is `UNCACHE` then `CACHE`; openFDA was returning 500s and its second page takes about 30 s, so `CACHE` failed and left that page uncached. From then on each query fetched openFDA live.

**Fix.** Re-cached the page (1,611 rows, queries back to under 1 s). The daily job now refreshes Zetaris only when it saved a new snapshot, and the refresh retries the re-cache up to five times instead of leaving a page dropped. **Lesson:** a refresh that destroys before it rebuilds should run only when there is something new to rebuild.
