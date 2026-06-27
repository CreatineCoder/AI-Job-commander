# Job Command Centre — Build Progress (Session Log)

> Last updated: 2026-06-28. Hackathon: Gappy.AI / Lemma SDK. Builder: Devansh (solo).
> Deadline: **submit June 30** (~2 days left). Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md),
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
- **`followups`** (many) — dedicated follow-up tracking, decoupled from applications. Cols:
  `application_id` (FK→applications.id), `follow_up_date`, `is_followup_sent` (user actually did
  the follow-up → hides board alarm), `followup_alarm_sent` (reminder email dispatched → dedupe),
  `last_alarm_at`, `stage` (which pipeline stage the follow-up belongs to — added 2026-06-28).
  **Now MANY rows per application** (one per stage over time, not one) — created/reset by `send_email`
  on outreach AND by `schedule_followup` on stage change; superseded rows are closed
  (`is_followup_sent=true`). The board surfaces the single ACTIVE follow-up per app (prefers open,
  then newest). (Note: follow_up fields
  were REMOVED from `applications` — all follow-up state lives here now.)
  **The reminder/alarm email ALWAYS goes to `user_profile.email`** (it's a notification to the
  user themselves) — `run_followups` resolves that recipient; there is no per-application override.
  Also holds `followup_subject` + `followup_message` — the recruiter-facing follow-up draft.
- **Recruiter follow-up flow (added 2026-06-27):** when a follow-up is DUE, the card modal shows
  "Draft follow-up to recruiter" → agent **`follow-up-agent`** (kimi) drafts a short nudge to the
  recruiter into the followups row (greets by `contact_name`, or **"Hello team,"** if none) →
  review → "Send follow-up to recruiter" → function **`send_followup`** sends it to the
  application's `contact_email` via Gmail and sets `is_followup_sent=true` (clears the alarm).
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
  outreach_status=sent. Grant: connector "gmail" `connector.use` + applications r/w. Also stamps
  the new follow-up row with the application's current `stage`.
- **`send_followup`** — sends the drafted recruiter follow-up (from a followups row) via Gmail,
  marks `is_followup_sent=true`. Grant: followups r/w, applications r, connector "gmail".
- **`run_followups`** — daily digest of due/overdue follow-ups to `user_profile.email` (now shows
  the `[stage]` in each line). Driven by workflow `follow-up-daily` + schedule `follow-up-cron`.
- **`schedule_followup`** (added 2026-06-28) — called by the board on a stage change. For active
  stages (screening/interview/offer) it closes any open follow-ups for that app and creates a fresh
  one stamped with the new stage + due date (`FOLLOW_UP_DAYS`). Terminal/initial stages skipped.
  Grant: followups r/w only.

## 6. The board app — NOW A MODULAR REACT PROJECT (migrated 2026-06-28)
- **Source:** `job-command-centre/board-app/` (Vite + React 18 + plain CSS). NOT a pod resource
  dir, so `lemma pods import` ignores it. **Build:** `npm run build` (in board-app) bundles
  everything inlined into a single self-contained `apps/board/index.html` via
  `vite-plugin-singlefile`. The Lemma SDK is still loaded at RUNTIME from the pod host
  (`/public/sdk/lemma-client.js`, honoring `window.__LEMMA_CONFIG__`) — not bundled.
- **IMPORTANT:** `apps/board/index.html` is now a BUILD ARTIFACT — edit `board-app/src/`, then
  rebuild. Deploy is still the separate `lemma app deploy` step (see §8).
- **Structure:** `lib/` (constants, records.field, helpers, data: load/poll/gmail/delete,
  lemma SDK loader), `hooks/useTheme`, `components/` (Header, StatBar, FollowupBanner, Board,
  Column, Card, Modal, AddJobModal, DetailPage + detail/{Outreach,Followup,ResumeImprove}Section).
- Kanban by status; header stats (total/active/avg match/interview+).
- **Detail is now a full DASHBOARD PAGE** (not a modal): hash-routed (`#/job/<id>`, browser Back
  works), hero header + match-score metric, meta chips, two-column grid (main panels + sticky
  "Manage" sidebar). Add-job remains a modal.
- **Add job:** resume + JD textareas → calls `parser_scorer` via `client.agents.run`, polls for
  the new row.
- **Detail page panels:** required skills, gaps, prep topics, next action; editable stage,
  sub_status, contact_name, contact_email (Save). Changing stage → `schedule_followup`.
  Delete removes child `followups` rows first (FK), then the application.
- **Resume-improvement section:** "Have you made the fixes?" → paste updated resume →
  re-runs parser_scorer UPDATE mode → updates gaps + next_action only.
- **Outreach section:** Generate → review (Approve draft / Edit / Regenerate / Reject) →
  after approval a **Send email** button appears → calls `send_email`; on `needs_auth`
  auto-opens the Google consent tab; on success marks ✓ sent. Client constructed with
  `{timeoutMs:120000}` (connector ops are slow ~58s).
- Auto-seeds permissions rows on load (`ensurePermissions`).

## 7. Connectors / OAuth (status: Gmail CONNECTED ✅ — real send verified 2026-06-27)
- Gmail connected via **Composio** provider (`lemma connector status` shows gmail CONNECTED).
  Bound account: `creatineman2727@gmail.com`.
