# Codex changelog: changes and repairs

Running list, newest first. "Change" = code merged to `main`. "Repair" = something fixed on a live run
(button pressed, setting changed) that did not need new code. Add an entry whenever either happens.

## 2026-10-25

### Change: reading lessons ("Topics only + content") 
- **New run type:** *Topics only + content (reading lessons, no questions)*. It plans, splits, then writes one
  reading lesson per split topic. No questions are generated.
- **Optional on every other run type:** the **Topic splits** card shows a **Develop content** button once splits
  exist. Pressing it switches lessons on for that run (even one already in progress) and queues a lesson for every
  topic whose split has finished. Topics split later are added automatically. Without the button, lessons are never
  written on the other run types. Press Run to develop them.
- **Lesson shape:** objectives, titled sections of explanatory prose, key terms, common misconceptions, summary,
  references and basis. Checks require at least two sections and 250 words and reject quiz-style wording. CARS
  topics get a skill-teaching variant.
- **Review:** each topic shows its lesson above its questions, with Approve and Reject; "Approve all lessons" is
  in the run's action panel. Lessons are stored in the new `codex_content` collection and included in exports.
- **Task order:** lessons run right after splits, ahead of parent questions, so pressing Develop content on a run
  mid-way makes lessons the next thing it does.
- **Not included:** AI verification of lessons, and saving lessons to the Codex database (the database holds
  questions only for now).
- **Untested:** written without installed dependencies, so no type-check or run.

### Change: Codex database ("Save to database") and run locking
- A finished run gets a **Save to database** button. It copies the run's approved questions into a new Firestore
  collection, `codex_bank`, one document per question with its section, subsection and topic attached. It then
  locks the run.
- **Enabled only when:** the run was built through AI verification, every selected section is planned, no task is
  active or failed, and no question is waiting for a decision (draft, awaiting you, or flagged). The page lists
  whatever is blocking it. Atomic questions whose parent is not approved are not copied.
- **Locked run:** Run, approve/reject, Approve all, and Retry failed are disabled, and the server refuses them. The
  run cannot be deleted from the runs list.
- **New-run list:** sections of a saved run no longer appear as choices for that subject.
- **Remove from database** (on the run page): deletes that run's documents from `codex_bank`, unlocks the run and
  brings its sections back.
- **Not changed:** Study still reads from the run, not the database. A saved export in Storage is separate.
- **Untested:** written without installed dependencies, so no type-check or run. Try it on one small run first.

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
- **Database follow-ups:** Study reads from runs, not the database. No section completion checklist yet (the new-run
  list hides saved sections, but there is no page showing all 16 as done or not).
- **Pause button:** works, but only after the in-flight step finishes (can be minutes). Proposed: show
  "Pausing..." immediately.
- **Overlapping topics in MS-1:** `SS-3-17.2` and `SS-5-33.3` (hemizygosity), `SS-3-18.2` and `SS-4-26.2`
  (monohybrid ratios), `SS-2-11.3` and `SS-3-15` (alleles and loci).
- **Likely missing in MS-1:** gene therapy, expressing cloned genes, safety and ethics of DNA technology, RNA
  structure, Punnett squares, non-autosomal pedigrees.
