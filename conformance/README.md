# Official Meterless conformance runners and evals

Copied **unmodified** from [github.com/Meterless/Meterless](https://github.com/Meterless/Meterless) (Apache-2.0) at commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`.

| Runner | Upstream path | sha256 |
|---|---|---|
| `world-model/runner.ts` | `engines/world-model/conformance/runner.ts` | `7cd3b80d62d45d16f3342c62a91c89abf819c9b46970187d2f36fb9e3050da82` |
| `hmem/runner.ts` | `engines/hmem/conformance/runner.ts` (fetched from `main` on 2026-10-25) | `d6724860761c4846…` |
| `hmem/vectors/vectors.json` | `engines/hmem/conformance/vectors/vectors.json` | `10afb5a072334665…` |

Scout Intent has no conformance runner; its eval harness is copied unmodified into `evals/scout/`:

| Our copy | Upstream path | sha256 |
|---|---|---|
| `evals/scout/runner/index.ts` | `engines/scout-intent/evals/runner/index.ts` | `e2454b6e308e0458…` |
| `evals/scout/config/thresholds.yaml` | `engines/scout-intent/evals/config/thresholds.yaml` | `f49b4db850298c9a…` |
| `evals/scout/fixtures/intents.json` | `engines/scout-intent/evals/fixtures/intents.json` | `942c4b443807b42e…` |
| `evals/scout/regression-set/v1/injection/adversarial.jsonl` | `engines/scout-intent/evals/regression-set/v1/injection/adversarial.jsonl` | `141f1db3a42ac3e4…` |

Our additions to that harness are new corpus files only: `evals/scout/regression-set/v1/injection/fda-domain.jsonl` and `fda-real-fields.jsonl` (built by `npm run evals:corpus`).

Run against our implementations:

```bash
npm run conformance      # World Model runner + Scout injection evals
```

Check the copy is unmodified:

```bash
curl -s https://raw.githubusercontent.com/Meterless/Meterless/1742dec56a66e58eef9dda2d2b865823758ca8cd/engines/world-model/conformance/runner.ts | shasum -a 256
```
