import { field } from "../lib/helpers.js";
import Card from "./Card.jsx";

export default function Column({ stage, list, followups, onOpen }) {
  return (
    <div className="col">
      <h3>
        <span className="dot" style={{ background: stage.c }} />
        {stage.label}
        <span className="ct">{list.length}</span>
      </h3>
      {list.length === 0 ? (
        <div className="colempty">—</div>
      ) : (
        list.map((r) => (
          <Card key={field(r, "id")} r={r} followups={followups} onOpen={onOpen} />
        ))
      )}
    </div>
  );
}
