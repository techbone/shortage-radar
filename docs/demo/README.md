# Demo video

The video is a real run of the app, recorded in real time (nothing sped up), **live** against Zetaris and Nightshift. Length: **3:35** (the limit is 4:00).

## Narrate over it

Read each beat in your own words while watching the footage. Times are from the recording. The first beat waits on a real model call, so the timing of the middle beats can shift by a few seconds if you record again.

| Beat | Time | Length | Draft narration |
|---|---|---|---|
| `hook` | 0:00–0:11 | 11 s | Seven hundred and forty six drug shortage entries on the FDA list were updated in a single week. Which of them are on your hospital's shelf? |
| `problem` | 0:11–0:22 | 11 s | That is the daily job of a hospital pharmacy buyer. This is Shortage Radar, running right now, in real time, against the real FDA data. |
| `steps` | 0:22–0:42 | 20 s | Before any model is involved, it has already read the FDA feed through Zetaris, replayed every saved snapshot in the World Model so it knows what changed, joined the hospital's stock with the FDA list in one query, and screened every third party field with the Scout guard. |
| `thinking` | 0:42–1:10 | 28 s | Now Nemotron, through Nightshift, is choosing what to cover. This is the slow step, because it is the one place the model is allowed to think: choosing what matters is the judgement call. After that it writes one item at a time with thinking off, and a checker written in plain code verifies every claim, so a slow model cannot talk its way past it. |
| `engines` | 1:10–1:42 | 32 s | While that finishes, here is what is under the hood. Three Meterless engines do real work, and each passes its official test: World Model, eight of eight. H-MEM, thirteen of thirteen. Scout Intent, injection precision one point zero, recall point nine eight. The limits are on the page too: the hospital is fictional, Scout is pattern based, and the agent never predicts a shortage, because when we tested whether recalls predict them, the data said no. |
| `result` | 1:55–2:08 | 13 s | Six items need action today. Etomidate went from available to unavailable, with six days of stock left, and it names exactly what to buy instead: the same strength, from another manufacturer. |
| `why` | 2:08–2:25 | 17 s | Every line has a receipt. The drawer shows the swap options, and below that the evidence behind each sentence: the stock, the FDA status history from the World Model, and the Zetaris query with its SQL, one click away. |
| `review` | 2:25–2:41 | 16 s | A swap has to be the same strength. A different concentration is a medication error, so on Morphine the other products are not offered as swaps. They go to a pharmacist for review, each with its reason. |
| `decision` | 2:41–2:54 | 13 s | When the buyer decides, H-MEM remembers. I record that I bought the alternate, and Etomidate moves to Handled. It stays out of tomorrow's brief until the FDA status changes again. |
| `trace` | 2:54–3:09 | 15 s | Everything is logged. Each line names the agent, the Zetaris query, and the model that answered: Nemotron three point five Lightning, through Nightshift. The planner thinks, the writer doesn't, and the critic is code. |
| `sample` | 3:09–3:22 | 13 s | And anyone can run it with no keys at all. Sample mode replays a recorded live run, labelled as a replay, so a judge sees exactly what the live system produced. |
| `close` | 3:22–3:32 | 10 s | Real data, real queries, real receipts. Shortage Radar doesn't guess what will run short. It tells you what to do about what just did. |

**Silent stretches** (the real run was still finishing; the screen shows the live trace and captions, nothing is cut or sped up): 1:42–1:55 between `engines` and `result` (13 s). Leave them quiet, or say a line about what is on screen.

## Make the video

```bash
npm ci && npm run build && npm start        # the app on http://localhost:8000, with Zetaris and Nightshift running
node scripts/demo/record.mjs                # records docs/demo/raw/ and docs/demo/beats.json (about 4 minutes)
node scripts/demo/assemble.mjs              # docs/demo/shortage-radar-demo.mp4, captions burned in, silent
```

Needs `ffmpeg` (`brew install ffmpeg`, or set `FFMPEG=/path/to/ffmpeg`) and a local Chrome (`CHROME_PATH` to override). Frames are captured straight from Chrome with their real timestamps, so beat times in the table are exact.

## Add your voice

Record on your phone or laptop, then either:

- **One take, start to finish:** `node scripts/demo/assemble.mjs --voice take.m4a` (add `--voice-delay 1.5` to start later).
- **One file per beat** (easier to get right): save them as `hook.m4a, problem.m4a, steps.m4a, thinking.m4a, engines.m4a, result.m4a, why.m4a, review.m4a, decision.m4a, trace.m4a, sample.m4a, close.m4a` in a folder and run `node scripts/demo/assemble.mjs --voice-dir takes/`. Each is placed at its beat's start.

Options: `--music` adds a quiet synthesized pad under your voice that ducks while you speak (not auditioned: listen before using it); `--burn-srt` burns your narration in as subtitles (record with `--no-captions` first, so the on-screen caption pill and the subtitles do not stack).
`docs/demo/shortage-radar-demo.srt` is written every time: upload it as closed captions.

## Checklist before submitting

- [ ] No key, token or `.env` visible anywhere on screen (the run uses the token only in the server)
- [ ] Voice and picture line up at each beat start
- [ ] 1:00 to 4:00 long
- [ ] Uploaded, and the link is in README.md and docs/submission.md
