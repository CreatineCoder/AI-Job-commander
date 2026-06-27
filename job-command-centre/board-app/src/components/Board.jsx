import { field } from "../lib/helpers.js";
import { STAGES } from "../lib/constants.js";
import Column from "./Column.jsx";

export default function Board({ rows, followups, onOpen }) {
  const byStage = {};
  STAGES.forEach((s) => (byStage[s.k] = []));
  rows.forEach((r) => {
    const st = field(r, "status") || "applied";
    (byStage[st] || (byStage[st] = [])).push(r);
  });

  return (
    <div className="board">
      {STAGES.map((s) => {
        const list = (byStage[s.k] || [])
          .slice()
          .sort(
            (a, b) =>
              (Number(field(b, "match_score")) || 0) - (Number(field(a, "match_score")) || 0)
          );
        return <Column key={s.k} stage={s} list={list} followups={followups} onOpen={onOpen} />;
      })}
    </div>
  );
}
