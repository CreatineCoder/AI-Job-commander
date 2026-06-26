# Job Command Centre — Build Progress (Session Log)

> Last updated: 2026-06-26. Hackathon: Gappy.AI / Lemma SDK. Builder: Devansh (solo).
> Deadline: **submit June 30** (~4 days left). Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md),
> [AI_job_architecture.drawio](AI_job_architecture.drawio).

---

## 1. What this is
**AI Job Application Command Centre** — a Lemma pod that tracks job applications: parse a JD +
resume → score fit → draft outreach → human-approve → send via Gmail → manage a pipeline board.
Chosen because the builder is the specific user (job-hunting) and it exercises every Lemma
primitive (datastores, agents, functions, app, connectors).

## 2. Identifiers (cloud: lemma.work)
- **Login:** devanshagrawal1027@gmail.com
- **Org:** `devansh-hackathon` = `019eff08-dcc4-77e7-b25e-f68201fb0810`
- **Pod:** `job-command-centre` = `019f03b0-09fb-74ea-891d-8acf9dbd7881`
- **App (board):** slug `devansh-job-command-centre` → https://devansh-job-command-centre.apps.lemma.work
- **Bundle dir:** `D:\devansh\lemma\job-command-centre\`
- **Gmail auth-config (Composio):** `Gmail (Composio)` = `019f04d3-26fb-742a-9b9c-993a6ae55305`
- **Calendar auth-config (LEMMA — likely needs Composio swap):** `019f049e-1d92-72b1-abf6-38eb9a01fa81`

## 3. Data model (4 datastores)
- **`user_profile`** (1 row) — basic identity: full_name, email, phone, location, headline,
  summary, links, target_roles. (Devansh's row populated.)
- **`resume_data`** (many) — resume VERSIONS: label, is_default, raw_resume_text, skills,
  projects, work_experience, positions, competitions, education, certifications. "Base Resume"
  is_default=true holds Devansh's real resume.
- **`applications`** (many) — the pipeline / source of truth. Key cols: company, role, jd_text,
  `resume_id` (FK→resume_data.id), must_have_skills, match_score, resume_gaps, suggested_topics,
  `status` enum (applied/screening/interview/offer/rejected/withdrawn), sub_status, next_action,
  follow_up_date, contact_name, contact_email, email_subject, draft_message, cover_letter,
  `outreach_status` enum (none/drafted/approved/sent), sent_at.
- **`permissions`** (many) — grant rows gmail_read/gmail_write/calendar_write (boolean granted),
  auto-seeded false on first board load. (Note: this is an app-level toggle table, separate from
  the real OAuth connector state.)
All linked by Lemma's auto `user_id` (RLS).

## 4. Agents (all pinned to model `kimi-k2.7-code` via agent_runtime)
- **`parser_scorer`** — intake. Given resume + JD: creates a `resume_data` row, parses JD,
  judges each required skill matched/partial/missing → calls `score_match` → creates the
  `application` linked via resume_id. Also has an UPDATE mode: re-evaluate after resume
  improvements (updates ONLY resume_gaps + next_action by application id). Falls back to the
  is_default resume if none provided.
- **`outreach_writer`** — drafts email_subject + draft_message (recruiter email) + cover_letter
  in the user's voice from the application + linked resume_data + user_profile; sets
  outreach_status='drafted'. Never sends.

## 5. Functions (Python, type API)
- **`score_match`** — deterministic. Input: per-skill judgments {skill,status,weight}
  (matched=1.0/partial=0.5/missing=0). Returns weighted match_score 0-100 + breakdown. The
  hybrid pattern: LLM judges, function computes (added for the 15% SDK score + explainability).
- **`send_email`** — sends an application's approved draft via Gmail. Reads contact_email/
  email_subject/draft_message; checks `pod.connectors.accounts.list(app="gmail")` → if none
  returns {status:"needs_auth"}, else `pod.connectors.execute("Gmail (Composio)",
  "GMAIL_SEND_EMAIL", {recipient_email,subject,body})` (NO account_id) and sets
  outreach_status=sent. Grant: connector "gmail" `connector.use` + applications r/w.

## 6. The board app (apps/board/index.html — no-build single-file HTML)
- Kanban by status; header stats (total/active/avg match/interview+).
- **Add job:** resume + JD textareas → calls `parser_scorer` via `client.agents.run`, polls for
  the new row.
- **Card detail modal:** required skills, gaps, prep topics, next action; editable stage,
  sub_status, contact_name, contact_email (Save).
- **Resume-improvement section:** "Have you made the fixes?" → paste updated resume →
  re-runs parser_scorer UPDATE mode → updates gaps + next_action only.
- **Outreach section:** Generate → review (Approve draft / Edit / Regenerate / Reject) →
  after approval a **Send email** button appears → calls `send_email`; on `needs_auth`
  auto-opens the Google consent tab; on success marks ✓ sent. Client constructed with
  `{timeoutMs:120000}` (connector ops are slow ~58s).
- Auto-seeds permissions rows on load (`ensurePermissions`).

## 7. Connectors / OAuth (status: Gmail CONNECTED ✅)
- Gmail connected via **Composio** provider (`lemma connector status` shows gmail CONNECTED).
- Scope granted: `gmail.modify` (broad — Composio's shared Gmail connector). We only call
  GMAIL_SEND_EMAIL. Token held by Composio/Lemma; revocable at myaccount.google.com/permissions.
- ⚠️ **LEMMA provider gives redirect_uri_mismatch for Google — always use provider COMPOSIO.**
- Calendar auth-config still on LEMMA → will likely need the same COMPOSIO swap before use.

## 8. Key gotchas / workarounds (IMPORTANT for next session)
- **Always prefix shell with `$env:PYTHONIOENCODING='utf-8'`** and use `--json` for chat —
  the CLI crashes printing emojis/arrows on Windows cp1252. (Also patched select.py termios bug.)
- **Set default org/pod by UUID, not slug** (slug → "badly formed hexadecimal UUID string").
- **Deploy pipelines are separate:** `lemma pod import .` for tables/agents/functions;
  `lemma app deploy devansh-job-command-centre apps/board/index.html --yes` for the board.
- **App slugs are globally unique** (use the namespaced slug).
- **Function grants for calling a function:** agent needs `function.read` + `function.execute`
  (NOT `function.run`). Connector grant: `connector.use` on resource_name = connector id.
- **`lemma connector connect-requests create` CLI is BROKEN** (SDK arg bug) — POST the REST API
  directly: `/organizations/<org>/connectors/connect-requests` with Bearer token from
  `~/.lemma/config.json` servers[active].token; body {connector_id, auth_config_id}.
- **Models:** minimax-m3 (default) loops on empty tool data; deepseek-v4-pro too slow; use
  **kimi-k2.7-code**. (Claude via API key possible but not set up; kimi works well + free.)
- **JSON to CLI on Windows:** write a file and use `--file` (PowerShell mangles inline JSON;
  Out-File adds a BOM — use bash `printf` or Write tool to avoid BOM).
- Reading record JSON: decode with utf-8-sig to strip BOM.

## 9. Done (build order)
1. ✅ Pod + 4 datastores
2. ✅ parser_scorer (profile/resume-aware, kimi)
3. ✅ score_match function
4. ✅ Operator board (kanban)
5. ✅ Resume-improvement loop
6. ✅ outreach_writer + human-approval flow (Generate→Approve→Send)
7. ✅ send_email function + Gmail OAuth (Composio) — Gmail CONNECTED, ready to test a real send

## 10. Next / pending
- [ ] **Test a real send** end-to-end (recipient = own email) now that Gmail is connected.
- [ ] **Calendar:** swap calendar auth-config to COMPOSIO, add a function/agent to create events
      for interviews/follow-ups (when calendar_write granted).
- [ ] **status_transition function** — validate stage moves + auto-set follow_up_date.
- [ ] **follow_up cron** — daily nudges for applications past follow_up_date.
- [ ] **Stretch:** inbound email (Gmail surface) → auto-update status; React rewrite of the board
      (decided: AFTER core features); narrow Gmail scope via custom OAuth (optional, low priority).
- [ ] Clean up any stale/test application rows before the demo; record the demo video (see
      ARCHITECTURE.md §13 demo script).

## 11. Judging reminders
35% problem clarity · 25% product judgment · 25% execution (working core loop) · 15% SDK use.
Working narrow loop > ambitious broken one. Submission June 30 = problem + approach + screen
recording + team details.
