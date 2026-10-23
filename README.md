# Shortage Radar

### 750 shortage updates a week. Three of them hit your shelf. Here is what to buy instead, and why.

An agent for hospital pharmacy buyers. Every morning it checks the FDA drug shortage list against the hospital's own formulary and stock, works out how many days each affected drug has left, finds an NDC from another manufacturer to buy instead, and writes a short brief where every claim links to the query that backs it. It remembers what the buyer already decided, so it gets quieter over time.

Built for the Open Agent Hackathon 2026, Track 02 · *The Agent That Can Explain Why*, on Zetaris, Meterless (World Model, H-MEM, Nightshift) and NVIDIA Nemotron.

**Watch the demo** (_soon_) · **Verify it yourself** (below) · [**Architecture**](ARCHITECTURE.md) · **Run it locally** (below)

> Status: in active development (build window 22–27 Oct 2026). Sections marked _TBD_ fill in as milestones land.

## Verify it yourself

_TBD at M1: conformance commands with expected output, `npm run e2e`, sample-mode run._

## The problem

The buyer at a community hospital pharmacy checks the FDA and ASHP shortage pages, reads wholesaler allocation emails, and keeps a spreadsheet. The FDA list is the source of truth and it moves fast: **746 of its 1,609 entries changed in the week to 22 Oct 2026** (snapshot in `data/snapshots/`). Each entry is one package NDC from one company. Working out which changes touch your shelf, and what to buy instead, is manual.

## What we tested and dropped

We first wanted to predict shortages from recalls. The data said no: a recent recall of the same drug was *less* common before a shortage than for drugs that never ran short (0.7–0.9×, 142 shortages, 2025–26). So Shortage Radar does not predict. Details and the script: [`docs/build-log.md`](docs/build-log.md), [`research/recall_backtest.py`](research/recall_backtest.py).

## What it does

_TBD: capability table (capability · what the buyer does · sponsor calls behind it). Draft in [ARCHITECTURE.md §3](ARCHITECTURE.md#3-capability-map)._

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

## Run it locally

_TBD at M1–M4._ Prerequisites: Node 22, Docker, Zetaris running locally, Meterless Nightshift running locally. Copy `.env.example` to `.env` and fill in the Zetaris and Nightshift values.

## Data sources

| Source | What we use | Licence |
|---|---|---|
| [openFDA drug shortages](https://open.fda.gov/apis/drug/drugshortages/) | Status per package NDC | Public domain (CC0), [openFDA terms](https://open.fda.gov/terms/) |
| [openFDA NDC directory](https://open.fda.gov/apis/drug/ndc/) | Alternate NDCs by ingredient, form, strength | Public domain (CC0) |
| [openFDA drug enforcement](https://open.fda.gov/apis/drug/enforcement/) | Recall history (research only) | Public domain (CC0) |
| [NLM RxNorm](https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html) | Normalizing drug identity | Free, NLM terms |
| [CMS NADAC](https://data.medicaid.gov/) | Acquisition price where listed | Public domain |
| Hospital formulary and stock | Fictional 220-bed hospital | Synthetic, created for this project |

openFDA's disclaimer applies: do not rely on this data alone for medical care decisions.

## Disclosure

Open Agent Hackathon 2026, Track 02. First commit 23 Oct 2026. Our Meterless engine implementations follow the Apache-2.0 specs and reference code at [github.com/Meterless/Meterless](https://github.com/Meterless/Meterless).
