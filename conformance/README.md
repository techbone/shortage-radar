# Official Meterless conformance runners

Copied **unmodified** from [github.com/Meterless/Meterless](https://github.com/Meterless/Meterless) (Apache-2.0) at commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`.

| Runner | Upstream path | sha256 |
|---|---|---|
| `world-model/runner.ts` | `engines/world-model/conformance/runner.ts` | `7cd3b80d62d45d16f3342c62a91c89abf819c9b46970187d2f36fb9e3050da82` |

Run against our implementations:

```bash
npm run conformance
```

Check the copy is unmodified:

```bash
curl -s https://raw.githubusercontent.com/Meterless/Meterless/1742dec56a66e58eef9dda2d2b865823758ca8cd/engines/world-model/conformance/runner.ts | shasum -a 256
```