- Scope granted: `gmail.modify` (broad — Composio's shared Gmail connector). We only call
  GMAIL_SEND_EMAIL. Token held by Composio/Lemma; revocable at myaccount.google.com/permissions.
- ⚠️ **LEMMA provider gives redirect_uri_mismatch for Google — always use provider COMPOSIO.**
- Calendar auth-config still on LEMMA → will likely need the same COMPOSIO swap before use.

## 8. Key gotchas / workarounds (IMPORTANT for next session)
- **Always prefix shell with `$env:PYTHONIOENCODING='utf-8'`** and use `--json` for chat —
  the CLI crashes printing emojis/arrows on Windows cp1252. (Also patched select.py termios bug.)
- **Set default org/pod by UUID, not slug** (slug → "badly formed hexadecimal UUID string").
- **Deploy pipelines are separate (3 steps now):** (1) `cd board-app && npm run build` to
  regenerate `apps/board/index.html`; (2) `lemma pods import .` for tables/agents/functions;
  (3) `lemma app deploy devansh-job-command-centre ./apps/board/index.html --yes` for the board.
  Forgetting step 3 = the live board keeps serving old code (this bit us repeatedly).
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
- [x] **Test a real send** end-to-end — ✅ DONE 2026-06-27, email received. Sender Gmail account
      now `creatineman2727@gmail.com` (account id `019f0931-2f2b-74e6-b087-c9e5a3b320a0`). NOTE:
      a stale/revoked connected account threw `403 Forbidden` on send + `409 ACCOUNT_ALREADY_
      CONNECTED` on re-auth — fix is `lemma connector accounts delete <id> -y` then reconnect via
      the board's Send→needs_auth flow. The `user_email` field on a function-exec record is the
      Lemma LOGIN, not the Gmail sender (red herring).
- [ ] **Onboarding "Connections" screen (Option B, deferred):** after login show a one-time screen
      that requests every surface (Gmail, Calendar) upfront with Connect buttons + live ✓ status;
      keep lazy ask-on-Send as fallback. Backed by a small `connector_status` server function
      (`pod.connectors.accounts.list` per surface) so status is accurate after reloads. NOTE:
      login/signup already handled by Lemma hosted auth (`client.auth.redirectToAuth`) — do NOT
      build custom auth; this is a connections/onboarding feature, not an auth feature.
- [ ] **Calendar:** swap calendar auth-config to COMPOSIO, add a function/agent to create events
      for interviews/follow-ups (when calendar_write granted).
- [x] **Stage-change follow-ups** — ✅ DONE 2026-06-28. `schedule_followup` function + `stage`
      column on followups; board calls it on stage change (active stages only). Supersedes the
      older "status_transition" idea for the follow-up half. (Still open: hard *validation* of
      stage moves, if wanted.)
- [x] **React rewrite of the board** — ✅ DONE 2026-06-28. Modular Vite+React project in
      `board-app/`, builds to single-file `apps/board/index.html`. Detail view is now a dashboard
      page. Also fixed 3 bugs found during migration: (1) Gmail auth popup orphaned an `about:blank`
      window (caused by `noopener` making `window.open` return null); (2) Delete blocked by the
      followups FK (now deletes children first); (3) outreach/follow-up "30–60s" spinner never
      cleared on success (success paths now reset status/busy).
- [x] **follow_up cron** — ✅ DONE 2026-06-27. `send_email` now sets `follow_up_date = sent + 5d`
      (cols `last_followup_at` + BOOLEAN `is_followup_sent` default false added). Function
      `run_followups` (no LLM) finds apps due/overdue (outreach sent, not terminal,
      `is_followup_sent`!=true), sets `is_followup_sent=true` after sending, emails ONE digest to
      `user_profile.email` via Gmail, marks `last_followup_at`. Driven by workflow
      `follow-up-daily` (MANUAL start, single FUNCTION node) + schedule `follow-up-cron`
      (TIME cron `0 9 * * *`, active). Board shows a follow-up banner + per-card
      "Follow up today"/"Overdue" badges (pure client-side from follow_up_date). Verified
      end-to-end: real reminder sent + same-day dedupe works. (Gotcha: schedules target an
      agent/workflow, NOT a function — wrap the function in a workflow. SCHEDULED workflow start
      needs a config; using MANUAL start + the schedule resource for cron instead.)
- [ ] **Stretch:** inbound email (Gmail surface) → auto-update status; narrow Gmail scope via
      custom OAuth (optional, low priority).
- [ ] Clean up any stale/test application rows before the demo; record the demo video (see
      ARCHITECTURE.md §13 demo script).

### Immediate to-do (deploy + housekeeping — as of 2026-06-28)
- [ ] **DEPLOY — nothing above is live yet.** Backend then board:
      `lemma pods import .` (creates `schedule_followup`, updates `followups`), then
      `lemma app deploy devansh-job-command-centre ./apps/board/index.html --yes`. Hard-refresh.
- [ ] **Bump `FOLLOW_UP_DAYS` 0 → 5** in BOTH `functions/send_email/code.py` and
      `functions/schedule_followup/code.py` (currently 0 for testing = due immediately).
- [ ] **Commit everything** — the React project, fixes, and feature are all uncommitted.
- [ ] Delete stray `job-command-centre/package-lock.json` (leftover from a failed npm install;
      the real lockfile is in `board-app/`).

## 11. Judging reminders
35% problem clarity · 25% product judgment · 25% execution (working core loop) · 15% SDK use.
Working narrow loop > ambitious broken one. Submission June 30 = problem + approach + screen
recording + team details.
