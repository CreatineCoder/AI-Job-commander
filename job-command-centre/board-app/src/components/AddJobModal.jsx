import { useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { useApp } from "../AppContext.jsx";
import { AGENT } from "../lib/constants.js";
import { pollNew } from "../lib/data.js";

export default function AddJobModal({ onClose }) {
  const { client, rows, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { spin, text }
  const rzRef = useRef(null);
  const jdRef = useRef(null);

  async function submit() {
    const jd = jdRef.current.value.trim();
    if (!jd) {
      jdRef.current.focus();
      return;
    }
    const rz = rzRef.current.value.trim();
    setBusy(true);
    setStatus({ spin: true, text: "Sending to the agent… this can take ~30–60s." });
    const before = rows.length;
    try {
      const msg = rz
        ? "Add this job. Store this resume as a new resume_data row, then parse the JD, score this resume against it, list gaps, suggest prep topics, and create the application row linked via resume_id.\n\nRESUME:\n" +
          rz +
          "\n\nJOB DESCRIPTION:\n" +
          jd
        : "Add this job. Use my default resume_data row (is_default = true) as the resume — do not ask me for one. Parse the JD, score that resume against it, list gaps, suggest prep topics, and create the application row linked via resume_id.\n\nJOB DESCRIPTION:\n" +
          jd;
      await client.agents.run(AGENT, msg);
      setStatus({ spin: true, text: "Agent is parsing & scoring…" });
      const found = await pollNew(client, before, 90000);
      if (found) {
        await reload();
        onClose();
      } else {
        setStatus({ spin: false, text: "Still working — it may appear shortly. Close and refresh in a moment." });
        setBusy(false);
      }
    } catch (e) {
      setStatus({ spin: false, text: "Failed: " + ((e && e.message) || "error") });
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>Add a job</h2>
      <div className="ro2">
        Paste the resume you're applying with and the job description. The agent stores the resume,
        scores fit, and creates the card.
      </div>
      <label>
        Resume{" "}
        <span style={{ textTransform: "none", color: "var(--muted)" }}>
          (leave blank to use your Base Resume)
        </span>
      </label>
      <textarea ref={rzRef} placeholder="Paste the resume text for this application…" />
      <label>Job description</label>
      <textarea ref={jdRef} placeholder="Paste the full job description here…" />
      <div className="row2">
        <button className="btn primary" onClick={submit} disabled={busy}>
          Parse &amp; add
        </button>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      {status && (
        <div style={{ marginTop: "0.9rem", color: "var(--muted)", fontSize: "0.82rem" }}>
          {status.spin && <span className="spin" />} {status.text}
        </div>
      )}
    </Modal>
  );
}
