import { useRef, useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field, fuRow, fuState } from "../../lib/helpers.js";
import { TABLE } from "../../lib/constants.js";
import { pollFollowup, gmailAuthUrl } from "../../lib/data.js";

// Follow-up panel: shown only when a followups row exists for this application.
// Lets the user mark done, draft/edit/regenerate, and send the follow-up via Gmail.
export default function FollowupSection({ r, id, getContact }) {
  const { client, followups, reload, gmail } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {spin,text} | {html} | {edit:true}
  const editRef = useRef(null);

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

  async function draftFn() {
    setBusy(true);
    setText("Drafting a follow-up to the recruiter… (~30–60s)", true);
    const old = String(field(f, "followup_message") || "");
    const msg =
      "Draft a follow-up email to the recruiter for application record id: " +
      id +
      ". The followups record id is " +
      fid +
      ". Read that application, its linked resume_data (by resume_id) " +
      "and user_profile, then update ONLY that followups row by id with followup_subject and " +
      "followup_message. If the application has no contact_name, greet with 'Hello team,'. Never send.";
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
      {due && !done && (
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
                No reply yet? Draft a follow-up to the recruiter.
              </div>
              <div className="row2">
                <button className="btn primary" onClick={draftFn} disabled={busy}>
                  Draft follow-up to recruiter
                </button>
              </div>
            </>
          )}
        </>
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
