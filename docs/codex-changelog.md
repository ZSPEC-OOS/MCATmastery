# Codex changelog: changes and repairs

Running list, newest first. "Change" = code merged to `main`. "Repair" = something fixed on a live run
(button pressed, setting changed) that did not need new code. Add an entry whenever either happens.

## 2026-10-25

### Fix: Lessons status wording and phone layout
- **Ready message:** it said "N lessons chosen (all parts)" even when every part was written and only the AI check was
  waiting. It now says how many parts are still to write, or "Every part is written; N lessons are waiting for the AI
  check. Press Start."
- **Lesson rows on phones:** the status and parts count sit under the title instead of beside it, so long titles no longer
  wrap into a narrow column next to the Add to run / Rewrite button.

### Change: Stop button removed from the Lessons run page
- The control bar is now just **Start / Resume** and **Pause**. Pause holds all work after the step in flight and keeps
  everything queued, so nothing is dropped. The Stop action is removed from the page, the API and the engine. A run with
  unfinished lessons and nothing queued now says "N lessons are not finished. Press Resume to continue."
- Queued work can still be removed by rewriting or re-adding lessons from the lesson rows.

### Change: Add to run / Rewrite on each lesson row
- The **Add to run** (lesson not in the run) and **Rewrite** (finished lesson; asks first, clears its AI check and any
  decision) buttons now sit on the collapsed lesson row, so several lessons can be queued without opening each one.
  They only queue; press Start or Resume to write. On a phone the "N parts" count is hidden to make room.

### Change: simpler Advanced section on the Lessons run page; one Download button
- **Removed** the Add lessons and Read lessons buttons (and their pages). Reading now happens in **Study**.
- **Advanced** now holds **Confirm all AI-approved** and a single **Download** button. Clicking Download opens a small
  chooser: **All lessons** or **Selected lessons** (tick the lessons you want), plus an **Approved only** checkbox.
  The export route accepts `?lessons=MS-1-SS-1,MS-1-SS-2` for the selected set.
- **Adding and rewriting lessons moved into the lesson itself:** open a lesson below the controls to find **Add to run**
  (for a lesson not in this run) or **Rewrite lesson** (clears its AI check and any decision). Both only queue; press
  Start or Resume to write.
- **Untested:** written without installed dependencies, so no type-check beyond syntax.

### Change: MCAT Lessons Study section and reader
- **Build / Study tabs** in the Lessons navbar. **Study** (`/lessons/study`) is a library of every lesson that is
  approved (a person approved it, or the AI passed it and no one rejected it), grouped by subject and major section,
  with parts, estimated reading time (200 words a minute) and your progress. Where the same lesson exists in several
  runs, the newest approved copy is shown.
- **Reader** (`/lessons/study/<run>/<lesson>`): one calm column about 42rem wide, 19px serif text at 1.8 line height by
  default, parts shown as Part n of N with objectives, why it matters, headed sections, a key-terms card, a "Watch out"
  card for misconceptions, an "On the MCAT" card, a recap, and sources folded away. Contents panel (sticky on wide
  screens, a drop-down on phones) with read marks and the part you are in; a thin reading-progress bar; Previous /
  Next lesson links; "Continue where you left off".
- **Reading settings** (Aa): text size 15 to 27, serif or sans, "Match the app" or a warm "Paper" page. Kept in this
  browser only.
- **Progress** is saved to your account (`lessons_reading`, one document per user and lesson): a part counts as read
  when you scroll past its end or tick Mark as read; your place is saved as you read.
- **Not included:** notes or highlights, search, questions or flashcards from a lesson, reading offline.
- **Untested:** written without installed dependencies and never viewed on a screen, so no type-check beyond syntax
  and no layout check. Send a screenshot of the reader on your phone if anything looks off.

### Change: Lessons run page, secondary actions moved under Advanced
- Add lessons, Read lessons, Confirm all AI-approved and the two downloads now sit in a collapsed **Advanced** section
  of the control card, so the page shows just Start / Pause / Stop, one status line and one progress bar. Advanced
  opens by itself when no lessons are chosen yet, so Add lessons is easy to find.

### Change: Lessons reorganized: one control bar, nothing auto-starts, AI validation layer
- **No auto start.** Creating a run only queues the lessons you ticked (everything is ticked by default, with Select
  all / Clear). The "write automatically" checkbox is gone. Nothing is written until you press Start.
- **One control bar on the run page:** **Start** (Resume after a pause or stop), **Pause**, **Stop**, plus Parallel.
  Pause holds everything after the step in flight. Stop drops everything still queued (written parts are kept). One
  status sentence (Ready / Running / Paused / Stopped / Finished) replaces the overlapping counters, and one progress
  bar shows parts written. The old Develop lessons, Pause lessons and separate Run buttons are removed.
- **Add lessons** (was Choose lessons) queues more lessons, or rewrites ones already written, and returns to the run
  page without starting.
- **AI validation layer.** When every part of a lesson is written, an AI reviewer (the audit model) checks the whole
  lesson in batches of 6 parts for scientific accuracy, scope, contradictions between parts, invented claims and quiz
  questions. Parts with errors are rewritten using the reviewer's findings (up to 2 correction rounds), then the
  lesson is checked again. Result: **AI approved**, or **Flagged for you** if errors remain. A lesson shows the AI
  verdict, its issues and how many rounds it took; parts show "rewritten N× after the AI check".
- **Human decision is optional** and overrides the AI either way. "Confirm all AI-approved" confirms in one click.
- **Database checklist:** a lesson counts as approved when a person approved it, or the AI passed it and no person
  rejected it. New collection `lessons_aireviews`; tasks gained a `review` stage.
- **Untested:** written without installed dependencies, so no type-check or run. The reviewer prompt has never
  been run against a model: check a few lessons by hand before trusting AI approval.

### Fix: unselected lessons showed "Writing"
- **Symptom:** after choosing individual lessons, every lesson on the run page said "Writing", which looked as if all of
  them were being written.
- **Cause:** the label meant "not fully written yet", so lessons that were never queued showed it too. Only the chosen
  lessons were actually queued (checked in the run-creation code).
- **Fix:** lessons now show **Not started** (nothing written, nothing queued), **Writing** (parts queued or running),
  **Incomplete** (some parts exist but none are queued), or draft/approved/rejected once every part exists. The run page
  also shows "N in progress", and the Read page filter has the new states.

### Change: pick individual lessons when creating a Lessons run
- On the Lessons new-run page, unticking **Write every lesson automatically** now lists each chosen section's
  subsections (one lesson each) with checkboxes, Select all and Clear. Only the ticked lessons are queued when the
  run is created; the rest can be developed, or more picked, from the run page. Ticking none creates an empty run.
- The topic-database list route now includes each section's subsections.
- **Untested:** written without installed dependencies, so no type-check or run.

### Change: Database page sections expand
- Each section row that has saved topics expands (click the row, or Expand all) to show its saved contents: the
  planner's coverage summary and declared gaps, then every subsection (lesson) with its approval status and each split
  topic; click a topic for its scope and learning target. Read-only. New route `/api/codex/database/section`.
- **Untested:** written without installed dependencies, so no type-check or run.

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
