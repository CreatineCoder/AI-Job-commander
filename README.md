# AI Job Application Command Centre

An agentic job-application tracker built on the **[Lemma SDK](https://lemma.work)** for the
Gappy.AI National AI Hackathon. Paste a résumé + job description and an AI agent parses the JD,
scores your fit, lists résumé gaps, drafts tailored recruiter outreach, and — after your
approval — sends it via Gmail. Everything lands as rows in a live pipeline board, not a chat.

## 🔗 Live app
**https://devansh-job-command-centre.apps.lemma.work/**

> Sign in with the authorized Lemma account to view the operator board.

## What it does
- **Intake** — paste résumé + JD → the `parser_scorer` agent stores the résumé as a version,
  parses the role, and creates a tracked application.
- **Scoring** — a deterministic `score_match` function rates résumé-vs-JD fit (0–100) with an
  explainable breakdown; the agent judges each skill, the function does the math.
- **Résumé-improvement loop** — mark a job "improved", paste the new résumé, and the agent
  refreshes the gaps and next action.
- **Outreach with human approval** — the `outreach_writer` agent drafts a recruiter email +
  cover letter in your voice; you review (Approve / Edit / Regenerate / Reject); only then does
  a **Send** option appear, which delivers via Gmail through the `send_email` function.
- **Pipeline board** — kanban by stage (Applied → Screening → Interview → Offer → Rejected),
  with match scores, next actions, and follow-up dates.

## Built with Lemma primitives
| Primitive | Used for |
|---|---|
| Datastores | `user_profile`, `resume_data`, `applications`, `permissions` |
| Agents | `parser_scorer`, `outreach_writer` (multi-agent) |
| Functions | `score_match` (deterministic scoring), `send_email` (Gmail send) |
| Connectors | Gmail (send) via OAuth; Google Calendar (planned) |
| App | single-file operator board served by the pod |

## Repo layout
```
job-command-centre/      the Lemma pod bundle (import with `lemma pod import .`)
  tables/                datastore schemas
  agents/                parser_scorer, outreach_writer
  functions/             score_match, send_email
  apps/board/index.html  the operator board (deploy with `lemma app deploy`)
ARCHITECTURE.md          full system design + flows + demo script
PROGRESS.md              build log, identifiers, gotchas, next steps
AI_job_architecture.drawio   the hand-drawn architecture
```

## Running it
Requires the [Lemma CLI](https://lemma.work) and an authenticated org/pod.
```bash
lemma pod import ./job-command-centre
lemma app deploy devansh-job-command-centre ./job-command-centre/apps/board/index.html --yes
```

---
Built for the Gappy.AI × Lemma hackathon. See `ARCHITECTURE.md` for the full design.
