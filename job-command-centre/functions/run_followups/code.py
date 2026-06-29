#input_type_name: RunFollowupsInput
#output_type_name: RunFollowupsResult
#function_name: run_followups

from datetime import datetime, timezone, date
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

GMAIL_AUTH_CONFIG = "Gmail (Composio)"
GMAIL_CONNECTOR = "gmail"

# Application statuses where chasing a follow-up no longer makes sense.
TERMINAL = {"rejected", "offer"}


class RunFollowupsInput(BaseModel):
    # The daily schedule calls this with no input; dry_run skips sending.
    dry_run: bool = False


class RunFollowupsResult(BaseModel):
    ok: bool
    due: int = 0          # how many follow-ups were due today/overdue
    notified: bool = False
    to: str = ""
    message: str = ""


def _items(resp):
    if resp is None:
        return []
    if hasattr(resp, "to_dict"):
        resp = resp.to_dict()
    if isinstance(resp, dict):
        return resp.get("items") or []
    return resp if isinstance(resp, list) else []


def _to_dict(x):
    if x is None:
        return {}
    if hasattr(x, "to_dict"):
        try:
            x = x.to_dict()
        except Exception:
            pass
    return x if isinstance(x, dict) else {}


def _send_ok(resp):
    """Interpret a Composio execute() response. Returns (ok, detail)."""
    d = _to_dict(resp)
    if "successful" in d and d.get("successful") is False:
        return False, str(d.get("error") or d.get("data") or d)
    if d.get("error"):
        return False, str(d.get("error"))
    data = _to_dict(d.get("data")) or {}
    mid = data.get("id") or data.get("messageId") or data.get("threadId") or ""
    return True, ("message id " + str(mid)) if mid else "accepted"


def _as_date(v):
    if not v:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except Exception:
        try:
            return date.fromisoformat(s[:10])
        except Exception:
            return None


def _esc(s):
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _digest_html(rows, n, today_iso):
    """rows: list of dicts {company, role, stage, overdue, who, na}."""
    cards = []
    for r in rows:
        badges = ""
        if r["stage"]:
            badges += ('<span style="display:inline-block;background:#eef2ff;color:#4f46e5;'
                       'font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;'
                       'margin-left:8px;">' + _esc(r["stage"]) + "</span>")
        if r["overdue"]:
            badges += ('<span style="display:inline-block;background:#fee2e2;color:#dc2626;'
                       'font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;'
                       'margin-left:8px;">OVERDUE</span>')
        cards.append(
            '<tr><td style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;'
            'background:#f8fafc;">'
            '<div style="font-weight:700;color:#0f172a;font-size:15px;">'
            + _esc(r["company"]) + ' &middot; ' + _esc(r["role"]) + badges + "</div>"
            '<div style="color:#475569;font-size:13px;margin-top:6px;">Follow up with <b>'
            + _esc(r["who"]) + "</b></div>"
            '<div style="color:#64748b;font-size:13px;margin-top:2px;">Next: '
            + _esc(r["na"]) + "</div>"
            "</td></tr><tr><td style=\"height:10px;\"></td></tr>"
        )
    app_url = "https://devansh-job-command-centre.apps.lemma.work"
    return (
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;'
        'overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">'
        '<tr><td style="height:4px;background:linear-gradient(90deg,#4f46e5,#06b6d4);"></td></tr>'
        '<tr><td style="padding:30px 34px;font-family:-apple-system,BlinkMacSystemFont,'
        "'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">"
        '<div style="font-size:18px;font-weight:800;color:#0f172a;">'
        + str(n) + ' follow-up' + ('s' if n != 1 else '') + ' due</div>'
        '<div style="color:#64748b;font-size:13px;margin:4px 0 20px;">as of '
        + _esc(today_iso) + "</div>"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        + "".join(cards) + "</table>"
        '<a href="' + app_url + '" style="display:inline-block;margin-top:14px;'
        'background:#4f46e5;color:#ffffff;text-decoration:none;font-size:14px;'
        'font-weight:600;padding:11px 22px;border-radius:10px;">Open Command Centre</a>'
        "</td></tr></table></td></tr></table></body></html>"
    )


async def run_followups(ctx: FunctionContext, data: RunFollowupsInput) -> RunFollowupsResult:
    pod = Pod.from_env()
    fts = pod.table("followups")
    apps = pod.table("applications")
    today = datetime.now(timezone.utc).date()

    # Index applications so we can skip closed ones without re-fetching each.
    app_by_id = {a.get("id"): a for a in _items(apps.list(limit=500))}

    # The alarm/reminder ALWAYS goes to the user's own profile email.
    try:
        prof = _items(pod.table("user_profile").list(limit=1))
        to = ((prof[0].get("email") if prof else "") or "").strip()
    except Exception:
        to = ""

    due = []   # (followup_row, application_row)
    for f in _items(fts.list(limit=500)):
        if f.get("is_followup_sent"):            # user already did the follow-up
            continue
        if f.get("followup_alarm_sent"):         # reminder already dispatched
            continue
        fu = _as_date(f.get("follow_up_date"))
        if not fu or fu > today:                 # not due yet
            continue
        app = app_by_id.get(f.get("application_id"))
        if app and (app.get("status") or "applied") in TERMINAL:
            continue
        due.append((f, app or {}))

    if not due:
        return RunFollowupsResult(ok=True, due=0, message="No follow-ups due.")

    if not to:
        return RunFollowupsResult(ok=True, due=len(due), notified=False,
                                  message="Follow-ups due but no user_profile.email to notify.")

    if data.dry_run:
        return RunFollowupsResult(ok=True, due=len(due), notified=False, to=to,
                                  message="Dry run — would notify " + to)

    # One digest to the profile email covering every due follow-up.
    rows = []
    for f, app in due:
        fu = _as_date(f.get("follow_up_date"))
        rows.append({
            "company": app.get("company") or "?",
            "role": app.get("role") or "?",
            "stage": (f.get("stage") or app.get("status") or "").strip(),
            "overdue": bool(fu and fu < today),
            "who": str(app.get("contact_name") or app.get("contact_email") or "the recruiter").strip(),
            "na": str(app.get("next_action") or "Send a follow-up note.").strip(),
        })
    subject = "Job follow-ups due today ({n})".format(n=len(due))
    html_body = _digest_html(rows, len(due), today.isoformat())

    try:
        resp = pod.connectors.execute(
            GMAIL_AUTH_CONFIG, "GMAIL_SEND_EMAIL",
            {"recipient_email": to, "subject": subject, "body": html_body, "is_html": True},
        )
    except Exception as e:
        return RunFollowupsResult(ok=False, due=len(due), notified=False, to=to,
                                  message="Couldn't send reminder: " + str(e)[:200])
    ok_send, detail = _send_ok(resp)
    if not ok_send:
        return RunFollowupsResult(ok=False, due=len(due), notified=False, to=to,
                                  message="Gmail did not confirm the send: " + detail[:200])

    now_iso = datetime.now(timezone.utc).isoformat()
    for f, app in due:
        try:
            fts.update(f.get("id"), {"followup_alarm_sent": True, "last_alarm_at": now_iso})
        except Exception:
            pass

    return RunFollowupsResult(ok=True, due=len(due), notified=True, to=to,
                              message="Reminder sent to " + to + " (" + detail + ")")
