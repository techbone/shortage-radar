// Turn the raw recording (docs/demo/raw/frames + frames.txt + docs/demo/beats.json) into docs/demo/shortage-radar-demo.mp4.
//
//   node scripts/demo/assemble.mjs                           footage + captions, silent
//   node scripts/demo/assemble.mjs --voice me.m4a            one voiceover track, starting at the first frame
//   node scripts/demo/assemble.mjs --voice me.m4a --voice-delay 1.5
//   node scripts/demo/assemble.mjs --voice-dir takes/        one file per beat, named <beat>.m4a|wav|mp3 (see beats.json),
//                                                            each placed at its beat's start
//   node scripts/demo/assemble.mjs --music                   add a quiet synthesized pad under the voice, ducked while you speak
//   node scripts/demo/assemble.mjs --burn-srt                burn the narration subtitles in (use with footage recorded --no-captions)
//
// Always writes docs/demo/shortage-radar-demo.srt (the narration, timed to the beats) for upload as captions.
// ffmpeg: set FFMPEG to its path, or have it on PATH (brew install ffmpeg).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const OUT = path.join(process.cwd(), "docs", "demo");
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name) => argv.includes(name);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const timing = JSON.parse(fs.readFileSync(path.join(OUT, "beats.json"), "utf-8"));
const { beats, duration_seconds: duration } = timing;
const target = path.join(OUT, "shortage-radar-demo.mp4");

