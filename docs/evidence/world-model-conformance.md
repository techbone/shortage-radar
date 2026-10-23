# World Model conformance, 2026-10-23T09:39Z

Command: `npm run conformance:wm` (official runner, unmodified, see conformance/README.md)

```

World Model conformance: implementation = src/engines/world-model/index.ts

  PASS sid-001 stable ids: diacritics and NBSP normalize identically (NFKD + strip marks)
  PASS sid-002 stable ids: distinct names stay distinct (no over-normalization)
  PASS band-001 merge bands at the boundaries: 0.85 auto, 0.84 review, 0.82 review, 0.81 new
  PASS prov-001 writes without provenance are rejected
  PASS idem-001 ingest idempotency: same batch twice produces an empty diff
  PASS idem-002 the idempotency check can fail: a mutated batch changes the shape
  PASS bitemp-001 bitemporal edges: a superseding edge closes the old one; point-in-time queries respect validity
  PASS audit-001 every mutation writes an audit entry in order

  8/8 checks passed
```

## Domain tests

```
 ✓ tests/world-model-shortages.test.ts (5 tests) 296ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```
