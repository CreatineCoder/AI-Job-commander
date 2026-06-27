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
        resp = pod.connectors.execute(
            GMAIL_AUTH_CONFIG, "GMAIL_SEND_EMAIL",
            {"recipient_email": to, "subject": subject, "body": body},
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
