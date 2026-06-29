import { field, listOf } from "./helpers.js";
import { TABLE, GRANT_KEYS, ORG_ID, GMAIL_AUTH_CONFIG_ID } from "./constants.js";

// An application can now have several follow-ups over time (one per stage). For
// the board we surface a single "active" one: prefer rows not yet marked done,
// and among equals the most recently created/due.
function fuTime(f) {
  return Date.parse(field(f, "created_at") || "") || Date.parse(field(f, "follow_up_date") || "") || 0;
}
function isBetterFollowup(f, cur) {
  const openF = field(f, "is_followup_sent") !== true ? 1 : 0;
  const openCur = field(cur, "is_followup_sent") !== true ? 1 : 0;
  if (openF !== openCur) return openF > openCur; // an open follow-up beats a done one
  return fuTime(f) >= fuTime(cur); // otherwise the newest wins
}

// Load applications + the followups table, indexing the active followup by application_id.
// Returns { rows, followups }.
export async function loadData(client) {
  const resp = await client.records.list(TABLE, { limit: 200 });
  const rows = listOf(resp);
  const followups = {};
  try {
    const fr = await client.records.list("followups", { limit: 500 });
    listOf(fr).forEach((f) => {
      const aid = field(f, "application_id");
      if (!aid) return;
      const cur = followups[aid];
      if (!cur || isBetterFollowup(f, cur)) followups[aid] = f;
    });
  } catch (e) {
    /* followups optional */
  }
  return { rows, followups };
}

// First-time onboarding: seed a permissions row per grant, defaulting to false.
// Idempotent — only creates keys that don't already exist.
export async function ensurePermissions(client) {
  try {
    const resp = await client.records.list("permissions", { limit: 50 });
    const have = {};
    listOf(resp).forEach((r) => {
      const k = field(r, "grant_key");
      if (k) have[k] = true;
    });
    for (const k of GRANT_KEYS) {
      if (!have[k]) {
        try {
          await client.records.create("permissions", { grant_key: k, granted: false });
        } catch (e) {
          /* ignore */
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Callers await the agent run (which already blocks until the agent finishes)
// before polling, so the DB write is usually already done — check IMMEDIATELY,
// then poll on a tight interval. The old "sleep 4s first" added guaranteed dead time.
const POLL_MS = 1500;

// Poll until a brand-new application row appears (count grows past `before`).
export async function pollNew(client, before, timeoutMs) {
  const start = Date.now();
  do {
    try {
      const { rows } = await loadData(client);
      if (rows.length > before) return true;
    } catch (e) {
      /* retry */
    }
    if (Date.now() - start >= timeoutMs) break;
    await sleep(POLL_MS);
  } while (Date.now() - start < timeoutMs);
  return false;
}

// Poll an applications row until `fieldName` changes from `oldVal`.
export async function pollChange(client, id, fieldName, oldVal, timeoutMs) {
  const start = Date.now();
  do {
    let rows = [];
    try {
      ({ rows } = await loadData(client));
    } catch (e) {
      /* retry */
    }
    const r = rows.filter((x) => String(field(x, "id")) === String(id))[0];
    if (r && String(field(r, fieldName) || "") !== String(oldVal)) return true;
    if (Date.now() - start >= timeoutMs) break;
    await sleep(POLL_MS);
  } while (Date.now() - start < timeoutMs);
  return false;
}

// Poll the followups row (by application id) until its followup_message changes.
export async function pollFollowup(client, appId, oldVal, timeoutMs) {
  const start = Date.now();
  do {
    let followups = {};
    try {
      ({ followups } = await loadData(client));
    } catch (e) {
      /* retry */
    }
    const f = followups[appId];
    if (f && String(field(f, "followup_message") || "") !== String(oldVal)) return true;
    if (Date.now() - start >= timeoutMs) break;
    await sleep(POLL_MS);
  } while (Date.now() - start < timeoutMs);
  return false;
}

// Poll the followups row (by application id) until a given field changes.
export async function pollFollowupField(client, appId, fieldName, oldVal, timeoutMs) {
  const start = Date.now();
  do {
    let followups = {};
    try {
      ({ followups } = await loadData(client));
    } catch (e) {
      /* retry */
    }
    const f = followups[appId];
    if (f && String(field(f, fieldName) || "") !== String(oldVal)) return true;
    if (Date.now() - start >= timeoutMs) break;
    await sleep(POLL_MS);
  } while (Date.now() - start < timeoutMs);
  return false;
}

// Fetch the resume_data row used by an application (by resume_id), or null.
export async function getResume(client, resumeId) {
  if (!resumeId) return null;
  try {
    const resp = await client.records.list("resume_data", { limit: 200 });
    return listOf(resp).filter((x) => String(field(x, "id")) === String(resumeId))[0] || null;
  } catch (e) {
    return null;
  }
}

// Fetch the single user_profile row, or null.
export async function getProfile(client) {
  try {
    const resp = await client.records.list("user_profile", { limit: 1 });
    return listOf(resp)[0] || null;
  } catch (e) {
    return null;
  }
}

// Delete an application and any follow-up rows that reference it. The followups
// table has a foreign key on application_id, so children must go first or the
// delete is rejected ("still referenced by other records").
export async function deleteApplication(client, id) {
  const childrenOf = async () => {
    const fr = await client.records.list("followups", { limit: 500 });
    return listOf(fr).filter((f) => String(field(f, "application_id")) === String(id));
  };

  // Remove follow-up rows that reference this application (FK child rows first).
  let children = await childrenOf();
  for (const f of children) {
    await client.records.delete("followups", field(f, "id"));
  }

  try {
    await client.records.delete(TABLE, id);
  } catch (e) {
    // Still blocked? Re-check what references it so the message is actionable
    // instead of the generic "referenced by other records".
    const remaining = await childrenOf();
    if (remaining.length) {
      throw new Error(
        remaining.length +
          " follow-up row(s) still reference this job and couldn't be removed (likely a permissions/RLS restriction)."
      );
    }
    throw e;
  }
}

// Start a Gmail connect request and return the authorization URL (or null).
export async function gmailAuthUrl(client) {
  try {
    const res = await client.request(
      "POST",
      "/organizations/" + ORG_ID + "/connectors/connect-requests",
      { body: { connector_id: "gmail", auth_config_id: GMAIL_AUTH_CONFIG_ID } }
    );
    return res && (res.authorization_url || (res.data && res.data.authorization_url));
  } catch (e) {
    return null;
  }
}
