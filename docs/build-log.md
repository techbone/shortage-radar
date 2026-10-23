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
