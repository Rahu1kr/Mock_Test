# Geo PYQ

A previous-year-questions (PYQ) practice and timed mock-test app for UGC NET Paper I, UGC NET
Geography Paper II, and State SET Geography — built as an installable PWA so it works on iPad and
iPhone without the App Store.

Modelled on the Android app *UGC NTA NET I & II Geography PYQ* (FriendGeo), which has no iOS
version, with a real timed mock-test engine added (the original only has tap-to-reveal browsing).

English only.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · Tailwind 4 |
| Backend | Node.js · Express · Mongoose |
| Database | MongoDB Atlas |
| Auth | JWT (bcrypt-hashed passwords), `admin` / `user` roles |

Two deployables: `frontend/` and `backend/`.

## Requirements

Node **20.9+** (Next 16 refuses to build on older). The repo pins `20.19.4` in `.nvmrc`:

```bash
nvm use
```

## Running locally

```bash
# 1. Backend — copy the env template and fill in your Atlas URI
cd backend
cp .env.example .env     # set MONGODB_URI and a strong JWT_SECRET
npm install
npm run dev              # http://localhost:4000

# 2. Frontend (separate terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev              # http://localhost:3000
```

## Accounts

**The first account that registers automatically becomes the admin.** Every later signup is a
normal user. Roles are never accepted from the signup request — only an existing admin can promote
someone, via `PATCH /api/admin/users/:id/role`.

Create the admin once:

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"at-least-8-chars"}'
```

## Content structure

Modelled on the FriendGeo home screen, minus the Hindi sections (this build is English-only).

```
HOME        Geo English · One English            (UGC NET)
            Kerala / Gujarat / W.B / Maharashtra / Karnataka  Paper-I + Paper-II
            Rajasthan Paper-II · Other
  ↓ tap a section
YEARS       2023 · 2022 · 2021 …      one year = one paper
  ↓ tap a year
MODE        Practice  |  Exam
```

Bottom navigation: **Home** (section tiles) · **Topic Wise** (questions pooled by topic across
every year) · **Mock** (every paper in one list, startable in exam mode). It is hidden inside the
admin panel and during an attempt.

A **section** is one paper of one exam (e.g. "Kerala SET Paper II"). A **paper** is one year of a
section, and papers are derived automatically from the `year` on imported questions — there is no
paper to create or maintain. Import a year, and that year appears for users immediately.

## Adding content (admin)

1. Sign in → **/admin**
2. **Sections** — create one per exam paper, with its home-screen group (`UGC NET` / `State SET`),
   display order, marking and minutes-per-question
3. **CSV upload** — download the template, fill it in a spreadsheet, export CSV, then:
   - **Dry run** first. It validates every row and reports problems by row number. Import stays
     disabled until the file is clean, so a bad spreadsheet can never half-import.
   - **Import.** Topics are created automatically from the `topic_name` column.
4. **Papers** — read-only view of what users can now see, per section and year

CSV columns: `exam_code, topic_name, year, question_text, option_a..option_d, correct_option,
explanation, source_citation`. Only `exam_code`, `question_text`, the four options and
`correct_option` are required — but always set `year`, since that is what creates the paper.

Starter content lives in [`content/`](content/).

> These seed questions are **syllabus-aligned samples, not real PYQs** — each row says so in its
> `source_citation`. Replace them with transcribed official papers before real study use.

## Using the app (student)

Open the site in Safari on the iPad → Share → **Add to Home Screen**. The app shows this hint
automatically, because iOS never fires the browser install prompt.

Pick a section, pick a year, then choose a mode:

- **Practice mode** — every question on one page. Tap an option and your answer, the correct
  answer and the explanation appear together immediately. No timer. Finish for a score.
- **Exam mode** — real exam simulation: one question at a time, a countdown sized to the paper
  (minutes-per-question × question count), a colour-coded question palette (answered / not
  answered / marked for review / not visited), mark-for-review, and auto-submit on expiry.
  Answers stay hidden until submission.
- **History** — every attempt, tagged by mode, synced across devices via the account.

## Design notes

- **Timer.** Remaining time is derived from an absolute server-assigned `startedAt` on every tick
  and on `visibilitychange`/`focus`, never decremented from a counter — iOS Safari suspends timers
  in backgrounded tabs, which would freeze or drift a naive countdown. Expiry is re-checked on
  resume, and the server independently auto-submits an expired attempt when it is next read.
- **Answer secrecy.** In exam mode `correctOption` and `explanation` are stripped from the API
  response while an attempt is `in_progress`, so the answer key is never in the page during a
  test. Practice mode deliberately includes them — showing the answer is the point of that mode.
- **Paper snapshot.** An attempt stores the exact question list and marking scheme it started
  with, so importing or editing questions mid-attempt can't change a test already in progress.
- **Answer durability.** Each selection is written to IndexedDB immediately and synced in the
  background, with an offline queue flushed on `online`. A tab kill or dropped connection mid-test
  doesn't lose answers.
- **Scoring** runs server-side in one place (`backend/src/services/scoring.ts`) for both manual and
  automatic submission, so the two paths can't disagree.

## Deploying

Frontend → Vercel. Backend → Render/Railway (set `MONGODB_URI`, `JWT_SECRET`, and `CORS_ORIGIN` to
the deployed frontend URL). Point the frontend's `NEXT_PUBLIC_API_BASE_URL` at the backend.

A PWA must be served over HTTPS for the service worker and Add-to-Home-Screen to work; both hosts
provide that automatically.
