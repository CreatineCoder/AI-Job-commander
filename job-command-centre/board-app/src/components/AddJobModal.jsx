import { useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { useApp } from "../AppContext.jsx";
import { AGENT, TABLE } from "../lib/constants.js";
import { field } from "../lib/helpers.js";
import { pollNew, uploadResumePdf } from "../lib/data.js";

export default function AddJobModal({ onClose }) {
  const { client, rows, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { spin, text }
  const [resumePath, setResumePath] = useState(""); // uploaded PDF path, if any
  const rzRef = useRef(null);
  const jdRef = useRef(null);

  // Upload a resume PDF → Lemma auto-extracts text → fill the resume box.
  async function onPdf(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    setStatus({ spin: true, text: "Uploading & extracting text from your PDF…" });
    try {
      const { path, text } = await uploadResumePdf(client, file);
      setResumePath(path);
      if (text) {
        rzRef.current.value = text;
        setStatus({ spin: false, text: "Extracted resume text ✓ — review below, then add the job." });
      } else {
        setStatus({
          spin: false,
          text: "Uploaded, but couldn't read text yet. You can paste the resume text manually.",
        });
      }
    } catch (err) {
      setStatus({ spin: false, text: "Upload failed: " + ((err && err.message) || "error") });
    }
    setBusy(false);
  }

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
      const newRow = await pollNew(client, before, 90000);
      if (newRow) {
        // Link the uploaded PDF to the new application so it can be emailed as a CV link.
        if (resumePath && field(newRow, "id")) {
          try {
            await client.records.update(TABLE, field(newRow, "id"), { resume_file: resumePath });
          } catch (e) {
            /* non-fatal */
          }
        }
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
          (upload a PDF, paste text, or leave blank to use your Base Resume)
        </span>
      </label>
      <div style={{ marginBottom: "0.4rem" }}>
        <input type="file" accept="application/pdf" onChange={onPdf} disabled={busy} />
        {resumePath && (
          <span style={{ marginLeft: "0.5rem", color: "var(--muted)", fontSize: "0.78rem" }}>
            PDF attached — will be sent as a CV link.
          </span>
        )}
      </div>
      <textarea ref={rzRef} placeholder="Paste the resume text, or upload a PDF above…" />
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
