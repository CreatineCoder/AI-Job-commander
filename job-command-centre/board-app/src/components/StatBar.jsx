import { field } from "../lib/helpers.js";
import { STAGES } from "../lib/constants.js";

function Stat({ n, l }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

export default function StatBar({ rows, onAdd }) {
  const byStage = {};
  STAGES.forEach((s) => (byStage[s.k] = []));
  rows.forEach((r) => {
    const st = field(r, "status") || "applied";
    (byStage[st] || (byStage[st] = [])).push(r);
  });

  const total = rows.length;
  const active = rows.filter((r) => {
    const s = field(r, "status");
    return s !== "rejected";
  }).length;
  const scores = rows
    .map((r) => Number(field(r, "match_score")))
    .filter((n) => !isNaN(n));
  const avg = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : "—";
  const interviews = (byStage["interview"]?.length || 0) + (byStage["offer"]?.length || 0);

  return (
    <div className="bar">
      <Stat n={total} l="applications" />
      <Stat n={active} l="active" />
      <Stat n={avg} l="avg match" />
      <Stat n={interviews} l="interview+" />
      <button className="addbtn" onClick={onAdd}>
        + Add job
      </button>
    </div>
  );
}
