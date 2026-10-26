// Lay per-beat voice takes (docs/demo/takes/<beat>.m4a) over the finished silent video. Where a take is longer
// than its beat, that beat's frame is held (a pause; nothing is cut or sped up). Writes the voiced mp4 and its timing.
//   FFMPEG=/path/to/ffmpeg node scripts/demo/voiced.mjs <silent.mp4> <beats.json> <takesDir> <out.mp4> <out-beats.json>
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const [src, beatsPath, takesDir, out, outBeats] = process.argv.slice(2);
const FF = process.env.FFMPEG;
const MARGIN = 0.4;
// Where to freeze instead of the beat's last frame (seconds in the source), e.g. before a card fades out.
const HOLD_AT = { hook: 9.0 };
const t = JSON.parse(fs.readFileSync(beatsPath, "utf-8"));
const beats = t.beats;
const total = t.duration_seconds;
const len = (f) => { const m = spawnSync(FF, ["-hide_banner", "-i", f], { encoding: "utf-8" }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/); return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); };

// Segment i runs from beat i's start to beat i+1's start (the first from 0, the last to the end).
const segs = beats.map((b, i) => {
  const from = i === 0 ? 0 : b.start;
  const to = i + 1 < beats.length ? beats[i + 1].start : total;
  const take = `${takesDir}/${b.id}.m4a`;
  const d = len(take);
  const at = HOLD_AT[b.id];
  const hold = Math.max(0, Math.round((b.start + d + MARGIN - (at ?? to)) * 100) / 100);
  return { b, from, to, take, d, hold, at };
});

let shift = 0;
const newBeats = segs.map((s) => { const nb = { ...s.b, start: +(s.b.start + shift).toFixed(2), end: +(s.b.end + shift + s.hold).toFixed(2), take_seconds: +s.d.toFixed(2), held_seconds: s.hold }; shift += s.hold; return nb; });
const newTotal = +(total + shift).toFixed(2);

const f = [];
const parts = [];
segs.forEach((s, i) => {
  const pad = s.hold ? `,tpad=stop_mode=clone:stop_duration=${s.hold}` : "";
  f.push(`[0:v]trim=start=${s.from}:end=${s.at ?? s.to},setpts=PTS-STARTPTS${pad}[s${i}a]`); parts.push(`[s${i}a]`);
  if (s.at) { f.push(`[0:v]trim=start=${s.at}:end=${s.to},setpts=PTS-STARTPTS[s${i}b]`); parts.push(`[s${i}b]`); }
});
f.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[v]`);
const inputs = ["-i", src];
segs.forEach((s, i) => {
  inputs.push("-i", s.take);
  const ms = Math.round(newBeats[i].start * 1000);
  f.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=mono,highpass=f=80,afftdn=nf=-50,adelay=${ms}[a${i}]`);
});
f.push(`${segs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${segs.length}:duration=longest:dropout_transition=0,volume=${segs.length},apad,atrim=end=${newTotal},loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[a]`);

const run = spawnSync(FF, ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", f.join(";"), "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", String(newTotal), out], { encoding: "utf-8" });
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }
fs.writeFileSync(outBeats, JSON.stringify({ ...t, duration_seconds: newTotal, voiced_from: "per-beat takes, frames held where a take is longer than its beat", beats: newBeats }, null, 2) + "\n");
for (const s of segs) console.log(`${s.b.id.padEnd(9)} take ${s.d.toFixed(1).padStart(5)}s  room ${(s.to - s.b.start).toFixed(1).padStart(5)}s  hold ${s.hold.toFixed(1)}s${s.at ? ` at ${s.at}s` : ""}`);
console.log(`total ${Math.floor(newTotal / 60)}:${String(Math.round(newTotal % 60)).padStart(2, "0")} (${newTotal}s)`);
