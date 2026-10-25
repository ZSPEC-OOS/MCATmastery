# Codex changelog: changes and repairs

Running list, newest first. "Change" = code merged to `main`. "Repair" = something fixed on a live run
(button pressed, setting changed) that did not need new code. Add an entry whenever either happens.

## 2026-10-25

### Change: Lessons are one per subsection, with every split topic as a part
- **Unit of a lesson:** a subsection (MS-1-SS-2), titled "MS-1-SS-2 · <subsection title>". Its split topics are the
  lesson's organized parts, in curriculum order. MS-1 gives 7 lessons instead of 122 separate ones.
- **How it is written:** one AI call per part (so a long subsection never hits the output limit), each told its place
  ("part 3 of 16") and the lesson it belongs to. The lesson is assembled from its parts when read; the subsection's
  planned scope is its introduction and the parts form its contents list. Parts are stored one document each
  (`lessons_parts`), so parallel workers cannot overwrite each other.
- **Review is per lesson:** Approve or Reject the whole lesson once every part is written (`lessons_reviews`).
  Rewriting any part returns that lesson to awaiting review.
- **Choose lessons** now picks subsections; every part of a chosen lesson is written again. Run page, Read page and
  the export (schema 2.0.0) are organized by lesson with parts inside.
- **Database page:** lessons are counted as subsections approved out of subsections saved (for example 3/7).
- **Earlier trial lessons:** per-topic lessons written before this change (`lessons_items`) are no longer read.
- **Not built:** an AI-written overview and wrap-up per lesson; for now the subsection scope is the introduction.
- **Untested:** written without installed dependencies, so no type-check or run.

### Change: Database checklist and select-all for the first Topics-only run
- **Database page** (Codex navbar, also linked from Lessons): pick a subject and see every major section with three
  checks: topics saved to the topic database, questions saved to the question database, lessons approved out of
  topics. A section is **Complete** when all three are met. Read-only.
- **First Topics-only run:** the new-run picker defaults to every section not yet saved (all 16 for Biology) and now
  has Select all / Clear and an "N of M selected" count.
- **Trial run left alone:** the earlier Biology run (MS-1, built through parents and atomics) is a trial. It is not
  migrated into the topic database and nothing here modifies it, so MS-1 still shows as "topics not saved" and can be
  planned again in the first Topics-only run.
- **Untested:** written without installed dependencies, so no type-check or run.

### Change: shared topic database; Codex and Lessons now build from it
- **Save topics to database (Codex, Topics-only runs):** when a Topics-only run has finished planning and every
  split (no active or failed tasks), **Save topics to database** writes each selected major section and its split
  topics to a new shared collection pair, `topicbank_sections` and `topicbank_topics`, keyed by subject. The save
  is **permanent**: a saved section is never overwritten, there is no remove button, and the app has no code that
  deletes it. The run is locked and shows a banner. (Fixing a mistake would need a manual edit in Firestore.)
- **Codex run rules now follow the database:**
  - *Topics only* is offered only for sections **not** yet saved, so a saved section can never be planned or split
    again. The new-run depth defaults to Topics only.
  - *Every other depth* (parent, atomic, verified) is offered only for sections **already saved**. The run copies
    those topics and goes straight to parent questions; it has no plan or split stages, and those cards are hidden.
- **Lessons now build from the same database:** a Lessons run copies a saved section's topics and writes one
  lesson per topic. Lessons no longer plans or splits anything itself (that code is removed), and a section that is
  not saved cannot be built there. The page says to run Topics only in Codex first.
- **Existing runs:** unaffected. Older Codex runs that planned and split in the same run keep working. Lessons runs
  made before this change may show no lessons (their old plan/split tasks are ignored).
- **Untested:** written without installed dependencies, so no type-check or run. First job: run Topics only for one
  Biology section in Codex, save it, then build questions and lessons from it.
- **Not built:** a section completion checklist across Codex and Lessons.

### Repair: Codex runs stopped loading after lessons were removed
- **Symptom:** the Codex runs list and older runs would not load.
- **Cause:** runs on which lessons had been developed still held tasks with the stage `content`. After lessons
  moved out of Codex, the progress calculation hit an unknown stage and threw, so the list and run pages failed.
- **Fix:** Codex now ignores any task whose stage it does not know (progress, claiming, failed-task list and
  retry). The orphaned tasks stay in Firestore, harmless. Nothing is deleted.

### Change: lessons moved out of Codex into a new app, MCAT Lessons
- **Codex cleanup:** the reading-lesson work added earlier today (the "Topics only + content" run type, Develop
  content, the Lessons toolbar and progress bar, Choose lessons, View content, `codex_content`) is removed from
  Codex. Codex is questions-only again: plan, split, parent, atomic, verify, database. Existing Codex runs are
  unaffected; any `codex_content` documents are simply no longer read.
- **New third tile, MCAT Lessons** (`/lessons`, API under `/api/lessons`, code in `lib/lessons`): Subject, major
  section, topic plan, topic splits, then one reading lesson per split topic. It generates lessons only. It keeps
  its own Firestore collections (`lessons_runs`, `lessons_tasks`, `lessons_topics`, `lessons_items`).
- **Reused from Codex (imports, not copies):** the Sub-Codex parser and subject presets, plan and split
  validation (`checkPlan`, `checkExpansion`), and the model caller, so Lessons uses the same Admin model setting
  (the "Codex" role if one is checked, otherwise the generation model).
- **Enhancements over the Codex lesson step:** planning and splitting prompts are written for lessons and ask for
  learning order (prerequisites first); lessons gain "why it matters" and "on the MCAT" fields; a run option
  "write lessons automatically once topics are split" (on by default; off stops after the splits); a toolbar
  (Develop lessons, Pause/Resume, Stop, Approve all, Choose lessons, Read lessons, Download).
- **Not included:** study mode, AI verification of lessons, the database/locking feature.
- **Untested:** written without installed dependencies, so no type-check or run. Try one small section first.

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
