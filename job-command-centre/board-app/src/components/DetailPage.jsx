import { useState } from "react";
import { useApp } from "../AppContext.jsx";
import { field, asArray, scoreColor, fuRow, fuState } from "../lib/helpers.js";
import { STAGES, TABLE } from "../lib/constants.js";
import { deleteApplication } from "../lib/data.js";
import OutreachSection from "./detail/OutreachSection.jsx";
import FollowupSection from "./detail/FollowupSection.jsx";
import ResumeImproveSection from "./detail/ResumeImproveSection.jsx";

export default function DetailPage({ id, onBack }) {
  const { client, rows, followups, reload } = useApp();
  const r = rows.filter((x) => String(field(x, "id")) === String(id))[0];

  const [stg, setStg] = useState(() => (r ? field(r, "status") : ""));
  const [sub, setSub] = useState(() => (r ? field(r, "sub_status") || "" : ""));
  const [cname, setCname] = useState(() => (r ? field(r, "contact_name") || "" : ""));
  const [cemail, setCemail] = useState(() => (r ? field(r, "contact_email") || "" : ""));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!r) {
    return (
      <div className="wrap">
        <div className="page detail">
          <div className="pagebar">
            <button className="back" onClick={onBack}>
              ← Back to board
            </button>
          </div>
          <p style={{ color: "var(--muted)" }}>This job no longer exists.</p>
        </div>
      </div>
    );
  }

  const getContact = () => ({ cemail: cemail.trim(), cname: cname.trim() });

  const skills = asArray(field(r, "must_have_skills"));
  const topics = asArray(field(r, "suggested_topics"));
  const sc = field(r, "match_score");
  const hasScore = sc != null && sc !== "";
  const hasDetails =
    skills.length > 0 || topics.length > 0 || field(r, "resume_gaps") || field(r, "next_action");

  const stageObj = STAGES.find((s) => s.k === field(r, "status"));
  const f = fuRow(followups, r);
  const fs = fuState(followups, r);
  const fuLabel = f && field(f, "follow_up_date") ? String(field(f, "follow_up_date")).slice(0, 10) : null;

  async function save() {
    setSaving(true);
    const stageChanged = stg !== field(r, "status");
    try {
      await client.records.update(TABLE, id, {
        status: stg,
        sub_status: sub,
        contact_name: cname,
        contact_email: cemail,
      });
      if (stageChanged) {
        try {
          await client.functions.run("schedule_followup", {
            input: { application_id: id, stage: stg },
          });
        } catch (e) {
          /* non-fatal: the stage save already succeeded */
        }
      }
      await reload();
      onBack();
    } catch (e) {
      alert("Save failed: " + (e && e.message));
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm("Delete this application?")) return;
    setDeleting(true);
    try {
      await deleteApplication(client, id);
      await reload();
      onBack();
    } catch (e) {
      alert("Delete failed: " + (e && e.message));
      setDeleting(false);
    }
  }

  return (
    <div className="wrap">
      <div className="page detail">
        <div className="pagebar">
          <button className="back" onClick={onBack}>
            ← Back to board
          </button>
        </div>

        {/* Hero */}
        <div className="hero">
          <div className="hero-id">
            <div className="eyebrow">{stageObj ? stageObj.label : field(r, "status")}</div>
            <h2>{field(r, "company") || "—"}</h2>
            <div className="ro2">{field(r, "role") || ""}</div>
          </div>
          {hasScore && (
            <div className="metric">
              <div className="metric-n" style={{ color: scoreColor(sc) }}>
                {sc}
              </div>
              <div className="metric-l">match / 100</div>
            </div>
          )}
        </div>

        {/* Meta row */}
        <div className="metarow">
          {stageObj && (
            <span className="tag">
              <span className="dot" style={{ background: stageObj.c }} /> {stageObj.label}
            </span>
          )}
          {field(r, "sub_status") && <span className="tag">{field(r, "sub_status")}</span>}
          {fuLabel && (
            <span className={"tag" + (fs === "today" ? " today" : fs === "overdue" ? " overdue" : "")}>
              ⏰ {fs === "today" ? "Follow up today" : fs === "overdue" ? "Overdue" : "Due " + fuLabel}
            </span>
          )}
          {field(r, "contact_email") && (
            <span className="tag">✉ {field(r, "contact_email")}</span>
          )}
        </div>

        {/* Dashboard grid */}
        <div className="dash">
          <div className="dash-main">
            {hasDetails && (
              <div className="panel">
                <div className="panel-title">Role details</div>
                {skills.length > 0 && (
                  <>
                    <label>Required skills</label>
                    <div className="chips">
                      {skills.map((s, i) => (
                        <span className="tag" key={i}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {field(r, "resume_gaps") && (
                  <>
                    <label>Resume gaps</label>
                    <div className="val">{field(r, "resume_gaps")}</div>
                  </>
                )}
                {topics.length > 0 && (
                  <>
                    <label>Prep while you wait</label>
                    <div className="chips">
                      {topics.map((s, i) => (
                        <span className="tag" key={i}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {field(r, "next_action") && (
                  <>
                    <label>Next action</label>
                    <div className="val">{field(r, "next_action")}</div>
                  </>
                )}
              </div>
            )}

            <div className="panel">
              <OutreachSection r={r} id={id} getContact={getContact} />
            </div>

            {f && (
              <div className="panel">
                <FollowupSection r={r} id={id} getContact={getContact} />
              </div>
            )}

            {field(r, "jd_text") && (
              <div className="panel">
                <div className="panel-title">Job description</div>
                <div className="val" style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                  {field(r, "jd_text")}
                </div>
              </div>
            )}
          </div>

          <aside className="dash-side">
            <div className="panel sticky">
              <div className="panel-title">Manage</div>

              <label style={{ marginTop: 0 }}>Stage</label>
              <select value={stg} onChange={(e) => setStg(e.target.value)}>
                {STAGES.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.label}
                  </option>
                ))}
              </select>

              <label>Sub-status</label>
              <input
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                placeholder="e.g. round_1, test"
              />

              <label>
                Recruiter name{" "}
                <span style={{ textTransform: "none", color: "var(--muted)" }}>(optional)</span>
              </label>
              <input
                value={cname}
                onChange={(e) => setCname(e.target.value)}
                placeholder="Recruiter / referral name"
              />

              <label>Recruiter email</label>
              <input
                value={cemail}
                onChange={(e) => setCemail(e.target.value)}
                placeholder="name@company.com"
              />

              <div className="row2">
                <button className="btn primary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button className="btn danger" onClick={del} disabled={deleting}>
                  Delete
                </button>
              </div>
            </div>

            <div className="panel">
              <ResumeImproveSection r={r} id={id} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
