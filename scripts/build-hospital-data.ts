// Build the synthetic data for "Northwind General" (fictional, 220 beds):
// a formulary of real NDCs and invented stock levels. No patient data.
//   npx tsx scripts/build-hospital-data.ts   → db/hospital/seed.sql, data/fixtures/hospital.json
//
// Preferred NDCs: a product on the FDA shortage list when the hospital's main
// injectables supplier (Hospira, labeler 0409) has one, else a real NDC from the
// openFDA NDC directory. Stock numbers come from a seeded RNG, so reruns match.

import fs from "node:fs";
import path from "node:path";
import { listSnapshots, loadSnapshot, type FdaShortageRecord } from "../src/domain/fda-shortages";

type Line = { generic: string; form: "injection" | "tablet" | "capsule" | "solution"; category: string; critical: boolean };

const FORMULARY: Line[] = [
  ["lidocaine", "injection", "Anesthesia", true], ["bupivacaine", "injection", "Anesthesia", true], ["ropivacaine", "injection", "Anesthesia", false],
  ["propofol", "injection", "Anesthesia", true], ["etomidate", "injection", "Anesthesia", true], ["ketamine", "injection", "Anesthesia", true],
  ["midazolam", "injection", "Anesthesia", true], ["lorazepam", "injection", "Neurology", true], ["dexmedetomidine", "injection", "Anesthesia", true],
  ["rocuronium", "injection", "Anesthesia", true], ["vecuronium", "injection", "Anesthesia", false], ["succinylcholine", "injection", "Anesthesia", true],
  ["cisatracurium", "injection", "Anesthesia", false], ["neostigmine", "injection", "Anesthesia", false], ["glycopyrrolate", "injection", "Anesthesia", false],
  ["atropine", "injection", "Cardiology", true], ["epinephrine", "injection", "Cardiology", true], ["norepinephrine", "injection", "Cardiology", true],
  ["phenylephrine", "injection", "Cardiology", true], ["vasopressin", "injection", "Cardiology", true], ["ephedrine", "injection", "Anesthesia", false],
  ["morphine", "injection", "Analgesia", true], ["hydromorphone", "injection", "Analgesia", true], ["fentanyl", "injection", "Analgesia", true],
  ["sufentanil", "injection", "Analgesia", false], ["remifentanil", "injection", "Analgesia", false], ["ketorolac", "injection", "Analgesia", false],
  ["acetaminophen", "injection", "Analgesia", false], ["naloxone", "injection", "Analgesia", true], ["ondansetron", "injection", "Gastroenterology", false],
  ["dexamethasone", "injection", "Endocrinology", false], ["methylprednisolone", "injection", "Endocrinology", false], ["famotidine", "injection", "Gastroenterology", false],
  ["pantoprazole", "injection", "Gastroenterology", false], ["heparin", "injection", "Hematology", true], ["enoxaparin", "injection", "Hematology", true],
  ["tranexamic acid", "injection", "Hematology", true], ["furosemide", "injection", "Cardiology", true], ["bumetanide", "injection", "Cardiology", false],
  ["potassium chloride", "injection", "Fluids", true], ["sodium bicarbonate", "injection", "Fluids", true], ["sodium acetate", "injection", "Fluids", false],
  ["calcium gluconate", "injection", "Fluids", true], ["calcium chloride", "injection", "Fluids", true], ["magnesium sulfate", "injection", "Fluids", true],
  ["dextrose", "injection", "Fluids", true], ["sodium chloride", "injection", "Fluids", true], ["sterile water", "injection", "Fluids", false],
  ["cefazolin", "injection", "Infectious Disease", true], ["ceftriaxone", "injection", "Infectious Disease", true], ["vancomycin", "injection", "Infectious Disease", true],
  ["piperacillin", "injection", "Infectious Disease", true], ["meropenem", "injection", "Infectious Disease", true], ["ampicillin", "injection", "Infectious Disease", false],
  ["gentamicin", "injection", "Infectious Disease", false], ["metronidazole", "injection", "Infectious Disease", false], ["acyclovir", "injection", "Infectious Disease", false],
  ["amiodarone", "injection", "Cardiology", true], ["adenosine", "injection", "Cardiology", true], ["diltiazem", "injection", "Cardiology", false],
  ["labetalol", "injection", "Cardiology", false], ["metoprolol", "injection", "Cardiology", false], ["esmolol", "injection", "Cardiology", false],
  ["hydralazine", "injection", "Cardiology", false], ["nitroglycerin", "injection", "Cardiology", false], ["dopamine", "injection", "Cardiology", false],
  ["dobutamine", "injection", "Cardiology", false], ["milrinone", "injection", "Cardiology", false], ["haloperidol", "injection", "Psychiatry", false],
  ["diphenhydramine", "injection", "Allergy", false], ["levetiracetam", "injection", "Neurology", true], ["phenytoin", "injection", "Neurology", false],
  ["oxytocin", "injection", "Obstetrics", true], ["methylergonovine", "injection", "Obstetrics", false], ["insulin regular", "injection", "Endocrinology", true],
  ["mannitol", "injection", "Neurology", false], ["flumazenil", "injection", "Anesthesia", false],
  ["metformin", "tablet", "Endocrinology", false], ["atorvastatin", "tablet", "Cardiology", false], ["lisinopril", "tablet", "Cardiology", false],
  ["amoxicillin", "capsule", "Infectious Disease", false], ["azithromycin", "tablet", "Infectious Disease", false], ["methylphenidate", "tablet", "Psychiatry", false],
  ["albuterol", "solution", "Pulmonology", true], ["ipratropium", "solution", "Pulmonology", false],
].map(([generic, form, category, critical]) => ({ generic, form, category, critical }) as Line);

