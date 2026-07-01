#input_type_name: SendEmailInput
#output_type_name: SendEmailResult
#function_name: send_email

from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Org auth-config name for Gmail (Composio-managed OAuth).
GMAIL_AUTH_CONFIG = "Gmail (Composio)"
GMAIL_CONNECTOR = "gmail"

# Auto-default follow-up lead time per stage (days). The user can refine the date later
# (paste recruiter context → followup_scheduler agent, or pick a date manually on the board).
STAGE_DAYS = {"applied": 7, "screening": 5, "interview": 3, "offer": 3, "rejected": 7}


def _days_for_stage(stage):
    return STAGE_DAYS.get(str(stage or "").lower(), 7)


class SendEmailInput(BaseModel):
    application_id: str
    resume_url: str = ""        # optional signed CV link to include in the email


class SendEmailResult(BaseModel):
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


def _esc(s):
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _body_html(text):
    """Plain-text draft -> formatted HTML paragraphs (blank line = new <p>)."""
    blocks = [b for b in str(text or "").replace("\r\n", "\n").split("\n\n") if b.strip()]
    paras = []
    for b in blocks:
        paras.append(
            '<p style="margin:0 0 16px;">'
            + _esc(b.strip()).replace("\n", "<br>")
            + "</p>"
        )
    return "".join(paras)


def _signature(profile):
    """A small, professional signature card from the user_profile row."""
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
    return (
        '<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0;">'
        + "".join(parts) + "</div>"
    )


def _cv_block(resume_url):
    """A tasteful 'View my résumé' link block (Composio can't attach raw bytes, so
    we link the stored CV via a signed URL instead)."""
    if not resume_url:
        return ""
    return (
        '<div style="margin-top:22px;padding:14px 16px;background:#f8fafc;'
        'border:1px solid #e2e8f0;border-radius:10px;">'
        '<span style="font-size:14px;color:#475569;">📎 My résumé / CV: </span>'
        '<a href="' + _esc(resume_url) + '" style="color:#4f46e5;font-weight:600;'
        'text-decoration:none;">View / download</a>'
        '</div>'
    )


def _html_email(body_text, profile, resume_url=""):
    """Wrap a plain-text email body in a clean, branded HTML shell."""
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
        + _cv_block(resume_url)
        + _signature(profile)
        + "</td></tr></table></td></tr></table></body></html>"
    )


async def send_email(ctx: FunctionContext, data: SendEmailInput) -> SendEmailResult:
    pod = Pod.from_env()
    apps = pod.table("applications")

    rec = apps.get(data.application_id)
    if not rec:
        return SendEmailResult(status="error", message="Application not found.")

    to = (rec.get("contact_email") or "").strip()
    subject = (rec.get("email_subject") or (str(rec.get("role") or "") + " application")).strip()
    body = (rec.get("draft_message") or "").strip()

    if not to:
        return SendEmailResult(status="error", message="No contact_email on this application — add a recipient first.")
    if not body:
        return SendEmailResult(status="error", message="No drafted email to send.")

    # Is a Gmail account connected for this user/org? If not, ask for permission.
    try:
        accounts = _items(pod.connectors.accounts.list(app=GMAIL_CONNECTOR))
    except Exception:
        accounts = []
    if not accounts:
        return SendEmailResult(status="needs_auth", to=to,
                               message="Gmail is not connected. Authorize Gmail to send this email.")

    # Build a branded HTML version of the draft (recruiter-facing). The plain-text
    # `body` stays the source of truth the user reviewed/edited; we only restyle it.
    try:
        profile = (_items(pod.table("user_profile").list(limit=1)) or [None])[0]
    except Exception:
        profile = None
    # Include the CV as a signed download link (Composio attaches only S3-hosted files
    # by s3key, not raw bytes — a link is the reliable way to deliver the résumé).
    html_body = _html_email(body, profile, (data.resume_url or "").strip())
    payload = {"recipient_email": to, "subject": subject, "body": html_body, "is_html": True}

    # Send. Do NOT pass account_id — the backend resolves the invoking user's account.
    try:
        pod.connectors.execute(GMAIL_AUTH_CONFIG, "GMAIL_SEND_EMAIL", payload)
    except Exception as e:
        # Most failures here are auth/permission related.
        return SendEmailResult(status="needs_auth", to=to,
                               message="Couldn't send (Gmail may need authorization): " + str(e)[:200])

    now = datetime.now(timezone.utc)
    apps.update(data.application_id, {
        "outreach_status": "sent",
        "sent_at": now.isoformat(),
    })

    # Schedule the follow-up in the dedicated followups table (one row per application).
    # The reminder always goes to the user's profile email — handled by run_followups.
    follow_up_date = (now + timedelta(days=_days_for_stage(rec.get("status") or "applied"))).date().isoformat()
    fts = pod.table("followups")
    try:
        existing = [f for f in _items(fts.list(limit=500))
                    if f.get("application_id") == data.application_id]
    except Exception:
        existing = []
    payload = {
        "application_id": data.application_id,
        "stage": (rec.get("status") or "applied"),
        "follow_up_date": follow_up_date,
    }
    try:
        if existing:
            # Reset an existing follow-up for this application (new outreach → new clock).
            payload.update({"is_followup_sent": False, "followup_alarm_sent": False})
            fts.update(existing[0].get("id"), payload)
        else:
            fts.create(payload)
    except Exception:
        pass

    return SendEmailResult(status="sent", to=to, message="Email sent to " + to)
