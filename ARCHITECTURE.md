# AI Job Application Command Centre — Architecture

> Hackathon: Gappy.AI National AI Hackathon · Powered by Lemma SDK
> Problem statement: **AI Job Application Command Centre** (CAREER)
> Builder: Devansh (solo) · Org: `devansh-hackathon` · Build window: June 24–30, 2026
>
> This doc reconciles `AI_job_architecture.drawio` (the hand-drawn journey) with the
> finalized design decisions. The .drawio file is the visual; this is the authoritative spec.

---

## 1. The problem (one sentence)

A job seeker applies to many roles and loses track of what was applied to, what's missing
from their resume, who to contact, and what's due next. This pod turns that scattered,
stateful workflow into one command centre where **a team of AI agents** parses jobs,
scores resume fit, suggests improvements, drafts outreach, tracks the pipeline, and keeps
itself updated from the inbox — acting only with the user's approval.

**Specific user:** an early-career job seeker / hackathon participant (the builder themselves).

**Explicit non-goal:** no auto-submitting forms on job portals (fragile, anti-bot, out of
Lemma's scope, penalized as wasted complexity). "Applying on your behalf" = drafting and —
with approval — sending real outreach, plus owning the pipeline state.

---

## 2. System at a glance

```
                          ┌────────────────────────────────────────────────┐
                          │                     POD                          │
                          │             (job-command-centre)                 │
                          │                                                  │
  User (app / chat) ────► │  DATASTORES   user_profile, applications,        │
        ▲                 │               permissions                        │
        │  approvals      │  FILES        resume.md (+ versions), voice.md    │
        │  & permission   │  AGENTS       parser_scorer, outreach_writer,     │
        │  grants         │               inbox_reader                       │
        ▼                 │  FUNCTIONS    score math, status transitions,     │
   Gmail (read/write) ◄─► │               follow-up date logic               │
   Google Calendar   ◄─►  │  WORKFLOWS    intake, outreach, follow_up(cron),  │
   (surfaces)             │               inbound_email                      │
                          │  APP          pipeline board (operator UI)        │
                          │  PERMISSIONS  dynamic, granted/elevated on demand │
                          └────────────────────────────────────────────────┘
```

Every agent's output lands as **rows in datastores**, not chat messages.

---

## 3. Data model

### Datastore: `user_profile`  (one row — the user)
| Field | Type | Set by |
|---|---|---|
| `name`, `email` | text | auth / user |
| `skills` | list[text] | `parser_scorer` (extracted from resume) |
| `current_resume_file` | ref | user upload |
| `target_roles` | list[text] | user |

### Datastore: `applications`  (the pipeline — "Company and status", source of truth)
| Field | Type | Set by |
|---|---|---|
| `company` | text | `parser_scorer` (from JD) |
| `role` | text | `parser_scorer` |
| `jd_file` / `jd_text` | file / long text | **user (PDF on job create)** |
| `resume_used` | ref | user (PDF on job create) |
| `must_have_skills` | list[text] | `parser_scorer` |
| `match_score` | number 0–100 | `parser_scorer` + score function |
| `resume_gaps` | long text | `parser_scorer` |
| `suggested_topics` | list[text] | derived from `resume_gaps` (prep while waiting) |
| `draft_message` | long text | `outreach_writer` |
| **`status`** | enum | user + agents (see §4) |
| **`sub_status`** | text | user + agents (see §4) |
| `next_action` / todos | text/list | agents (inbound + follow-up create todos) |
| `follow_up_date` | date | functions (set on status change) |
| `contact_name` / `contact_email` | text | user |
| `notes` | long text | user + `inbox_reader` (appends emails) |
| `created_at` / `updated_at` | timestamp | system |

### Datastore: `permissions`  (what the user has granted)
Tracks grants like `gmail_read`, `gmail_write`, `calendar_write`. Agents **check** this
store before acting and **request elevation** if a needed grant is missing
(the "ask & update email-write permission if not given" path).

### Files
- `resume.md` / uploaded resume PDFs (+ improved versions) — agent memory for matching.
- `voice.md` — tone/playbook so drafts sound like the user.

---

## 4. The pipeline (status state machine)  — decision #2

Four broad stages, each with optional sub-stages:

```
APPLIED ──► SCREENING ──► INTERVIEW ──► OFFER
   │            │             │
   │            │             └─ sub: round_1, round_2, round_3, final
   │            └─ sub: resume_screen, test/assessment, recruiter_call
   │
   └──────────────────────────────────────► REJECTED   (terminal, from any stage)
                                             WITHDRAWN   (terminal, user choice)
```

- `status` = broad stage; `sub_status` = the granular step.
- A **`status_transition` function** validates moves (no illegal jumps) and, on each change,
  sets a fresh `follow_up_date` and may create a calendar event (decision #7).

---

## 5. The agents (multi-agent)  — decision #8

Every "Agent" box in the diagram is a **separate, permission-scoped agent**:

| Agent | Role | Reads | Writes |
|---|---|---|---|
| **`parser_scorer`** | Parse JD+resume PDFs → company/role/skills; score fit; list gaps; suggest prep topics | jd_file, resume, user_profile | applications, user_profile |
| **`outreach_writer`** | Draft recruiter email + cover letter in user's voice; (after approval) send | applications, voice.md, permissions | applications; Gmail (send) |
| **`inbox_reader`** | Read inbound mail, map to an application, advance status, create todos, notify | Gmail (read), applications, permissions | applications; Calendar |

Deterministic logic (score math, status-transition validation, follow-up date calc) lives in
**functions**, not the LLM.

---

## 6. The flows

### 6a. INTAKE — decision #1 (user provides JD + resume PDF per job)
```
User: "Add a job"  →  uploads JD (PDF/text) + resume (PDF)  ───────────┐
                                                                        ▼
parser_scorer:
  • parse JD → company, role, must_have_skills
  • score resume vs JD → match_score + resume_gaps + suggested_topics
  • create row in `applications` (status = APPLIED, sub = resume_screen)
  • update user_profile.skills
                                                                        ▼
  ⟳ RETRY on parse failure (decision #9): re-attempt parse; after N tries,
    flag the row "needs manual input" and ask the user.
                                                                        ▼
  Show suggestions & improvements → resume-improvement loop (§6b)
```

### 6b. RESUME-IMPROVEMENT LOOP
```
Agent shows resume_gaps + suggested edits
        │
        ▼
"Have you done the improvements?"
   • YES → ask for the new resume → store new version → (re-score, optional) → proceed to outreach
   • NO  → keep suggestions open; user can draft/send with current resume anyway
```

### 6c. OUTREACH (with human review + permissions) — decision #3
```
outreach_writer drafts email + cover letter (voice.md)
        │
        ▼
PERMISSION CHECK (permissions datastore):
   needs gmail_write?  → if missing, ASK USER to grant (elevation)
        │
        ▼
HUMAN REVIEW  ⏸️   (approval step)
   • Approve → send via Gmail surface; status/sub updated; follow_up_date set;
               (if a call/deadline) add Calendar event (decision #7)
   • Edit    → agent revises, re-presents
   • Reject  → keep as draft / withdraw
```

### 6d. INBOUND EMAIL — decision #4 & #9
```
Recruiter replies → Gmail surface (webhook) → inbound_email workflow
        │
        ▼
inbox_reader:
  • read email, identity-resolve sender/company → match an `applications` row
        │
   ┌────┴─────────────────────────────┐
   │ match found                        │ NO match → do nothing (decision #9)
   ▼                                    ┘
  • classify intent → update status/sub:
       interview invite → INTERVIEW (round_n) + add Calendar event
       rejection        → REJECTED
       asks for info     → next_action + draft reply (→ §6c approval)
  • append email to notes
  • NOTIFY user + ADD a todo to follow
```

### 6e. FOLLOW-UP (scheduled) — decision #5 (recommended pattern)
```
Daily cron trigger → query applications where follow_up_date <= today and status active
        │
        ▼
  • outreach_writer drafts a follow-up nudge → HUMAN REVIEW ⏸️ → send / dismiss
  • inbox_reader may also surface "no reply yet, suggest next step"
  • reset follow_up_date
```

### 6f. "WORK ON THIS MEANWHILE" — decision #6
While an application waits, agent suggests prep `suggested_topics` derived **from
`resume_gaps`** (the skills the JD wanted that the resume lacked).

---

## 7. Calendar integration — decision #7
When a follow-up is due or an important event occurs (interview scheduled, deadline),
**if `calendar_write` is granted**, the agent creates a Google Calendar event. If not
granted, it asks; if declined, it just keeps the date in `applications`.

---

## 8. Permissions model — decisions #3 & dynamic elevation
- All grants live in the `permissions` datastore: `gmail_read`, `gmail_write`, `calendar_write`.
- Agents are **least-privilege**: each only sees what it needs.
- **Dynamic elevation:** if an agent needs a grant it doesn't have, it pauses and asks the
  user, then records the grant. Nothing reads mail / sends mail / writes calendar silently.

---

## 9. The app (operator UI)
Kanban board by `status` (Applied / Screening / Interview / Offer / Rejected), sub-status as
card tags. Card shows company, role, match_score, next_action/todos, follow_up_date.
Click → JD, gaps, suggested topics, drafts, and **Approve / Edit / Reject** + permission prompts.
"Add job" → upload JD + resume → kicks off intake. Single-file HTML first; React if time allows.

---

## 10. Lemma primitive usage (maps to 15% SDK score)
| Primitive | Used for |
|---|---|
| Datastores | user_profile, applications, permissions |
| Files | resume versions, voice.md |
| Agents | parser_scorer, outreach_writer, inbox_reader (multi-agent) |
| Functions | score math, status transitions, follow-up dates |
| Workflows | intake, outreach, inbound_email, follow_up (cron) |
| Approvals | human review before any send; permission elevation |
| Surfaces | Gmail (read/write), Google Calendar |
| Permissions | least-privilege agents + dynamic grant elevation |
| App | operator pipeline board |

---

## 11. Build order (5-day, de-risked)
1. Pod + `applications` datastore + `user_profile` → rows exist.
2. `parser_scorer` agent + intake workflow (upload JD+resume → parsed, scored row). **The magic.**
3. Status state machine + functions (transitions, follow-up dates).
4. `outreach_writer` + outreach workflow **with human review + permission check**. Signature loop.
5. Operator app (HTML board).
6. `follow_up` cron workflow.
7. **Stretch:** `inbox_reader` + inbound_email (Gmail read), Calendar events, resume-improvement
   re-scoring, React polish.

Ship 1–6 solid before stretch. A working narrow loop beats an ambitious broken one.

---

## 12. Maps to judging criteria
| Weight | Criterion | How this wins |
|---|---|---|
| 35% | Problem clarity & real-world fit | Specific user, genuine pain, real PDF data |
| 25% | Product judgment | Explicit no-portal-automation; least-privilege; retry/no-op edge cases handled |
| 25% | Execution quality | Intake→score→approve→track loop fully demoable |
| 15% | SDK utilisation | Multi-agent, datastores, functions, workflows, approvals, 2 surfaces, permissions |

---

## 13. Demo script (June 30 screen recording)
1. Open empty pipeline board.
2. "Add job" → upload a real JD PDF + resume PDF → card appears, parsed, scored, with gaps + prep topics.
3. Show resume-improvement suggestions → upload improved resume.
4. Open card → AI-drafted recruiter email in your voice → **Approve** → status → Applied, follow-up set.
5. (Stretch) Send a test "recruiter reply" to the inbox → card auto-moves to Interview, todo added, Calendar event created.
6. Fast-forward `follow_up` cron → nudge draft appears for review.
7. Ask agent in chat "what's due today?" → answers from the pipeline.
