import { useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { useApp } from "../AppContext.jsx";
import { RESUME_EXTRACTOR, JD_PARSER, FIT_SCORER, TABLE } from "../lib/constants.js";
import { field, asArray } from "../lib/helpers.js";
import {
  pollNew,
  pollChange,
  countResumes,
  pollNewResume,
  getDefaultResume,
  uploadResumePdf,
} from "../lib/data.js";

// Distill a resume_data row into a compact summary for fit_scorer — just the
// signal it needs to judge skills, without shipping the full raw resume text again.
function resumeSummary(row) {
  const lines = [];
  const skills = asArray(field(row, "skills"));
  if (skills.length) lines.push("Skills: " + skills.join(", "));
  asArray(field(row, "projects")).forEach((p) => {
    if (!p) return;
    const o = typeof p === "string" ? { name: p } : p;
    lines.push("Project: " + [o.name, o.description, o.tech].filter(Boolean).join(" — "));
  });
  asArray(field(row, "work_experience")).forEach((w) => {
    if (!w) return;
    const o = typeof w === "string" ? { role: w } : w;
    lines.push("Experience: " + [o.role, o.company, o.duration, o.description].filter(Boolean).join(" — "));
  });
  asArray(field(row, "competitions")).forEach((c) => {
    if (c) lines.push("Competition: " + (typeof c === "string" ? c : JSON.stringify(c)));
  });
  const text = lines.join("\n");
  // Fall back to the raw text (trimmed) if we couldn't extract structured fields.
  return text || String(field(row, "raw_resume_text") || "").slice(0, 2500);
}

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
    const appsBefore = rows.length;
    try {
      // Stage A — run resume storage and JD parsing IN PARALLEL. Each is a focused,
      // single-turn agent, so the two heavy extraction steps overlap instead of queueing.
      setStatus({ spin: true, text: "Parsing the job & saving your resume (in parallel)…" });

      const resumeTask = (async () => {
        if (!rz) {
          // No resume pasted → fall back to the user's default resume version.
          return await getDefaultResume(client);
        }
        const rzBefore = await countResumes(client);
        await client.agents.run(
          RESUME_EXTRACTOR,
          "Store this resume as a new resume_data version row, extracting skills, projects, " +
            "experience and education. Make exactly one create call.\n\nRESUME:\n" + rz
        );
        return await pollNewResume(client, rzBefore, 90000);
      })();

      const jdTask = (async () => {
        await client.agents.run(
          JD_PARSER,
          "Parse this job description and create the applications shell row (company, role, " +
            "must_have_skills, jd_text, status='applied', sub_status='resume_screen'). Do NOT " +
            "score or set match_score/resume_id.\n\nJOB DESCRIPTION:\n" + jd
        );
        return await pollNew(client, appsBefore, 90000);
      })();

      const [resumeRow, appRow] = await Promise.all([resumeTask, jdTask]);

      if (!appRow || !field(appRow, "id")) {
        setStatus({ spin: false, text: "Couldn't create the job card — try again in a moment." });
        setBusy(false);
        return;
      }
      const appId = field(appRow, "id");
      const resumeId = resumeRow ? field(resumeRow, "id") : "";

      // Stage B — score fit and fill in the row. Context is inlined (must-haves + a
      // distilled resume), so fit_scorer makes just two calls: score_match + update.
      setStatus({ spin: true, text: "Scoring your fit against the role…" });
      const mustHaves = asArray(field(appRow, "must_have_skills")).join(", ");
      const summary = resumeRow ? resumeSummary(resumeRow) : "(no resume on file)";
      const oldScore = String(field(appRow, "match_score") || "");
      await client.agents.run(
        FIT_SCORER,
        "Score fit and update the application row. application id: " + appId +
          ". resume_id: " + (resumeId || "(none)") +
          ". Judge each required skill against the resume, call score_match, then update ONLY " +
          "match_score, resume_gaps, suggested_topics, next_action and resume_id on that row.\n\n" +
          "must_have_skills: " + mustHaves + "\n\nRESUME:\n" + summary
      );
      await pollChange(client, appId, "match_score", oldScore, 90000);

      // Link the uploaded PDF so it can later be emailed as a CV link.
      if (resumePath) {
        try {
          await client.records.update(TABLE, appId, { resume_file: resumePath });
        } catch (e) {
          /* non-fatal */
        }
      }
      await reload();
      onClose();
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
