import { useRef, useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field, fuRow, fuState } from "../../lib/helpers.js";
import { TABLE } from "../../lib/constants.js";
import { pollFollowup, pollFollowupField, gmailAuthUrl, getResume, getProfile } from "../../lib/data.js";
import { agentContextBlock } from "../../lib/prompt.js";

// Follow-up panel: shown only when a followups row exists for this application.
// Lets the user mark done, draft/edit/regenerate, and send the follow-up via Gmail.
export default function FollowupSection({ r, id, getContact }) {
  const { client, followups, reload, gmail } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {spin,text} | {html} | {edit:true}
  const editRef = useRef(null);
  const noteRef = useRef(null);
  const dateRef = useRef(null);

  const f = fuRow(followups, r);
  if (!f) return null;
  const fid = field(f, "id");

  const fu = field(f, "follow_up_date");
  const done = field(f, "is_followup_sent") === true;
  const reminded = field(f, "followup_alarm_sent") === true;
  const fs = fuState(followups, r);
  const due = fs === "today" || fs === "overdue";
  const draft = field(f, "followup_message");
  const subj = field(f, "followup_subject");
  const lbl = done
    ? "✓ Followed up"
    : fs === "today"
    ? "Due today"
    : fs === "overdue"
    ? "Overdue"
    : fu
    ? "Due " + String(fu).slice(0, 10)
    : "—";

  function setText(text, spin = false) {
    setStatus({ spin, text });
  }

  async function markDone() {
    setBusy(true);
    try {
      await client.records.update("followups", fid, { is_followup_sent: true });
      await reload();
      setStatus(null);
    } catch (e) {
      alert("Failed: " + (e && e.message));
    }
    setBusy(false);
  }

  // Re-open a completed follow-up so the user can send ANOTHER one (fresh clock,
  // blank draft). Keeps the option available even after they've already followed up.
  async function followAgain() {
    setBusy(true);
    try {
      await client.records.update("followups", fid, {
        is_followup_sent: false,
        followup_alarm_sent: false,
        followup_message: "",
        followup_subject: "",
      });
      await reload();
      setStatus(null);
    } catch (e) {
      alert("Failed: " + (e && e.message));
    }
    setBusy(false);
  }

  async function draftFn() {
    setBusy(true);
    setText("Drafting a follow-up to the recruiter… (~30–60s)", true);
    const old = String(field(f, "followup_message") || "");
    // Embed resume + profile up front so the agent makes NO read calls — one write only.
    const [resume, profile] = await Promise.all([
      getResume(client, field(r, "resume_id")),
      getProfile(client),
    ]);
    const stage = String(field(f, "stage") || field(r, "status") || "applied");
    const msg =
      "Draft a follow-up email to the recruiter. ALL context you need is provided below — do NOT " +
      "read any tables. Update ONLY the followups row id=" +
      fid +
      " with followup_subject and followup_message, using a SINGLE update. If there is no " +
      "contact_name, greet with 'Hello team,'. Never send.\n\n" +
      "=== FOLLOW-UP STAGE ===\nstage: " +
      stage +
      "\nWrite the follow-up appropriately for THIS stage (see your stage playbook).\n\n" +
      agentContextBlock(r, resume, profile);
    try {
      await client.agents.run("follow-up-agent", msg);
      const ok = await pollFollowup(client, field(r, "id"), old, 90000);
      if (ok) {
        await reload();
        setStatus(null);
      } else {
        setText("Still working — close and reopen the card in a moment to see the draft.");
      }
    } catch (e) {
      setText("Failed: " + ((e && e.message) || "error"));
    }
    setBusy(false);
  }

  // Save the manually-picked date + the context note. If a note is present, the
  // followup_scheduler agent reads it and, when it finds a date in there, OVERRIDES the
  // saved date with it (and shows it in the calendar). Any date change re-arms the alarm.
  async function saveSchedule() {
    setBusy(true);
    const manualDate = dateRef.current ? dateRef.current.value : "";
    const note = noteRef.current ? noteRef.current.value : "";
    const curDate = String(fu || "").slice(0, 10);
    try {
      // 1) Persist the note + the manual date (baseline the agent can keep or override).
      const base = { notes: note };
      if (manualDate && manualDate !== curDate) {
        base.follow_up_date = manualDate;
        base.date_reason = "Set manually.";
        base.followup_alarm_sent = false;
      }
      await client.records.update("followups", fid, base);

      // 2) If there's context, let the scheduler derive a date from it (may override).
      if (note.trim()) {
        setText("Reading your context to set the follow-up date… (~15–30s)", true);
        const today = new Date().toISOString().slice(0, 10);
        const stage = String(field(f, "stage") || field(r, "status") || "applied");
        const jd = String(field(r, "jd_text") || "").slice(0, 1200);
        const seedDate = base.follow_up_date || curDate;
        const before = seedDate; // poll for any change away from this
        const msg =
          "Pick the follow-up date for followups id=" +
          fid +
          ". ALL context is below — do NOT read any tables. Update ONLY this followups row with " +
          "follow_up_date (YYYY-MM-DD) and date_reason, using a SINGLE update.\n\n" +
          "=== TODAY ===\n" + today +
          "\n\n=== STAGE ===\n" + stage +
          "\n\n=== CONTEXT NOTE ===\n" + (note || "(none)") +
          "\n\n=== CURRENT FOLLOW-UP DATE ===\n" + (seedDate || "(none)") +
          "\n\n" + (jd ? "=== JOB DESCRIPTION ===\n" + jd + "\n" : "");
        try {
          await client.agents.run("followup_scheduler", msg);
          // The agent may keep the same date (no date in context) — wait briefly either way.
          await pollFollowupField(client, field(r, "id"), "date_reason", String(field(f, "date_reason") || ""), 60000);
          try {
            await client.records.update("followups", fid, { followup_alarm_sent: false });
          } catch (e) {
            /* ignore */
          }
        } catch (e) {
          /* fall through to reload with whatever we have */
        }
      }

      const fresh = await reload();
      setStatus(null);
      const nf = fresh && fresh.followups && fresh.followups[field(r, "id")];
      const nd = nf ? String(field(nf, "follow_up_date") || "").slice(0, 10) : manualDate;
      window.alert(
        nd ? "Saved. You'll be reminded to follow up on " + nd + "." : "Context note saved."
      );
    } catch (e) {
      setStatus(null);
      alert("Save failed: " + (e && e.message));
    }
    setBusy(false);
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await client.records.update("followups", fid, { followup_message: editRef.current.value });
      await reload();
      setStatus(null);
    } catch (e) {
      alert("Save failed: " + (e && e.message));
    }
    setBusy(false);
  }

  async function send() {
    setBusy(true);
    const { cemail, cname } = getContact();
    if (!cemail) {
      setText("Add a recruiter email in the field below, then Send.");
      setBusy(false);
      return;
    }
    // Pre-open the popup inside the click gesture so we can later redirect it to
    // Google's consent screen. NOTE: do not pass `noopener` — it makes window.open
    // return null, leaving an orphaned about:blank window we can neither navigate
    // nor close.
    const authWin =
      gmail.connected === true
        ? null
        : window.open("about:blank", "gmailAuth", "popup,width=520,height=640");
    setText("Saving recipient & sending follow-up via Gmail… (up to ~60s)", true);
    try {
      await client.records.update(TABLE, id, { contact_email: cemail, contact_name: cname });
      const res = await client.functions.run("send_followup", { input: { followup_id: fid } });
      const out = (res && (res.output_data || res.result || res.data)) || res;
      if (out && out.status === "sent") {
        gmail.connected = true;
        if (authWin) authWin.close();
        await reload();
        setStatus(null);
        setBusy(false);
      } else if (out && out.status === "needs_auth") {
        setText("Opening Google authorization…", true);
        const url = await gmailAuthUrl(client);
        if (url) {
          if (authWin && !authWin.closed) {
            authWin.location = url;
          } else {
            setStatus({
              html: (
                <>
                  Popup was blocked.{" "}
                  <a href={url} target="_blank" rel="noopener" className="btn primary">
                    Open Google authorization
                  </a>
                  <br />
                  Approve access, then click <b>Send follow-up</b> again.
                </>
              ),
            });
            setBusy(false);
            return;
          }
        } else {
          if (authWin) authWin.close();
          setText("Couldn't start Google authorization. Try again.");
          setBusy(false);
          return;
        }
        setStatus({
          html: (
            <>
              Approve Gmail access in the opened window, then click <b>Send follow-up</b> again.
            </>
          ),
        });
        setBusy(false);
      } else {
        if (authWin) authWin.close();
        setText("Couldn't send: " + ((out && out.message) || "unknown error"));
        setBusy(false);
      }
    } catch (e) {
      if (authWin) authWin.close();
      setText("Send failed: " + ((e && e.message) || "error"));
      setBusy(false);
    }
  }

  return (
    <div>
      <label style={{ marginTop: 0 }}>
        Follow-up{field(f, "stage") ? " · " + field(f, "stage") : ""}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
          {lbl}
          {reminded && !done ? " · reminder emailed" : ""}
        </span>
        {!done && (
          <button className="btn" onClick={markDone} disabled={busy}>
            Mark as followed up
          </button>
        )}
      </div>

      {!done && (
        <div style={{ marginTop: "0.7rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                color: "var(--muted)",
                fontSize: "0.8rem",
                textTransform: "none",
                letterSpacing: "normal",
              }}
            >
              Follow up on
            </span>
            <input
              type="date"
              ref={dateRef}
              key={String(fu)}
              defaultValue={String(fu || "").slice(0, 10)}
              disabled={busy}
            />
          </div>
          {field(f, "date_reason") && (
            <div style={{ color: "var(--muted)", fontSize: "0.78rem", marginTop: "0.3rem" }}>
              {field(f, "date_reason")}
            </div>
          )}
          <textarea
            ref={noteRef}
            defaultValue={String(field(f, "notes") || "")}
            placeholder="Paste any recruiter reply or note here (e.g. 'they said they'll decide by July 10'). On Save, if it mentions a date, that date overrides the calendar above."
            style={{ marginTop: "0.45rem", minHeight: "3rem", width: "100%" }}
            disabled={busy}
          />
          <div className="row2">
            <button className="btn primary" onClick={saveSchedule} disabled={busy}>
              Save date & context
            </button>
          </div>
        </div>
      )}
      {!done ? (
        <>
          {draft ? (
            <>
              {subj && <div style={{ fontWeight: 700, margin: "0.6rem 0 0.35rem" }}>{subj}</div>}
              <div
                className="val"
                style={{
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  padding: "0.7rem",
                }}
              >
                {draft}
              </div>
              <div className="row2">
                <button className="btn primary" onClick={send} disabled={busy}>
                  Send follow-up to recruiter
                </button>
                <button
                  className="btn"
                  onClick={() => setStatus({ edit: true })}
                  disabled={busy}
                >
                  Edit
                </button>
                <button className="btn" onClick={draftFn} disabled={busy}>
                  Regenerate
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginTop: "0.6rem", color: "var(--muted)", fontSize: "0.86rem" }}>
                {due
                  ? "No reply yet? Draft a follow-up to the recruiter."
                  : "Want to reach out again? Draft a follow-up to the recruiter."}
              </div>
              <div className="row2">
                <button className="btn primary" onClick={draftFn} disabled={busy}>
                  Draft follow-up to recruiter
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        // Already followed up — but always let the user send another one.
        <div style={{ marginTop: "0.6rem" }}>
          <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginBottom: "0.4rem" }}>
            Need to nudge them again?
          </div>
          <div className="row2">
            <button className="btn" onClick={followAgain} disabled={busy}>
              Follow up again
            </button>
          </div>
        </div>
      )}
      <div style={{ marginTop: "0.6rem", color: "var(--muted)", fontSize: "0.82rem" }}>
        {status?.edit ? (
          <>
            <textarea ref={editRef} defaultValue={String(field(f, "followup_message") || "")} autoFocus />
            <button
              className="btn primary"
              style={{ marginTop: "0.5rem" }}
              onClick={saveEdit}
              disabled={busy}
            >
              Save draft
            </button>
          </>
        ) : status?.html ? (
          status.html
        ) : status ? (
          <>
            {status.spin && <span className="spin" />} {status.text}
          </>
        ) : null}
      </div>
    </div>
  );
}
