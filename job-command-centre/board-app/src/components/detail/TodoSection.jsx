import { useState } from "react";
import { useApp } from "../../AppContext.jsx";
import { field, asArray } from "../../lib/helpers.js";
import { TABLE } from "../../lib/constants.js";
import { pollChange } from "../../lib/data.js";

// Parse the `todos` column (object, JSON string, or legacy array) into {stage, items}.
function parseTodos(v) {
  let t = v;
  if (typeof t === "string") {
    try {
      t = JSON.parse(t);
    } catch (e) {
      return null;
    }
  }
  if (Array.isArray(t)) return { stage: "", items: t };
  if (t && Array.isArray(t.items)) return { stage: t.stage || "", items: t.items };
  return null;
}

// Inline context for the planner so it makes NO read calls — one write only.
function todoContext(r, stage) {
  const ln = (label, v) => {
    const s = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
    return s ? label + ": " + s + "\n" : "";
  };
  let s = "=== STAGE ===\nstage: " + stage + "\n\n=== APPLICATION ===\n";
  s += ln("company", field(r, "company"));
  s += ln("role", field(r, "role"));
  s += ln("must_have_skills", asArray(field(r, "must_have_skills")));
  s += ln("match_score", field(r, "match_score"));
  s += ln("resume_gaps", field(r, "resume_gaps"));
  s += ln("suggested_topics", asArray(field(r, "suggested_topics")));
  s += ln("contact_name", field(r, "contact_name"));
  const jd = field(r, "jd_text");
  if (jd) s += "\n=== JOB DESCRIPTION ===\n" + jd.slice(0, 1400) + "\n";
  return s;
}

// Stage-aware to-do checklist for an application. Generate via the todo_planner
// agent; toggling a checkbox persists back to the `todos` JSON column.
export default function TodoSection({ r, id }) {
  const { client, reload } = useApp();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const stage = String(field(r, "status") || "applied");
  const parsed = parseTodos(field(r, "todos"));
  const items = parsed ? parsed.items : [];
  const planned = parsed ? parsed.stage : "";
  const doneN = items.filter((it) => it && it.done).length;
  const stale = planned && planned !== stage;

  async function generate() {
    setBusy(true);
    setStatus({ spin: true, text: "Planning your to-dos for this stage… (~20–40s)" });
    const old = String(field(r, "todos") || "");
    const msg =
      "Plan a stage-specific to-do checklist for application id: " +
      id +
      ". ALL context is provided below — do NOT read any tables. Set the `todos` column on the " +
      "applications row id=" +
      id +
      " to a JSON object {stage, items:[{text,done:false}]} with 4–6 concrete actions for THIS " +
      "stage. Make exactly ONE update; change nothing else.\n\n" +
      todoContext(r, stage);
    try {
      await client.agents.run("todo_planner", msg);
      const ok = await pollChange(client, id, "todos", old, 60000);
      if (ok) {
        await reload();
        setStatus(null);
      } else {
        setStatus({ text: "Still planning — reopen the card shortly." });
      }
    } catch (e) {
      setStatus({ text: "Failed: " + ((e && e.message) || "error") });
    }
    setBusy(false);
  }

  async function toggle(i) {
    const next = {
      stage: planned || stage,
      items: items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)),
    };
    try {
      await client.records.update(TABLE, id, { todos: next });
      await reload();
    } catch (e) {
      alert("Couldn't update: " + (e && e.message));
    }
  }

  return (
    <div>
      <div className="panel-title">
        Action plan{planned ? " · " + planned : ""}
        {items.length > 0 && (
          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: "0.8rem" }}>
            {"  " + doneN + "/" + items.length + " done"}
          </span>
        )}
      </div>

      {items.length > 0 ? (
        <>
          {stale && (
            <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: "0.4rem" }}>
              This list was made for the <b>{planned}</b> stage. Regenerate for <b>{stage}</b>.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {items.map((it, i) => (
              <label
                key={i}
                // Reset the inherited `.page label` styles (uppercase/spacing/margin) and
                // use a 2-col grid so every checkbox and text line up in clean columns.
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1rem 1fr",
                  gap: "0.6rem",
                  alignItems: "start",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  lineHeight: 1.45,
                  textTransform: "none",
                  letterSpacing: "normal",
                  margin: 0,
                  color: "inherit",
                  opacity: it.done ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={!!it.done}
                  onChange={() => toggle(i)}
                  disabled={busy}
                  style={{ marginTop: "0.25rem", width: "1.1rem", height: "1.1rem" }}
                />
                <span style={{ textDecoration: it.done ? "line-through" : "none" }}>
                  {it.text}
                </span>
              </label>
            ))}
          </div>
          <div className="row2">
            <button className="btn" onClick={generate} disabled={busy}>
              Regenerate for {stage}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ color: "var(--muted)", fontSize: "0.86rem", marginBottom: "0.5rem" }}>
            Get a focused checklist of what to do at the <b>{stage}</b> stage to move this
            application forward.
          </div>
          <div className="row2">
            <button className="btn primary" onClick={generate} disabled={busy}>
              Generate action plan
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
