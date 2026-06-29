#input_type_name: SendFollowupInput
#output_type_name: SendFollowupResult
#function_name: send_followup

from datetime import datetime, timezone
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

GMAIL_AUTH_CONFIG = "Gmail (Composio)"
GMAIL_CONNECTOR = "gmail"


class SendFollowupInput(BaseModel):
    followup_id: str


class SendFollowupResult(BaseModel):
    status: str            # "sent" | "needs_auth" | "error"
    message: str = ""
    to: str = ""


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


def _esc(s):
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _body_html(text):
    blocks = [b for b in str(text or "").replace("\r\n", "\n").split("\n\n") if b.strip()]
    return "".join(
        '<p style="margin:0 0 16px;">' + _esc(b.strip()).replace("\n", "<br>") + "</p>"
        for b in blocks
    )


def _signature(profile):
    if not profile:
        return ""
    name = _esc(profile.get("full_name"))
    headline = _esc(profile.get("headline"))
    email = _esc(profile.get("email"))
    links_raw = profile.get("links")
    links = []
    if isinstance(links_raw, (list, tuple)):
        links = [str(x) for x in links_raw if x]
    elif links_raw:
        links = [s.strip() for s in str(links_raw).replace(",", " ").split() if s.strip()]
    parts = []
    if name:
        parts.append('<div style="font-weight:700;color:#0f172a;font-size:15px;">' + name + "</div>")
    if headline:
        parts.append('<div style="color:#64748b;font-size:13px;margin-top:2px;">' + headline + "</div>")
    contact = []
    if email:
        contact.append('<a href="mailto:' + email + '" style="color:#4f46e5;text-decoration:none;">' + email + "</a>")
    for lk in links:
        href = lk if lk.startswith("http") else "https://" + lk
        label = lk.replace("https://", "").replace("http://", "").rstrip("/")
        contact.append('<a href="' + _esc(href) + '" style="color:#4f46e5;text-decoration:none;">' + _esc(label) + "</a>")
    if contact:
        parts.append('<div style="color:#64748b;font-size:13px;margin-top:6px;">'
                     + ' &nbsp;·&nbsp; '.join(contact) + "</div>")
    if not parts:
        return ""
    return ('<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0;">'
            + "".join(parts) + "</div>")


def _html_email(body_text, profile):
    return (
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background:#f1f5f9;padding:24px 0;"><tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;'
        'overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">'
        '<tr><td style="height:4px;background:linear-gradient(90deg,#4f46e5,#06b6d4);"></td></tr>'
        '<tr><td style="padding:32px 36px;font-family:-apple-system,BlinkMacSystemFont,'
        "'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;font-size:15px;"
        'line-height:1.65;">'
        + _body_html(body_text)
        + _signature(profile)
        + "</td></tr></table></td></tr></table></body></html>"
    )


def _send_ok(resp):
    d = _to_dict(resp)
    if "successful" in d and d.get("successful") is False:
        return False, str(d.get("error") or d.get("data") or d)
    if d.get("error"):
        return False, str(d.get("error"))
    data = _to_dict(d.get("data")) or {}
    mid = data.get("id") or data.get("messageId") or data.get("threadId") or ""
    return True, ("message id " + str(mid)) if mid else "accepted"


async def send_followup(ctx: FunctionContext, data: SendFollowupInput) -> SendFollowupResult:
    pod = Pod.from_env()
    fts = pod.table("followups")
    apps = pod.table("applications")

    f = fts.get(data.followup_id)
    if not f:
        return SendFollowupResult(status="error", message="Follow-up not found.")

    app = apps.get(f.get("application_id")) or {}
    to = (app.get("contact_email") or "").strip()
    subject = (f.get("followup_subject")
               or ("Re: " + str(app.get("email_subject") or (str(app.get("role") or "") + " role")))).strip()
    body = (f.get("followup_message") or "").strip()

    if not to:
        return SendFollowupResult(status="error",
                                  message="No recruiter/contact email on this application — add one first.")
    if not body:
        return SendFollowupResult(status="error",
                                  message="No drafted follow-up to send — generate it first.")

    # Gmail connected?
    try:
        accounts = _items(pod.connectors.accounts.list(app=GMAIL_CONNECTOR))
    except Exception:
        accounts = []
    if not accounts:
        return SendFollowupResult(status="needs_auth", to=to,
                                  message="Gmail is not connected. Authorize Gmail to send this follow-up.")

    try:
        profile = (_items(pod.table("user_profile").list(limit=1)) or [None])[0]
    except Exception:
        profile = None
    html_body = _html_email(body, profile)

    try:
        resp = pod.connectors.execute(
            GMAIL_AUTH_CONFIG, "GMAIL_SEND_EMAIL",
            {"recipient_email": to, "subject": subject, "body": html_body, "is_html": True},
        )
    except Exception as e:
        return SendFollowupResult(status="needs_auth", to=to,
                                  message="Couldn't send (Gmail may need authorization): " + str(e)[:200])

    ok_send, detail = _send_ok(resp)
    if not ok_send:
        return SendFollowupResult(status="error", to=to,
                                  message="Gmail did not confirm the send: " + detail[:200])

    # The recruiter follow-up was sent → the follow-up is done; clear the board alarm.
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        fts.update(data.followup_id, {"is_followup_sent": True, "last_alarm_at": now_iso})
    except Exception:
        pass

    return SendFollowupResult(status="sent", to=to,
                              message="Follow-up sent to " + to + " (" + detail + ")")
