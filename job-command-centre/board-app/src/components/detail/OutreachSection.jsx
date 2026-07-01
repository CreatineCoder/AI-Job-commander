import { useRef, useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field } from "../../lib/helpers.js";
import { OUTREACH, TABLE } from "../../lib/constants.js";
import { pollChange, gmailAuthUrl, getResume, getProfile, signedFileUrl } from "../../lib/data.js";
import { agentContextBlock } from "../../lib/prompt.js";

// Outreach workflow: generate → review/approve → send a tailored recruiter email.
export default function OutreachSection({ r, id, getContact }) {
  const { client, reload, gmail } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {spin,text} | {html}
  const [editing, setEditing] = useState(false);
  const editRef = useRef(null);

  const os = field(r, "outreach_status") || "none";
  const hasDraft = !!field(r, "draft_message");

  function setText(text, spin = false) {
    setStatus({ spin, text });
  }

  async function gen() {
    setBusy(true);
    setText("Drafting the email… (~20–40s)", true);
    const oldDraft = String(field(r, "draft_message") || "");
    // Fetch the resume + profile up front and embed them, so the agent makes NO
    // read calls — it only does a single update (cuts ~3 LLM round-trips).
    const [resume, profile] = await Promise.all([
      getResume(client, field(r, "resume_id")),
      getProfile(client),
    ]);
    const msg =
      "EMAIL mode. Draft outreach for application id: " +
      id +
      ". ALL context you need is provided below — do NOT read any tables. Write email_subject and " +
      "draft_message (the recruiter email) and set outreach_status to 'drafted'. Do NOT write " +
      "cover_letter (it is generated separately). Persist with a SINGLE update to the applications " +
      "row id=" +
      id +
      " (do not change status, resume_id, or create new rows).\n\n" +
      agentContextBlock(r, resume, profile);
    try {
      await client.agents.run(OUTREACH, msg);
      const ok = await pollChange(client, id, "draft_message", oldDraft, 90000);
      if (ok) {
        await reload();
        setStatus(null);
      } else {
        setText("Still drafting — reopen the card shortly.");
      }
    } catch (e) {
      setText("Failed: " + ((e && e.message) || "error"));
    }
    setBusy(false);
  }

  // Cover letter is generated on demand (separate, slower call) — keeps the email fast.
  async function genCover() {
    setBusy(true);
    setText("Writing the cover letter… (~20–40s)", true);
    const oldCover = String(field(r, "cover_letter") || "");
    const [resume, profile] = await Promise.all([
      getResume(client, field(r, "resume_id")),
      getProfile(client),
    ]);
    const msg =
      "COVER_LETTER mode. Write ONLY the cover_letter for application id: " +
      id +
      ". ALL context is provided below — do NOT read any tables. Do NOT touch email_subject, " +
      "draft_message or outreach_status. Persist with a SINGLE update to the applications row id=" +
      id +
      ".\n\n" +
      agentContextBlock(r, resume, profile);
    try {
      await client.agents.run(OUTREACH, msg);
      const ok = await pollChange(client, id, "cover_letter", oldCover, 90000);
      if (ok) {
        await reload();
        setStatus(null);
      } else {
        setText("Still writing — reopen the card shortly.");
      }
    } catch (e) {
      setText("Failed: " + ((e && e.message) || "error"));
    }
    setBusy(false);
  }

  async function approve() {
    setBusy(true);
    try {
      await client.records.update(TABLE, id, { outreach_status: "approved" });
      await reload();
      setStatus(null);
    } catch (e) {
      setText("Failed: " + ((e && e.message) || "error"));
    }
    setBusy(false);
  }

  async function reject() {
    setBusy(true);
    try {
      await client.records.update(TABLE, id, {
        outreach_status: "none",
        draft_message: "",
        cover_letter: "",
        email_subject: "",
      });
      await reload();
      setStatus(null);
    } catch (e) {
      alert("Failed: " + (e && e.message));
    }
    setBusy(false);
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await client.records.update(TABLE, id, { draft_message: editRef.current.value });
      await reload();
      setEditing(false);
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
      setText("Add a recipient (contact email) in the field above, then click Send.");
      setBusy(false);
      return;
    }
    // Open a popup window in the click gesture so we can later redirect it to
    // Google's consent. NOTE: do not pass `noopener` — it makes window.open return
    // null, leaving an orphaned about:blank window we can neither navigate nor close.
    const authWin =
      gmail.connected === true
        ? null
        : window.open("about:blank", "gmailAuth", "popup,width=520,height=640");
    setText("Saving recipient & sending via Gmail… (can take up to ~60s)", true);
    try {
      await client.records.update(TABLE, id, { contact_email: cemail, contact_name: cname });
      // If a résumé PDF is stored, mint a signed link so the email carries the CV.
      const resumeUrl = await signedFileUrl(client, field(r, "resume_file"));
      const res = await client.functions.run("send_email", {
        input: { application_id: id, resume_url: resumeUrl },
      });
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
                  Approve access, then click <b>Send</b> again.
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
              Approve Gmail access in the opened window, then click <b>Send</b> again.
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

  const badge =
    os === "sent"
      ? "✓ sent"
      : os === "approved"
      ? "✓ approved — ready to send"
      : "awaiting your review";

  return (
    <div>
      <label style={{ marginTop: 0 }}>Outreach</label>
      {field(r, "email_subject") && (
        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{field(r, "email_subject")}</div>
      )}
      {hasDraft ? (
        <>
          <div
            className="val"
            style={{
              background: "var(--paper)",
              border: "1px solid var(--line)",
              borderRadius: "10px",
              padding: "0.7rem",
            }}
          >
            {field(r, "draft_message")}
          </div>
          {field(r, "cover_letter") && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "0.85rem" }}>
                Cover letter
              </summary>
              <div
                classNaestion on what we would be building as nme="val"
                style={{
                  marginTop: "0.4rem",
                  background: "var(--paper)",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  padding: "0.7rem",
                }}
              >
                {field(r, "cover_letter")}
              </div>
            </details>
          )}
          <div style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
            Status: {badge}
          </div>
          {os === "drafted" && (
            <div className="row2">
              <button className="btn primary" onClick={approve} disabled={busy}>
                Approve draft
              </button>
              <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>
              <button className="btn" onClick={gen} disabled={busy}>
                Regenerate
              </button>
              <button className="btn danger" onClick={reject} disabled={busy}>
                Reject
              </button>
            </div>
          )}
          {os === "approved" && (
            <div className="row2">
              <button className="btn primary" onClick={send} disabled={busy}>
                Send email
              </button>
              <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>
              <button className="btn" onClick={gen} disabled={busy}>
                Regenerate
              </button>
            </div>
          )}
          {os === "sent" && (
            <div className="row2">
              <button className="btn primary" onClick={send} disabled={busy}>
                Resend email
              </button>
              <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>
              <button className="btn" onClick={gen} disabled={busy}>
                Draft again
              </button>
            </div>
          )}
          {editing && (
            <div style={{ marginTop: "0.5rem" }}>
              <textarea ref={editRef} defaultValue={String(field(r, "draft_message") || "")} autoFocus />
              <button
                className="btn primary"
                style={{ marginTop: "0.5rem" }}
                onClick={saveEdit}
                disabled={busy}
              >
                Save draft
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginBottom: "0.5rem" }}>
            Generate a tailored recruiter email + cover letter for this role. You review and approve
            before anything is sent.
          </div>
          <div className="row2">
            <button className="btn primary" onClick={gen} disabled={busy}>
              Generate outreach
            </button>
          </div>
        </>
      )}
      {status && (
        <div style={{ marginTop: "0.6rem", color: "var(--muted)", fontSize: "0.82rem" }}>
          {status.html ? (
            status.html
          ) : (
            <>
              {status.spin && <span className="spin" />} {status.text}
            </>
          )}
        </div>
      )}
    </div>
  );
}
