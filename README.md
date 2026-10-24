# MCAT Mastery

A full-featured MCAT study platform with adaptive practice, performance analytics, and an AI-powered question bank.

---

## What It Does

MCAT Mastery lets students practice MCAT-style questions, track their progress over time, and drill the specific topics they struggle with most. An admin panel handles question generation and database management.

---

## Features

### Practice Sessions
- Choose from all four MCAT sections: **Chem/Phys**, **CARS**, **Bio/Biochem**, **Psych/Soc**
- Filter by **difficulty** (Easy / Medium / Hard) or leave on Any for a mixed set
- Filter by **topic subtypes** within each section
- Set question count (1–50) and choose timed or untimed mode
- Passage-based and discrete question formats
- Keyboard shortcuts for fast navigation (A–D or 1–4 to answer, Enter to submit, P for passage)
- Flag questions for later review
- Inline simplified explanations powered by AI

### Results & Review
- Post-session summary with accuracy, per-section breakdown, and time-per-question
- Visual question grid showing correct / incorrect at a glance
- Flagged question list for targeted re-review
- Full mistake log: filter all missed questions by section, error type, or review status

### Dashboard & Analytics
- Overall accuracy and total questions answered
- Per-section accuracy bars
- Auto-detected weak topics with one-click drill mode
- Full-length test score tracker (out of 528)
- Progress trends over time

### Admin Panel
- **AI Question Generation** — generate discrete or passage-based questions by section and subtopic, with optional figure generation; streams results in real time
- **Question Database** — search, filter, edit, and audit the full question bank
- **Formatting Tools** — batch-clean passage and explanation formatting
- **Custom Models** — plug in any OpenAI-compatible model for generation or auditing
- **Curriculum Mapping** — link questions to specific MCAT topic areas

### Auth & Accounts
- PIN-based student login — one account works across all devices
- Session persists across browser restarts (no daily re-login)
- Account data backed up to Firestore so credentials are never lost

---

## Stack

- **Framework**: Next.js (App Router)
- **Database**: PostgreSQL via Prisma
- **Storage**: Firebase Firestore + Cloud Storage
- **AI**: Anthropic Claude API (question generation, simplified explanations)
- **Auth**: Custom PIN auth with HTTP-only cookies

---

© 2026 MCAT Mastery. All rights reserved.

---

## MCAT Codex (second app)

After the PIN login, `/` shows two tiles: **MCAT Mastery** (everything above, now under `/mastery`) and **MCAT Codex**.

Codex is a separate, structured question generator. You give it a **Sub-Codex** (paste or `.txt`):

```
Subject: Biology
MS-1: Molecular Biology and Genetics
MS-2: Cell Structure and Function
```

and it runs: topic plan per major section → one **parent** MCQ per topic → the minimum set of **atomic** MCQs each parent needs →
AI verification (blind solve + scientific review, with bounded automatic correction) → **your approval**. IDs are assigned by code
(`MS-1-SS-2-15`, atoms `MS-1-SS-2-15-A3`). Only questions you approve are exported as "approved".

- **Isolated from Mastery:** Codex reads and writes only its own Firestore collections (`codex_runs`, `codex_tasks`, `codex_topics`,
  `codex_questions`) and Firebase Storage under `codex/`. It never touches the Mastery question bank.
- **Shared with Mastery:** the PIN login, the Firebase project, and the AI models configured in Admin → Settings
  (the *generation* role writes; the *audit* role solves blind and reviews).
- **No background worker:** the run page drives the pipeline one task at a time and saves after every step, so you can pause or
  close the page and resume later. Keep the page open while a run is going.
- Code: `lib/codex/` (engine, prompts, checks, store), `app/api/codex/`, `app/codex/`.
