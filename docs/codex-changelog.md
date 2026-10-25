# Codex changelog: changes and repairs

Running list, newest first. "Change" = code merged to `main`. "Repair" = something fixed on a live run
(button pressed, setting changed) that did not need new code. Add an entry whenever either happens.

## 2026-10-25

### Change: DeepSeek prompt caching
- DeepSeek caches repeated prompt prefixes automatically (no request flag), so caching is about keeping the start of
  every request identical. The static system prompt already comes first; lesson-writing prompts were reordered so the
  lesson title, scope and sibling topics (same for every part of a lesson) precede the topic and part number.
  The AI-check prompt already had its shared lesson context first.
- Codex: reviewed every stage. Planning prompts now put the subject and curriculum outline (identical for each major
  section) before the section. Expand, parent, atomic, coverage, solve-blind and review prompts were left as they are:
  their per-call content (the topic, parent question or question batch) is what differs, and their long fixed
  instructions already sit in the system prompt at the front, which is the part that gets cached. Retry and
  correction rounds already append their extra text after the topic, so a retry reuses the first attempt's prefix.
- `lib/model.ts` logs `[model] prompt cache: N hit, M miss` from DeepSeek's usage report on each call. The Anthropic
  path is unchanged.
- Caching is best effort and not instant: DeepSeek builds the cache in the background, so hits show on later calls
  (typically seconds to minutes later); only the shared prefix is discounted. Not yet verified against a live call.

### Change: clearer names for the Codex "What to build" choices
- Topics only (first step) · Parent questions, I approve them · Parent questions, fully automatic · Parent + atomic
  questions, I approve them · Parent + atomic questions, AI-checked. The names appear in the selector, the run header and the
  runs list; the one-line description under the selector was reworded to match.

### Change: Codex run page shows every progress bar from the start
- Question runs always show **Writing**, **AI check and approval** and **Saved to the question database**, even before a
  stage has begun. Until a stage starts, its bar shows what it is waiting for ("starts once questions are written",
  "saves automatically after approval", "after approval; you press Save"). For options that have no AI check or saving
  (Through parent questions, Through atomic questions) those two bars are dimmed and say "not part of this option".
- Topics-only runs always show **Planning**, **Splitting into topics** and **Saved to the topic database**.
- Expected totals are used before tasks exist (one question and one check per topic), so a bar reads 0 of 124, not 0 of 0.
- **Untested:** written without installed dependencies, so no layout check.

### Change: parent-only runs are fully automatic, with three progress bars
- **Depth renamed** "Parent questions only, checked, approved and saved automatically". Press Start once: each parent
  question is written, checked by AI, approved if it passes, and copied to the question database straight away (each
  question gets a `savedAt`). Nothing else to click. Only questions the AI still fails after two corrections are flagged
  and wait for a person; when you approve one it is saved the same way.
- **Run completes itself:** once every topic has an approved, saved parent (or one you rejected) and no step is left, the
  run is marked saved. That locks it and hides its sections from the new-run list, as before. Remove from database still
  undoes it (and clears the saved marks).
- **Three bars on the run page** for checked depths: **Writing**, **AI check and approval** (with approved and
  need-you counts) and **Saved to the question database**. Topics-only and unchecked depths keep one bar.
- **Saved questions leave the list:** topics whose question is saved are hidden from the run's topic list, with a line
  "N questions are saved to the database and hidden" and a Show them link.
- **Unchanged:** fully verified runs (with atomic questions) are still approved and saved with buttons.
- **Untested:** written without installed dependencies, so no type-check beyond syntax. The automatic path has never
  run against a model: try one small section first.

### Change: Codex run page and new-run page made simpler (same approach as Lessons)
- **One control card:** **Start / Resume** and **Pause** (no Stop), Parallel, one status sentence (Ready / Running / Not
  running / Finished / Locked), one progress bar for the whole run, and a single line naming each step with work
  ("Planning 53/53 · Splitting 53/53 · Writing questions 12/124 · AI checks 0/124"). The separate stage cards, including
  empty 0/0 ones, are gone.
- **Only the next step is shown.** Save topics to database (Topics-only runs), Approve all that passed the AI check (N),
  Approve all unchecked (N) and Save to question database appear only when they apply. A blocked save shows one reason
  ("Before you can save: ...") instead of a bullet list, and nothing about saving appears for depths that cannot be saved.
- **Advanced (collapsed):** Download with an Approved-only checkbox, and Save approved to Firebase Storage.
- **Errors are visible:** a "A step is failing and will be retried" box with the latest error, and a "Stopped after
  repeated errors" message with the error text (same fix as Lessons).
- **Phones:** a topic's status sits under its title instead of beside it.
- **New-run page:** "How far to go" is now **What to build**, with one plain sentence under it for each choice. Changing
  it refreshes the section list. Deleting a Topics-only run whose topics are not saved now warns that the work will be lost.
- **Untested:** written without installed dependencies, so no type-check beyond syntax and no layout check.

### Change: parent questions approved automatically when the AI check passes
- In the **Parent questions only, AI-checked and approved automatically** depth, a parent question that passes AI
  verification (blind solve agrees, scientific review passes, after up to two corrections) becomes **Approved** on its own,
  marked "by AI", with no button to press. It is immediately available in Codex Study.
- Questions still failing after the corrections are **Flagged** and wait for a person. A person can still reject any
  question, including ones the AI approved.
- Other depths are unchanged: a person approves. This is a deliberate exception to the earlier rule that only a person
  approves questions, so check a sample of AI-approved questions before relying on them.

### Change: parent questions only, with practice
- **New Codex depth: "Parent questions only, with AI check".** Writes one parent question per saved topic and runs the
  AI verification (blind solve and scientific review, with up to two corrections) on each parent by itself. No atomic
  questions are written. The atomic stage card is hidden for this depth.
- **Approve all unchecked:** for "Through parent questions" and "Through atomic questions" (which have no AI check),
  a button approves every question still in draft, after a warning that no AI check was run. Flagged questions are
  untouched. API action `approve_drafts`.
- **Practice:** Codex Study already has a "Parent questions only" mode that uses approved questions; nothing changed there.
- **Question database:** runs of the new depth can be saved to the question database like fully verified runs.
- **Untested:** written without installed dependencies, so no type-check beyond syntax. The parent-only verification
  path has never been run: try one small section first.

### Change: "Fixing after AI check" state and visible findings
- **Why:** with every part written, a lesson that the AI check had sent back for correction still read "Writing", which
  looked like nothing had happened. It now reads **Fixing after AI check**, and opening the lesson lists what the reviewer
  found (the part, the problem, the suggested fix), which round it is, and how many parts are being rewritten.
- The run page's "in progress" count includes lessons being fixed.

### Fix: AI check errors were invisible on the Lessons run page
- **Symptom:** every part written, the lesson "Awaiting AI check", the run idle and no explanation.
- **Cause (from the code):** after three failing steps in a row the run loop stops, and the only trace was the small
  log at the bottom of the page. A failing AI check (for example the audit model not set up or rejecting the request)
  looks exactly like that. The AI check had never been run against a model before.
- **Fix:** the page now shows a "A step is failing and will be retried" box with the latest error for each waiting
  step, and a "Stopped after repeated errors" message with the error text when the run stops. Pressing Start tries again.
- **Still unknown:** the actual error in your run. Read the box that now appears after pressing Start.

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
