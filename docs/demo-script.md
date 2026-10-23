# Demo script (target 2:45, hard limit 4:00)

Shot list. Record real runs only. If anything is sped up, say so on screen. No keys, tokens or `.env` on screen.

| Time | Screen | Narration | Must be true before recording |
|---|---|---|---|
| 0:00–0:15 | Morning brief: "3 changes hit your shelf" | "746 entries on the FDA shortage list changed last week. This hospital stocks 400 drugs. Three of those changes matter today." | A real diff between two FDA snapshots that touches the demo formulary |
| 0:15–0:35 | Problem: FDA list page vs the spreadsheet | Who the buyer is, what they do today, what it costs | Cost numbers verified with sources |
| 0:35–1:20 | Run the sweep live: named steps tick through (Ingest → Diff → Match → Alternatives → Brief → Critique) | What each step does, which sponsor runs it | Zetaris and Nightshift running; run completes under 60 s |
| 1:20–1:50 | Open "Why" on the top item: SQL, rows, status history | "Every sentence links to the query that backs it. This one joined our formulary in Postgres with the FDA list and the NDC directory through Zetaris." | Evidence drawer shows real query ids |
| 1:50–2:15 | Click "Bought 14 days of alternate". Run again: item shows as handled | "It remembers what you decided. H-MEM. Tomorrow it stays quiet unless the status changes." | H-MEM decision persists across runs |
| 2:15–2:35 | Trace file: agents, Zetaris queries, World Model diff, Nemotron model per request | "Each request names the Nemotron model that handled it." | Trace shows `nvidia/nemotron-*` |
| 2:35–2:45 | Closing line + repo link | "Shortage Radar doesn't guess what will run short. It tells you what to do about what just did." | |