// Seeded RNG (mulberry32) so the synthetic stock is identical on every run.
let seed = 0x5eed2026;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

const snaps = listSnapshots();
const latest = loadSnapshot(snaps[snaps.length - 1]).results;
const first = loadSnapshot(snaps[0]).results;
const changedNdcs = new Set(latest.filter((r) => {
  const before = first.find((x) => x.package_ndc === r.package_ndc && x.status === r.status);
  return !before || before.availability !== r.availability;
}).map((r) => r.package_ndc));

const formMatch = (r: FdaShortageRecord, form: Line["form"]) => (r.dosage_form ?? "").toLowerCase().includes(form === "solution" ? "solution" : form);
// Single-ingredient products only: the entry's generic name must start with the whole formulary name
// ("Sodium Acetate" is not sodium bicarbonate; "Lidocaine And Epinephrine" is not epinephrine).
const mentions = (text: string, generic: string) =>
  new RegExp(`^${generic.replace(/ /g, "\\s+")}\\b`, "i").test(text.trim()) && !/\b(and|with|in)\b|;|\//i.test(text.split(",")[0]);
const used = new Set<string>();

async function ndcDirectory(generic: string, form: Line["form"]): Promise<{ ndc: string; labeler: string; presentation: string } | null> {
  const f = { injection: "INJECTION", tablet: "TABLET", capsule: "CAPSULE", solution: "SOLUTION" }[form];
  // dosage_form varies ("INJECTION", "INJECTION, SOLUTION"), so filter it here rather than in the search.
  const q = `generic_name:"${generic}"+AND+finished:true`;
  const res = await fetch(`https://api.fda.gov/drug/ndc.json?search=${q}&limit=50`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const hit = ((await res.json()) as any).results?.find(
    (r: any) => r.packaging?.length && /ANDA|NDA|BLA/.test(r.marketing_category ?? "") && (r.dosage_form ?? "").startsWith(f) && (r.active_ingredients?.length ?? 0) === 1 && !used.has(r.packaging[0].package_ndc),
  );
  return hit ? { ndc: hit.packaging[0].package_ndc, labeler: hit.labeler_name, presentation: `${hit.generic_name}, ${hit.dosage_form}, ${hit.active_ingredients?.[0]?.strength ?? ""} (${hit.packaging[0].description})` } : null;
}

type Item = Line & { ndc: string; labeler: string; presentation: string; onHand: number; dailyUsage: number; reorderPoint: number; wholesaler: string; source: "fda-shortage-list" | "ndc-directory" };
const items: Item[] = [];

for (const line of FORMULARY) {
  const listed = latest.filter((r) => mentions(r.generic_name, line.generic) && !/\b(and|with)\b/i.test(r.presentation.split(",")[0]) && !r.presentation.includes(";") && formMatch(r, line.form) && r.status !== "To Be Discontinued" && !used.has(r.package_ndc));
  // Prefer the Hospira product that moved overnight, then any Hospira product, then any listed product.
  const pick = listed.find((r) => r.package_ndc.startsWith("0409-") && changedNdcs.has(r.package_ndc))
    ?? listed.find((r) => r.package_ndc.startsWith("0409-"))
    ?? listed[0];
  let row: Pick<Item, "ndc" | "labeler" | "presentation" | "source"> | null = pick
    ? { ndc: pick.package_ndc, labeler: pick.company_name, presentation: pick.presentation, source: "fda-shortage-list" }
    : null;
  if (!row) {
    const d = await ndcDirectory(line.generic, line.form);
    if (d) row = { ...d, source: "ndc-directory" };
    await new Promise((r) => setTimeout(r, 250)); // stay well under openFDA's anonymous limit
  }
  if (!row || used.has(row.ndc)) {
    console.log(`[WARN] no NDC found for ${line.generic} (${line.form}), skipped`);
    continue;
  }
  used.add(row.ndc);
  const dailyUsage = line.critical ? between(8, 60) : between(2, 25);
  // Stock between ~3 and ~30 days; overnight movers sit lower so the demo shows real pressure.
  const days = changedNdcs.has(row.ndc) ? between(3, 9) : between(6, 30);
  items.push({ ...line, ...row, dailyUsage, onHand: dailyUsage * days, reorderPoint: dailyUsage * 7, wholesaler: rand() < 0.7 ? "Cardinal Health" : "McKesson" });
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql = [
  "-- Synthetic data for Northwind General (fictional). Generated by scripts/build-hospital-data.ts. No patient data.",
  "BEGIN;",
  "TRUNCATE inventory, formulary_item;",
  ...items.map((i) => `INSERT INTO formulary_item (ndc, generic_name, form, presentation, labeler, category, critical, ndc_source) VALUES (${q(i.ndc)}, ${q(i.generic)}, ${q(i.form)}, ${q(i.presentation)}, ${q(i.labeler)}, ${q(i.category)}, ${i.critical}, ${q(i.source)});`),
  ...items.map((i) => `INSERT INTO inventory (ndc, on_hand_units, daily_usage_units, reorder_point, wholesaler) VALUES (${q(i.ndc)}, ${i.onHand}, ${i.dailyUsage}, ${i.reorderPoint}, ${q(i.wholesaler)});`),
  "COMMIT;",
].join("\n");

fs.mkdirSync(path.join("db", "hospital"), { recursive: true });
fs.writeFileSync(path.join("db", "hospital", "02_seed.sql"), sql + "\n");
fs.mkdirSync(path.join("data", "fixtures"), { recursive: true });
fs.writeFileSync(path.join("data", "fixtures", "hospital.json"), JSON.stringify(items, null, 1));
const onList = items.filter((i) => i.source === "fda-shortage-list").length;
console.log(`[INFO] ${items.length} formulary lines (${onList} on the FDA shortage list, ${items.filter((i) => changedNdcs.has(i.ndc)).length} changed overnight)`);
