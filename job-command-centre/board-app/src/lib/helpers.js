import { field } from "./records.js";

// Pull the named field out of a record, whether it's flat or nested under `data`.
export { field } from "./records.js";

// Normalize the various list-shaped responses the SDK can return into an array.
export function listOf(resp) {
  return (resp && (resp.items || resp.data)) || (Array.isArray(resp) ? resp : []);
}

export function scoreColor(n) {
  n = Number(n) || 0;
  return n >= 70 ? "#5c7a53" : n >= 45 ? "#c9a227" : "#a23b3b";
}

// Coerce a value that may be an array, a JSON-encoded array, or a scalar into an array.
export function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [v];
    } catch (e) {
      return v ? [v] : [];
    }
  }
  return [];
}

export function todayISO() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// The followups-table row for an application (or null).
export function fuRow(followups, r) {
  return followups[field(r, "id")] || null;
}

// Follow-up state for a card: "today" | "overdue" | "upcoming" | null. Ignores closed/done.
export function fuState(followups, r) {
  const f = fuRow(followups, r);
  if (!f) return null;
  const fu = field(f, "follow_up_date");
  if (!fu) return null;
  if (field(f, "is_followup_sent") === true) return null; // user did the follow-up → no alarm
  const st = field(r, "status");
  if (st === "rejected" || st === "offer") return null;
  const d = String(fu).slice(0, 10),
    t = todayISO();
  return d === t ? "today" : d < t ? "overdue" : "upcoming";
}
