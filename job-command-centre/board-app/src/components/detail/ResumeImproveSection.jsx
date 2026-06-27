import { useRef, useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field } from "../../lib/helpers.js";
import { AGENT } from "../../lib/constants.js";
import { pollChange } from "../../lib/data.js";

// "Have you updated your resume?" → re-runs the parser/scorer in UPDATE mode to
// re-check gaps and next action for this same application.
export default function ResumeImproveSection({ r, id }) {
  const { client, reload } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {spin,text}
  const taRef = useRef(null);

  async function recheck() {
    const nrz = (taRef.current.value || "").trim();
    if (!nrz) {
      taRef.current.focus();
      return;
    }
    setBusy(true);
    setStatus({ spin: true, text: "Re-evaluating against the job description…" });
    const oldGaps = String(field(r, "resume_gaps") || "");
    const jd = String(field(r, "jd_text") || "");
    const msg =
      "The operator has improved their resume for an EXISTING application — UPDATE mode, no new rows. " +
      "Application record id: " +
      id +
      ". Re-assess the updated resume against the job description and update ONLY " +
      "resume_gaps and next_action on that applications row by id. Do NOT create new rows and do NOT change " +
      "company, role, status, sub_status, match_score or resume_id.\n\nJOB DESCRIPTION:\n" +
      jd +
      "\n\nUPDATED RESUME:\n" +
      nrz;
    try {
      await client.agents.run(AGENT, msg);
      const ok = await pollChange(client, id, "resume_gaps", oldGaps, 90000);
      if (ok) {
        await reload();
        setStatus({ spin: false, text: "Updated — see the refreshed gaps and next action above." });
      } else {
        setStatus({
          spin: false,
          text: "Still working — close and reopen the card in a moment to see updated gaps.",
        });
      }
    } catch (e) {
      setStatus({ spin: false, text: "Failed: " + ((e && e.message) || "error") });
    }
    setBusy(false);
  }

  return (
    <div>
      <label style={{ marginTop: 0 }}>Resume improvements</label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: "0.86rem" }}>
          Have you made the suggested fixes to your resume?
        </span>
        {!open && (
          <button className="btn" onClick={() => setOpen(true)}>
            Yes, I updated it
          </button>
        )}
      </div>
      {open && (
        <div style={{ marginTop: "0.7rem" }}>
          <textarea
            ref={taRef}
            autoFocus
            placeholder="Paste your updated resume — the agent re-checks gaps for this same job…"
          />
          <div className="row2" style={{ marginTop: "0.5rem" }}>
            <button className="btn primary" onClick={recheck} disabled={busy}>
              Re-check gaps &amp; next action
            </button>
          </div>
          {status && (
            <div style={{ marginTop: "0.6rem", color: "var(--muted)", fontSize: "0.82rem" }}>
              {status.spin && <span className="spin" />} {status.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
