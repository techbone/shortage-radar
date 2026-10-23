# AGENTS.md — rules for anyone (human or agent) working in this repo

Read `ARCHITECTURE.md` first. This file holds the rules that are easy to get wrong.

## Product rules

- Never claim the agent predicts shortages. It reports exposure, runway and alternatives. See `docs/build-log.md` for why.
- Every factual claim in a brief must cite a Zetaris query row, a World Model record or an H-MEM memory. The critic rejects uncited claims.
- The hospital is fictional and all hospital data is synthetic. No patient data, ever.

## Sponsor stack rules

**Zetaris**
- Talk to it over REST: `POST {ZETARIS_REST_URL}/sql-editor/sqls/run`. Headers: `Authorization: Bearer <key>`, `X-Org-ID` (1 locally), `X-Request-ID` (fresh UUID per request). Full reference at `http://localhost:8888/redoc/index.html`.
- Lightning SQL, one statement per call. Never port 8889.
- Never print, log or commit the API key. Create keys in the Zetaris UI only.
- Zetaris runs in its own containers: a source it reads must be reachable from *those* containers, not just from the laptop.

**Meterless Nightshift**
- OpenAI-compatible at `METERLESS_BASE_URL` (default `http://127.0.0.1:8088/v1`). Send `Authorization: Bearer <runtime token>`, `meterless-app: shortage-radar`, `meterless-scope: user`.
- Model ids are routing modes (`meterless/auto`, `meterless/<class>.<disposition>`); read them from `GET /v1/models`. Log the model the response reports for every request.
- The NVIDIA key lives in Nightshift's Providers tab, never in this repo or `.env`.
- 180 s ceiling per request; our default is 90 s.

**Meterless engines**
- `src/engines/world-model` and `src/engines/hmem` are our implementations of the specs in github.com/Meterless/Meterless. They must keep passing the official conformance runners (`npm run conformance`). Do not change a check to make it pass.
- Every World Model write carries provenance (snapshot id or Zetaris query id).

## Runtime rules (judging)

- Secrets only from env vars. `.env` is gitignored; `.env.example` has placeholders only.
- `SAMPLE_MODE=true` must run the full flow offline from `data/fixtures/`.
- Bounded everything: Zetaris 60 s, model 90 s, run 5 min, critic loops ≤ 2.
- Log to stdout and `logs/trace-<run_id>.jsonl` (one JSON object per line, fields from the hackathon guide). Mask secrets.
- No installs or downloads in the request path.

## Code style

- TypeScript, ESM, Node 22. Small modules, named exports, no default exports outside Next.js pages.
- Comments only where the why isn't obvious.
- Tests with Vitest in `tests/`.

## Design rules (UI)

Goal: a calm, dense clinical tool that looks like it came from a good product team. Reference feel: Linear, Stripe dashboard, Vercel.

- **Type:** headings in Instrument Sans (600, tracking −0.02em on large sizes); body in Inter; NDCs, quantities, dates, SQL and ids in IBM Plex Mono with tabular figures.
- **Scale:** 12 / 13 / 14 / 16 / 20 / 28 px. Body 14 px.
- **Color tokens** (CSS variables on `:root`, dark theme redefined, not inverted):
  - neutrals: `--bg #FAFAF9`, `--surface #FFFFFF`, `--border #E7E5E4`, `--text #1C1917`, `--muted #78716C`
  - accent (one): `--accent #0F766E` (deep teal) for primary actions and focus
  - status only: `--unavailable #B42318`, `--limited #B54708`, `--available #3F6212`, each with a 8% tint background
  - dark: `--bg #0C0A09`, `--surface #1C1917`, `--border #292524`, `--text #F5F5F4`, `--muted #A8A29E`, `--accent #2DD4BF`
- **Shape:** radius 6 px (controls), 10 px (cards). Borders over shadows; one soft shadow for overlays only.
- **Spacing:** 4 px base; 8 / 12 / 16 / 24 / 32 / 48.
- **Icons:** Lucide, 16 px, stroke 1.75, muted color.
- **Patterns:** tables for lists of drugs; a right-side drawer for evidence; named steps instead of a single spinner (Ingest → Diff → Match → Alternatives → Brief → Critique); explicit empty, loading and error states.
- **Avoid:** gradients, glow, glassmorphism, emoji, sparkle icons, "AI-powered" badges, the centered hero with three feature cards, filler copy ("seamless", "unlock", "revolutionize").
- Copy is plain and written for a pharmacy buyer: "Days on hand", "Buy instead", "Why".

## Git

- Personal identity is set locally in this repo; never touch global git config.
- One-line lowercase conventional commits (`feat: add world model ingest`). No body unless needed. No `Co-Authored-By` or "Generated with" lines.
