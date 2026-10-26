# Scout eval report

_Generated: 2026-10-26T05:31:58.564Z · corpus v1 · 2316 examples_

## Verdict: ❌ FAIL

### Failures

- intent_top1=0.000 below floor 0.85
- intent_top3_recall=0.000 below floor 0.94
- tool_precision=0.000 below floor 0.8

## Metrics

| metric | value |
|---|---|
| intent_top1 | 0.000 |
| intent_top3_recall | 0.000 |
| injection_precision | 1.000 |
| injection_recall | 0.980 |
| tool_precision | 0.000 |
| clarification_rate | 0.000 |
| override_frequency | 0.000 |

## Slices

| slice | intent_top1 | injection_precision | n |
|---|---|---|---|
| surface=chat | — | 1.000 | 10 |
| surface=api | — | 1.000 | 2306 |
| role=ae | — | 1.000 | 2315 |

## Notes

- override_frequency = 0.000 by definition of the corpus, not by measurement: no override data in corpus v1. Overrides are user corrections captured in telemetry ("No, I meant…" + intent switch within the same trace) ÷ contracts issued — measure this in production telemetry (docs/telemetry-and-learning.md).