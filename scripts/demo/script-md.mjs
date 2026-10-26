// Write docs/demo/README.md from docs/demo/beats.json: the beat-by-beat script to narrate from,
// with how long each beat runs, plus the exact commands to record, assemble and add a voiceover.
//   node scripts/demo/script-md.mjs

import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "docs", "demo");
const t = JSON.parse(fs.readFileSync(path.join(OUT, "beats.json"), "utf-8"));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const gaps = t.beats.slice(1).map((b, i) => ({ from: t.beats[i], to: b, len: b.start - t.beats[i].end })).filter((g) => g.len > 2);
const gapNote = gaps.length ? "\n**Silent stretches** (the real run was still finishing; the screen shows the live trace and captions, nothing is cut or sped up): " + gaps.map((g) => `${mmss(g.from.end)}–${mmss(g.to.start)} between \`${g.from.id}\` and \`${g.to.id}\` (${Math.round(g.len)} s)`).join("; ") + ". Leave them quiet, or say a line about what is on screen.\n" : "";
const rows = t.beats.map((b) => `| \`${b.id}\` | ${mmss(b.start)}–${mmss(b.end)} | ${Math.round(b.end - b.start)} s | ${b.narration} |`).join("\n");
const md = `# Demo video

The video is a real run of the app, recorded in real time (nothing sped up), ${t.mode === "live" ? "**live** against Zetaris and Nightshift" : "in sample mode"}. Length: **${mmss(t.duration_seconds)}** (the limit is 4:00).

## Narrate over it

Read each beat in your own words while watching the footage. Times are from the recording. The first beat waits on a real model call, so the timing of the middle beats can shift by a few seconds if you record again.

| Beat | Time | Length | Draft narration |
|---|---|---|---|
${rows}
${gapNote}
## Make the video

\`\`\`bash
npm ci && npm run build && npm start        # the app on http://localhost:8000, with Zetaris and Nightshift running
node scripts/demo/record.mjs                # records docs/demo/raw/ and docs/demo/beats.json (about 4 minutes)
node scripts/demo/assemble.mjs              # docs/demo/shortage-radar-demo.mp4, captions burned in, silent
\`\`\`

Needs \`ffmpeg\` (\`brew install ffmpeg\`, or set \`FFMPEG=/path/to/ffmpeg\`) and a local Chrome (\`CHROME_PATH\` to override). Frames are captured straight from Chrome with their real timestamps, so beat times in the table are exact.

## Add your voice

Record on your phone or laptop, then either:

- **One take, start to finish:** \`node scripts/demo/assemble.mjs --voice take.m4a\` (add \`--voice-delay 1.5\` to start later).
- **One file per beat** (easier to get right): save them as \`${t.beats.map((b) => b.id).join(".m4a, ")}.m4a\` in a folder and run \`node scripts/demo/assemble.mjs --voice-dir takes/\`. Each is placed at its beat's start.

Options: \`--music\` adds a quiet synthesized pad under your voice that ducks while you speak (not auditioned: listen before using it); \`--burn-srt\` burns your narration in as subtitles (record with \`--no-captions\` first, so the on-screen caption pill and the subtitles do not stack).
\`docs/demo/shortage-radar-demo.srt\` is written every time: upload it as closed captions.

## Checklist before submitting

- [ ] No key, token or \`.env\` visible anywhere on screen (the run uses the token only in the server)
- [ ] Voice and picture line up at each beat start
- [ ] 1:00 to 4:00 long
- [ ] Uploaded, and the link is in README.md and docs/submission.md
`;
fs.writeFileSync(path.join(OUT, "README.md"), md);
console.log("wrote docs/demo/README.md");
