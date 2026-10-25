# Nightshift + Nemotron live check, 2026-10-25T18:31Z

Command: `npm run nightshift:check` (token shown masked by the script)

```
[INFO] base URL http://127.0.0.1:8088/v1 · token e63…redacted · model meterless/auto
[CHECK 1] wrong token → unauthorized PASS
[CHECK 2] auto detect → http://127.0.0.1:8088/v1 (online) PASS
          routing modes: meterless/auto, meterless/fast, meterless/deep, meterless/cheap, meterless/local, meterless/fusion
[CHECK 3] meterless/auto → PASS (5206 ms, model: nvidia/nemotron-3.5-lightning-30b-a3b)
          "A drug shortage occurs when the available supply of a medication is insufficient to meet patient or clinical demand."
```
