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
