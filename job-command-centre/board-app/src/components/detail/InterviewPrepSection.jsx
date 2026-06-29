import { useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field, asArray } from "../../lib/helpers.js";
import { pollChange } from "../../lib/data.js";

function parsePrep(v) {
  let t = v;
  if (typeof t === "string") {
    try {
      t = JSON.parse(t);
    } catch (e) {
      return null;
    }
  }
  if (t && (Array.isArray(t.star) || Array.isArray(t.watch_outs) || Array.isArray(t.research))) {
    return {
      star: Array.isArray(t.star) ? t.star : [],
      watch_outs: Array.isArray(t.watch_outs) ? t.watch_outs : [],
      research: Array.isArray(t.research) ? t.research : [],
    };
  }
  return null;
}

// Inline context so the agent makes NO read calls — one write only.
function prepContext(r) {
  const ln = (label, v) => {
    const s = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    return s ? label + ": " + s + "\n" : "";
  };
  let s = "=== APPLICATION ===\n";
  s += ln("company", field(r, "company"));
  s += ln("role", field(r, "role"));
  s += ln("must_have_skills", asArray(field(r, "must_have_skills")));
  s += ln("resume_gaps", field(r, "resume_gaps"));
  const jd = field(r, "jd_text");
  if (jd) s += "\n=== JOB DESCRIPTION ===\n" + String(jd).slice(0, 1800) + "\n";
  return s;
}

const cardStyle = {
  background: "var(--paper)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  padding: "0.7rem",
};

// One-click AI interview prep pack: STAR answer scaffolds + watch-outs + research.
export default function InterviewPrepSection({ r, id }) {
  const { client, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const prep = parsePrep(field(r, "interview_prep"));

  async function generate() {
    setBusy(true);
    setStatus({ spin: true, text: "Building your interview prep pack… (~30–50s)" });
    const old = String(field(r, "interview_prep") || "");
    const msg =
      "Generate the interview prep pack for application id: " +
      id +
      ". ALL context is provided below — do NOT read any tables. Set the `interview_prep` column on " +
      "the applications row id=" +
      id +
      " to a JSON object {star:[{prompt,situation,task,action,result}], watch_outs:[...], " +
      "research:[...]}. Make exactly ONE update; change nothing else.\n\n" +
      prepContext(r);
    try {
      await client.agents.run("interview_prep", msg);
      const ok = await pollChange(client, id, "interview_prep", old, 90000);
      if (ok) {
        await reload();
        setStatus(null);
      } else {
        setStatus({ text: "Still working — reopen the card shortly." });
      }
    } catch (e) {
      setStatus({ text: "Failed: " + ((e && e.message) || "error") });
    }
    setBusy(false);
  }

  return (
    <div>
      <label style={{ marginTop: 0 }}>Interview prep</label>

      {prep ? (
        <>
          {prep.star.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {prep.star.map((s, i) => (
                <div key={i} style={cardStyle}>
                  <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{s.prompt}</div>
                  {s.situation && (
                    <div style={{ fontSize: "0.88rem" }}>
                      <b>S:</b> {s.situation}
                    </div>
                  )}
                  {s.task && (
                    <div style={{ fontSize: "0.88rem" }}>
                      <b>T:</b> {s.task}
                    </div>
                  )}
                  {s.action && (
                    <div style={{ fontSize: "0.88rem" }}>
                      <b>A:</b> {s.action}
                    </div>
                  )}
                  {s.result && (
                    <div style={{ fontSize: "0.88rem" }}>
                      <b>R:</b> {s.result}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {prep.watch_outs.length > 0 && (
            <>
              <label>Be ready for</label>
              <ul style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem" }}>
                {prep.watch_outs.map((w, i) => (
                  <li key={i} style={{ fontSize: "0.88rem", marginBottom: "0.2rem" }}>
                    {w}
                  </li>
                ))}
              </ul>
            </>
          )}

          {prep.research.length > 0 && (
            <>
              <label>Research before the interview</label>
              <ul style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem" }}>
                {prep.research.map((w, i) => (
                  <li key={i} style={{ fontSize: "0.88rem", marginBottom: "0.2rem" }}>
                    {w}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="row2">
            <button className="btn" onClick={generate} disabled={busy}>
              Regenerate prep
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginBottom: "0.5rem" }}>
            Generate a tailored prep pack — STAR answer scaffolds from your resume, plus the gaps to
            be ready for and what to research about this company.
          </div>
          <div className="row2">
            <button className="btn primary" onClick={generate} disabled={busy}>
              Generate interview prep
            </button>
          </div>
        </>
      )}

      {status && (
        <div style={{ marginTop: "0.6rem", color: "var(--muted)", fontSize: "0.82rem" }}>
          {status.spin && <span className="spin" />} {status.text}
        </div>
      )}
    </div>
  );
}