// ---- subtitles from the narration: sentences, spread over each beat by length
const stamp = (s) => { const ms = Math.round(s * 1000); const p = (n, w = 2) => String(n).padStart(w, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
const wrap = (t, n = 44) => { const out = []; let line = ""; for (const w of t.split(" ")) { if ((line + " " + w).trim().length > n) { out.push(line); line = w; } else line = (line + " " + w).trim(); } if (line) out.push(line); return out.join("\n"); };
let srt = ""; let k = 1;
for (const b of beats) {
  const sentences = b.narration.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [b.narration];
  const span = Math.max(1, b.end - b.start - 0.4);
  const chars = sentences.reduce((n, s) => n + s.length, 0);
  let t = b.start;
  for (const s of sentences) { const d = (s.length / chars) * span; srt += `${k++}\n${stamp(t)} --> ${stamp(t + d)}\n${wrap(s)}\n\n`; t += d; }
}
const srtPath = path.join(OUT, "shortage-radar-demo.srt");
fs.writeFileSync(srtPath, srt);

// ---- audio inputs
// Frames carry their real timestamps (frames.txt gives each one's duration), so video time equals wall-clock time.
const inputs = ["-f", "concat", "-safe", "0", "-i", path.join(OUT, timing.frames_list)];
const filters = []; const audioLabels = [];
const addVoice = (file, delay, label) => { inputs.push("-i", file); filters.push(`[${(inputs.filter((x) => x === "-i").length) - 1}:a]adelay=${Math.round(delay * 1000)}|${Math.round(delay * 1000)},aresample=44100[${label}]`); audioLabels.push(label); };
const takes = [];
if (opt("--voice")) addVoice(path.resolve(opt("--voice")), Number(opt("--voice-delay") ?? 0), "v0");
if (opt("--voice-dir")) {
  const dir = path.resolve(opt("--voice-dir"));
  for (const b of beats) {
    const file = ["m4a", "wav", "mp3", "aac", "mp4", "ogg"].map((e) => path.join(dir, `${b.id}.${e}`)).find((f) => fs.existsSync(f));
    if (!file) { console.warn(`[WARN] no take for beat "${b.id}" in ${dir}`); continue; }
    addVoice(file, b.start, `v_${b.id}`);
    takes.push({ id: b.id, file });
    const len = Number((spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf-8" }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? []).slice(1).reduce((acc, v, i) => acc + Number(v) * [3600, 60, 1][i], 0));
    if (len && len > b.end - b.start + 0.3) console.warn(`[WARN] your "${b.id}" take is ${len.toFixed(1)} s but the beat is ${(b.end - b.start).toFixed(1)} s: it will run into the next beat. Re-record the video with --beat-min ${b.id}=${Math.ceil(len + 1)}, or shorten the take.`);
  }
}
const voices = audioLabels.length;
let audio = null;
if (voices) {
  const mixed = voices === 1 ? `[${audioLabels[0]}]anull[voice]` : `${audioLabels.map((l) => `[${l}]`).join("")}amix=inputs=${voices}:duration=longest:dropout_transition=0,volume=${voices}[voice]`;
  filters.push(mixed);
  audio = "[voice]";
}
if (has("--music")) {
  // A soft A-minor pad: four detuned sines with a slow swell, low-passed, quiet, ducked under the voice.
  const f = [220, 261.63, 329.63, 493.88];
  const expr = f.map((hz, i) => `0.25*sin(2*PI*${hz}*t+${i})*(0.7+0.3*sin(2*PI*0.08*t+${i}))`).join("+");
  inputs.push("-f", "lavfi", "-t", String(duration), "-i", `aevalsrc=${expr}:s=44100:c=stereo`);
  const mi = inputs.filter((x) => x === "-i").length - 1;
  filters.push(`[${mi}:a]lowpass=f=1400,volume=0.22,afade=t=in:st=0:d=3,afade=t=out:st=${Math.max(0, duration - 4)}:d=4[music]`);
  if (audio) { filters.push(`${audio}asplit=2[vk][vm]`); filters.push(`[music][vk]sidechaincompress=threshold=0.02:ratio=10:attack=30:release=600[duck]`); filters.push(`[duck][vm]amix=inputs=2:duration=longest:normalize=0[mix]`.replace(":normalize=0", "")); audio = "[mix]"; }
  else { filters.push("[music]anull[mix]"); audio = "[mix]"; }
}
if (!audio) { inputs.push("-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"); audio = `${inputs.filter((x) => x === "-i").length - 1}:a`; }
else { filters.push(`${audio}loudnorm=I=-16:TP=-1.5:LRA=11[final]`); audio = "[final]"; }

const vf = [`scale=1920:1080:flags=lanczos`, "fps=30"];
if (has("--burn-srt")) vf.push(`subtitles=${srtPath.replace(/'/g, "\\'")}:force_style='FontName=Helvetica,FontSize=22,PrimaryColour=&H00F5F5F5,OutlineColour=&HCC0C0A09,BorderStyle=3,Outline=0,Shadow=0,MarginV=34'`);
const cmd = ["-y", "-hide_banner", "-loglevel", "error", ...inputs, ...(filters.length ? ["-filter_complex", filters.join(";")] : []), "-map", "0:v", "-vf", vf.join(","), "-map", audio.startsWith("[") ? audio : audio, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", String(duration), target];
// With -filter_complex, -vf on the same input is not allowed; fold the video filter into the graph.
const gi = cmd.indexOf("-vf");
let finalCmd = cmd;
if (filters.length) {
  const vfStr = cmd[gi + 1];
  finalCmd = cmd.filter((_, i) => i !== gi && i !== gi + 1);
  const fcIdx = finalCmd.indexOf("-filter_complex");
  finalCmd[fcIdx + 1] = `[0:v]${vfStr}[vout];${finalCmd[fcIdx + 1]}`;
  const m = finalCmd.indexOf("0:v");
  finalCmd[m] = "[vout]";
}
const run = spawnSync(FFMPEG, finalCmd, { encoding: "utf-8" });
if (run.status !== 0) { console.error(run.stderr || run.error); process.exit(1); }
const probe = spawnSync(FFMPEG, ["-hide_banner", "-i", target], { encoding: "utf-8" });
const dur = (probe.stderr.match(/Duration: ([\d:.]+)/) ?? [])[1];
console.log(`[INFO] ${path.relative(process.cwd(), target)}  duration ${dur}  (${(fs.statSync(target).size / 1e6).toFixed(1)} MB)`);
console.log(`[INFO] subtitles: ${path.relative(process.cwd(), srtPath)}  ·  voice: ${voices ? (takes.length ? `${takes.length} per-beat takes` : "one track") : "none"}${has("--music") ? "  ·  music bed" : ""}`);
