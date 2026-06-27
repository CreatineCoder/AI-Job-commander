import { useState } from "react";
import { field, fuState } from "../lib/helpers.js";

// Alert banner summarizing follow-ups due today / overdue. Dismissable for the session.
export default function FollowupBanner({ rows, followups }) {
  const [dismissed, setDismissed] = useState(false);

  const dueToday = rows.filter((r) => fuState(followups, r) === "today");
  const overdue = rows.filter((r) => fuState(followups, r) === "overdue");

  if (dismissed || (!dueToday.length && !overdue.length)) return null;

  const lead = dueToday[0] || overdue[0];
  const leadName = (lead && (field(lead, "company") || "")) || "";
  const others = dueToday.length + overdue.length > 1;

  return (
    <div className="fubanner">
      ⏰{" "}
      <span>
        Follow-ups:{" "}
        {dueToday.length > 0 && (
          <>
            <b>{dueToday.length}</b> due today
          </>
        )}
        {dueToday.length > 0 && overdue.length > 0 && " · "}
        {overdue.length > 0 && (
          <>
            <b>{overdue.length}</b> overdue
          </>
        )}
        . {leadName}
        {others ? " and others" : ""} need a nudge.
      </span>
      <button className="x" title="Dismiss" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
