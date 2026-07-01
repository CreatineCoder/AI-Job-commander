import { useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field, asArray } from "../../lib/helpers.js";
import { pollChange } from "../../lib/data.js";

// Per-stage copy for the heading + intro + empty-state.
const STAGE_COPY = {
  screening: {
    label: "Screening prep",
    blurb: "Get ready for the recruiter / screening call for this role.",
    cta: "Generate screening prep",
  },
  interview: {
    label: "Interview prep",
    blurb: "STAR stories from your resume, likely questions, gaps to be ready for, and what to research.",
    cta: "Generate interview prep",
  },
  offer: {
    label: "Offer prep",
    blurb: "Evaluate the offer, prepare negotiation points, and the questions to ask before deciding.",
    cta: "Generate offer prep",
  },
};
function copyFor(stage) {
  return STAGE_COPY[stage] || {
    label: "Preparation",
    blurb: "Get a tailored preparation pack for this stage.",
    cta: "Generate preparation",
  };
}

function parsePrep(v) {
  let t = v;
  if (typeof t === "string") {
    try {
      t = JSON.parse(t);
    } catch (e) {
      return null;
    }
  }
  if (t && Array.isArray(t.sections)) {
    return { stage: t.stage || "", sections: t.sections };
  }
  // Back-compat: older {star, watch_outs, research} shape → fold into sections.
  if (t && (Array.isArray(t.star) || Array.isArray(t.watch_outs) || Array.isArray(t.research))) {
    const sections = [];
    if (Array.isArray(t.star) && t.star.length) {
      sections.push({
        title: "STAR stories",
        items: t.star.map((s) =>
          [s.prompt, s.situation, s.task, s.action, s.result].filter(Boolean).join(" — ")
        ),
      });
    }
    if (Array.isArray(t.watch_outs) && t.watch_outs.length)
      sections.push({ title: "Be ready for", items: t.watch_outs });
    if (Array.isArray(t.research) && t.research.length)
      sections.push({ title: "Research", items: t.research });
    return { stage: t.stage || "", sections };
  }
  return null;
}

// Inline context so the agent makes NO read calls — one write only.
function prepContext(r, stage) {
  const ln = (label, v) => {
    const s = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    return s ? label + ": " + s + "\n" : "";
  };
  let s = "=== STAGE ===\nstage: " + stage + "\n\n=== APPLICATION ===\n";
  s += ln("company", field(r, "company"));
  s += ln("role", field(r, "role"));
  s += ln("must_have_skills", asArray(field(r, "must_have_skills")));
  s += ln("resume_gaps", field(r, "resume_gaps"));
  const jd = field(r, "jd_text");
  if (jd) s += "\n=== JOB DESCRIPTION ===\n" + String(jd).slice(0, 1800) + "\n";
  return s;
}

// One-click, stage-aware preparation pack (screening / interview / offer).
export default function InterviewPrepSection({ r, id }) {
  const { client, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const stage = String(field(r, "status") || "");
  const copy = copyFor(stage);
  const prep = parsePrep(field(r, "interview_prep"));
  const stale = prep && prep.stage && prep.stage !== stage;

  async function generate() {
    setBusy(true);
    setStatus({ spin: true, text: "Building your " + copy.label.toLowerCase() + "… (~30–50s)" });
    const old = String(field(r, "interview_prep") || "");
    const msg =
      "Generate the stage preparation pack for application id: " +
      id +
      ". ALL context is provided below — do NOT read any tables. Set the `interview_prep` column on " +
      "the applications row id=" +
      id +
      " to a JSON object {stage, sections:[{title, items:[...]}]} tailored to the stage. Make " +
      "exactly ONE update; change nothing else.\n\n" +
      prepContext(r, stage);
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
      <label style={{ marginTop: 0 }}>{copy.label}</label>

      {prep && prep.sections.length > 0 ? (
        <>
          {stale && (
            <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: "0.4rem" }}>
              This prep was made for the <b>{prep.stage}</b> stage. Click below to refresh it for{" "}
              <b>{stage}</b>.
            </div>
          )}
          {prep.sections.map((sec, i) => (
            <div key={i} style={{ marginBottom: "0.6rem" }}>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.2rem" }}>
                {sec.title}
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {asArray(sec.items).map((it, j) => (
                  <li key={j} style={{ fontSize: "0.88rem", marginBottom: "0.2rem" }}>
                    {typeof it === "string" ? it : JSON.stringify(it)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="row2">
            <button
              className={stale ? "btn primary" : "btn"}
              onClick={generate}
              disabled={busy}
            >
              {stale ? "Regenerate for " + stage : "Regenerate"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginBottom: "0.5rem" }}>
            {copy.blurb}
          </div>
          <div className="row2">
            <button className="btn primary" onClick={generate} disabled={busy}>
              {copy.cta}
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
