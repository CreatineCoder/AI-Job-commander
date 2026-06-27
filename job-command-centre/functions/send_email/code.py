#input_type_name: SendEmailInput
#output_type_name: SendEmailResult
#function_name: send_email

from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Org auth-config name for Gmail (Composio-managed OAuth).
GMAIL_AUTH_CONFIG = "Gmail (Composio)"
GMAIL_CONNECTOR = "gmail"

# When outreach is sent, schedule a follow-up this many days out.
# TESTING: 0 = same-day follow-up (due immediately). Set back to 5 for production.
FOLLOW_UP_DAYS = 0


class SendEmailInput(BaseModel):
    application_id: str


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

    # Send. Do NOT pass account_id — the backend resolves the invoking user's account.
    try:
        pod.connectors.execute(
            GMAIL_AUTH_CONFIG,
            "GMAIL_SEND_EMAIL",
            {"recipient_email": to, "subject": subject, "body": body},
        )
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
    follow_up_date = (now + timedelta(days=FOLLOW_UP_DAYS)).date().isoformat()
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
