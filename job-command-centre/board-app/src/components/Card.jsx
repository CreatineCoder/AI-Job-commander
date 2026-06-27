import { field, fuRow, fuState, scoreColor } from "../lib/helpers.js";

export default function Card({ r, followups, onOpen }) {
  const id = field(r, "id");
  const sc = field(r, "match_score");
  const sub = field(r, "sub_status");
  const na = field(r, "next_action");
  const f = fuRow(followups, r);
  const fu = f && field(f, "follow_up_date");

  let fuTag = null;
  if (fu) {
    const fs = fuState(followups, r);
    const cls = fs === "today" ? " today" : fs === "overdue" ? " overdue" : "";
    const lbl =
      fs === "today" ? "Follow up today" : fs === "overdue" ? "Overdue" : String(fu).slice(0, 10);
    fuTag = (
      <>
        <span className={"tag" + cls}>⏰ {lbl}</span>
        {field(f, "is_followup_sent") === true ? (
          <span className="tag">✓ followed up</span>
        ) : field(f, "followup_alarm_sent") === true ? (
          <span className="tag">✓ reminded</span>
        ) : null}
      </>
    );
  }

  return (
    <div className="card" onClick={() => onOpen(String(id))}>
      <div className="co">{field(r, "company") || "—"}</div>
      <div className="ro">{field(r, "role") || ""}</div>
      <div className="meta">
        {sc != null && sc !== "" && (
          <span className="score" style={{ background: scoreColor(sc) }}>
            {sc}
          </span>
        )}
        {sub && <span className="tag">{sub}</span>}
        {fuTag}
      </div>
      {na && <div className="na">{na}</div>}
    </div>
  );
}
