# Codex changelog: changes and repairs

Running list, newest first. "Change" = code merged to `main`. "Repair" = something fixed on a live run
(button pressed, setting changed) that did not need new code. Add an entry whenever either happens.

## 2026-10-25

### Repair: two atomic sets failed validation (run `run_20261024183742_glsbi`)
- **Symptom:** "2 task(s) failed", both stage `atomic`: `MS-1-SS-4-26.2` (monohybrid genotypic and phenotypic
  ratios) and `MS-1-SS-4-29.3` (conditional probability in inheritance). Validation still failing after 2 repair
  rounds: "Two options have the same text" and "Distractor rationales must differ from each other".
- **Cause:** the model repeated an option or rationale. Both topics have numeric or ratio answers, where this is
  common. The check is working as intended. Nothing is wrong with the run.
- **Action:** press **Retry failed** (resets the task and reruns it). If a topic fails twice more, it is a prompt
  problem: tighten the atomic prompt on duplicate options, do not loosen the check.
- **Status:** open until retried.

## 2026-10-24

### Change: Codex "expand" stage (PR #195)
- A new stage, **Topic splits**, runs between planning and parent questions. For each planned topic the AI lists
  the separately testable ideas it contains, with no fixed count. A topic with several becomes finer topics
  (`MS-1-SS-1-1.1`, `.2`, ...), each with one parent question. The broad topic is hidden.
- **Why:** one parent per topic gave too little coverage for broad topics.
- **Effect:** MS-1 went from 53 planned topics to 122.

### Change: planner decomposes broad headings (PR #194)
- Planning prompt: a heading naming a field or family of ideas is not a topic and must be broken into separately
  testable ideas. No numeric target or cap.
- **Why:** the first MS-1 plan listed five broad headings under one subsection.

### Change: phase-by-phase ordering and exhaustive planning (PR #193)
- Tasks now run plan, expand, parent, atomic, verify. Each phase finishes for the whole run before the next
  begins. Previously the latest stage was favoured, so stages interleaved.
- Planning prompts say a major section is a whole body of material, with no cap on topic count.

### Change: sign-in falls back to Firestore (PR #193)
- If Postgres is up but has no record of the PIN, sign-in now checks the Firestore copy and restores the
  Postgres rows. Previously it rejected the PIN outright.
- **Why:** a valid PIN stopped working. The cause on the live database was not confirmed.

### Change: `scripts/set-pin.ts` (PR #193)
- `npx tsx scripts/set-pin.ts <email> <pin>` sets a PIN in Postgres and Firestore. Run it where the database
  credentials are available.

## Decisions and known gaps (not built yet)

- **Volume:** the full Biology run (16 sections) would produce roughly 1,000 to 2,000 parent questions at MS-1's
  rate, against a target of 250 to 300 total. Proposed: a Standard/Thorough setting and projected counts before
  generating.
- **Coverage:** proposed AAMC checklist per section with a mechanical check that every subtopic has a topic.
- **Gap ledger:** planner "declared gaps" are display-only. Proposed: log them, route each to the section that
  owns it, and check them off when that section covers them.
- **Final bank:** proposed separate Firestore collection for published questions, with a section completion
  checklist. A saved export today is a Storage JSON file and survives run deletion, but Study reads from the run.
- **Pause button:** works, but only after the in-flight step finishes (can be minutes). Proposed: show
  "Pausing..." immediately.
- **Overlapping topics in MS-1:** `SS-3-17.2` and `SS-5-33.3` (hemizygosity), `SS-3-18.2` and `SS-4-26.2`
  (monohybrid ratios), `SS-2-11.3` and `SS-3-15` (alleles and loci).
- **Likely missing in MS-1:** gene therapy, expressing cloned genes, safety and ethics of DNA technology, RNA
  structure, Punnett squares, non-autosomal pedigrees.
