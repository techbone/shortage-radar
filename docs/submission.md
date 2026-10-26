# Submission (HackOS), ready to paste

**Deadline:** 27 Oct 2026, 23:45 UTC (00:45 Lagos on 28 Oct). **Track:** 02, The Agent That Can Explain Why. **Team:** solo.

## Project name
Shortage Radar

## One-line description
An agent that tells a hospital pharmacy buyer which FDA drug shortage changes hit their shelf, how many days of stock they have, and what to buy instead, with every claim traceable to the query, record or memory behind it.

## Description
Shortage Radar is an agent for a hospital pharmacy buyer: each morning it says which FDA drug-shortage changes hit their shelf, how many days of stock they have left, and which same-strength product to buy instead, with every claim traced to the query, record or memory behind it.

A hospital pharmacy buyer faces a shortage list that moves constantly: 746 of the FDA's 1,609 entries were updated in the week we measured. Shortage Radar joins the hospital's own stock database with the live FDA feed through Zetaris, uses the World Model to know what changed since the last update, and has Nemotron (through Nightshift) plan the brief and write each item. A Critic written in plain code rejects any claim its evidence does not back: a recommended NDC that is not a same-strength swap, a missing citation, a wrong day count, an unsupported cause, a prediction. The buyer's decisions are remembered in H-MEM, so handled items stay out of tomorrow's brief until the FDA status changes. It deliberately does not predict shortages: we tested whether recalls predict them (they do not, 0.7-0.9x baseline over 142 shortages) and dropped the idea. The FDA data and NDCs are real; the hospital is fictional.

## Sponsor technology explanation

**Zetaris (the data layer).** Two sources behind one SQL statement. The openFDA shortage feed is registered as a REST table (`CREATE LIGHTNING REST TABLE`, cached, flattened with `LATERAL VIEW explode`): 1,611 rows, equal to openFDA's own total. The hospital's Postgres is a JDBC data source (`CREATE DATASOURCE ... jdbcurl`; the syntax was found from the parser's error messages and is documented in the build log). The agent sends three single Lightning SQL statements per run to `POST /sql-editor/sqls/run`, about 1.5 s each: the FDA feed, a federated join of formulary, stock and FDA status, and every available same-drug alternate. The adapter refuses stacked statements and anything that writes. Every number in the brief carries a Zetaris query id and its SQL, one click away in the evidence drawer.

**Meterless engines (three, each in a feature you can use, each with a passing test).**
- *World Model* replays every saved FDA snapshot into bitemporal product-status edges with idempotent ingest. It powers "what changed since the last update" and each item's dated status history. Official conformance runner: **8/8**.
- *H-MEM* stores the buyer's decisions with source and confidence, a trust ledger, and supersede-never-delete. It powers the decision buttons, the Handled list, and items returning when the FDA status moves. Official conformance runner: **13/13**.
- *Scout Intent* (guard stage) screens every FDA note and database row for prompt injection before any model reads it, withholding only the poisoned field and redacting credentials. Official eval runner plus our FDA corpus: injection precision **1.000**, recall **0.980** on 2,316 cases, 0 of 2,242 real FDA text fields blocked. Honest caveat: on 6 attacks written after the rules it caught 0; 5 were then patched, Polish still gets through.
The three official runners are included unmodified (checksums in `conformance/README.md`); outputs are in `docs/evidence/`. All 76 repository tests pass.

**Meterless Nightshift (the only AI provider).** The app talks to the Nightshift Runtime in OpenAI format (`POST /v1/chat/completions`), with the Runtime token as a bearer, `meterless-app: shortage-radar` and `meterless-scope: user` on every request, model discovery from `GET /v1/models`, and a clear difference between "unauthorized" and "offline" (`src/adapters/meterless.ts`; `npm run nightshift:check` runs the contract's acceptance checks). The NVIDIA key lives only in Nightshift's Providers tab, never in the repo, `.env`, logs or traces.

**NVIDIA Nemotron.** `nvidia/nemotron-3.5-lightning-30b-a3b`, through Nightshift, does the planning and writes every brief item; each trace line names the model that answered, and the API response lists it in `models`. We use Nemotron's reasoning switch as a design lever: thinking on for the planner (choosing what matters is the judgement call; about 39-56 s of a 59-74 s run), off for the item writer (2-6 s per item instead of about 4 s and 400 tokens for a one-line answer), because the code Critic checks every claim either way. The first live request failed with an empty reply because an 80-token cap was spent on thinking; the fix and the measurements are in `docs/build-log.md`.

**What is unique.** The three engines carry the whole loop (what changed, what was decided, what is safe to read) instead of one being bolted on, and the checker is code that recomputes the NDC, citations and day counts, so a second model cannot talk it into agreeing.

## Pre-existing components to declare
- Open-source libraries only (Next.js, React, Lucide, Vitest, Playwright core for the recording scripts).
- The Meterless engines are implemented from the Apache-2.0 specs in github.com/Meterless/Meterless; its official conformance and eval runners are included unmodified.
- No product code predates the build window (22 Oct 2026). First commit 23 Oct 2026. FDA snapshots were captured inside the window. The hospital data is synthetic and generated by `scripts/build-hospital-data.ts`.

## Links
- Repo (public): https://github.com/techbone/shortage-radar
- Demo video: https://youtu.be/xAKDnQNLiOQ
- Proof clip (68 s: the official World Model and H-MEM runners, the Scout evals, a live Zetaris federated query and `npm test`, run live): _add after upload_
- Slide deck: `docs/deck/Shortage-Radar-deck.pdf` (also `.pptx` with speaker notes) in the repo
- Live app: runs locally in Sample mode with `docker build -t oah-submission . && docker run --rm -p 8000:8000 oah-submission`

## Checklist
- [x] Repo public, README with setup, usage, dependencies, sponsor use
- [x] Three input examples with live outputs and traces (`input_examples/`, `output_examples/`, `logs/`)
- [x] Zetaris is the data layer; three Meterless engines with passing official tests; Nightshift is the only AI provider; Nemotron named on every call
- [x] Docker image builds and runs with no keys (Sample mode); live-to-sample fallback
- [x] No secrets committed (scanned); NVIDIA key only in Nightshift
- [x] Slide deck (12 slides, covers all eight required points)
- [x] Demo video recorded, 1-4 minutes, uploaded, link added above and in README
- [ ] Roster confirmed before the first submission is created
- [ ] Submitted on HackOS before 27 Oct 23:45 UTC
