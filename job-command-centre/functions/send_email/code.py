#input_type_name: SendEmailInput
#output_type_name: SendEmailResult
#function_name: send_email

import base64
import textwrap
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


def _html_email(body_text, profile):
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
        + _signature(profile)
        + "</td></tr></table></td></tr></table></body></html>"
    )


# ---- Minimal, zero-dependency PDF writer (Helvetica, wrap + paginate) --------

# Smart punctuation -> Latin-1-safe equivalents (Helvetica has no em-dash/curly quotes).
_PUNCT = {
    "—": "-", "–": "-", "‒": "-", "−": "-",
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "…": "...", "•": "-", " ": " ",
}


def _normalize(s):
    for k, v in _PUNCT.items():
        s = s.replace(k, v)
    return s


def _pdf_escape(s):
    s = _normalize(s)
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap_para(text, width=92):
    out = []
    for raw in str(text or "").replace("\r\n", "\n").split("\n"):
        if not raw.strip():
            out.append("")  # blank line between paragraphs
            continue
        out.extend(textwrap.wrap(raw.strip(), width=width) or [""])
    return out


def _make_cover_letter_pdf(body_text, header_lines):
    """Build a simple multi-page A4-ish PDF from plain text. Returns bytes."""
    PAGE_W, PAGE_H = 595, 842          # A4 points
    LEFT, TOP, BOTTOM = 64, 780, 64
    LEAD = 16
    FONT_SIZE = 11

    # Compose all lines: bold header block, blank, then wrapped body.
    lines = []  # (text, bold)
    for h in header_lines:
        if h:
            lines.append((h, True))
    if header_lines:
        lines.append(("", False))
    for ln in _wrap_para(body_text):
        lines.append((ln, False))

    # Paginate.
    pages = []
    cur = []
    y = TOP
    for text, bold in lines:
        if y < BOTTOM:
            pages.append(cur)
            cur = []
            y = TOP
        cur.append((text, bold, y))
        y -= LEAD
    if cur:
        pages.append(cur)
    if not pages:
        pages = [[]]

    # Build a content stream per page.
    def stream_for(page):
        parts = []
        for text, bold, y in page:
            if not text:
                continue
            font = "F2" if bold else "F1"
            parts.append(
                "BT /%s %d Tf %d %d Td (%s) Tj ET"
                % (font, FONT_SIZE, LEFT, y, _pdf_escape(text))
            )
        return "\n".join(parts).encode("latin-1", "replace")

    # Assemble PDF objects.
    objs = []  # raw bytes per object body (without "N 0 obj")
    # 1 catalog, 2 pages, fonts 3/4, then per page: page obj + content obj.
    n_pages = len(pages)
    page_obj_ids = [5 + 2 * i for i in range(n_pages)]
    content_obj_ids = [6 + 2 * i for i in range(n_pages)]

    objs.append((1, b"<< /Type /Catalog /Pages 2 0 R >>"))
    kids = " ".join("%d 0 R" % pid for pid in page_obj_ids)
    objs.append((2, ("<< /Type /Pages /Count %d /Kids [%s] >>" % (n_pages, kids)).encode()))
    objs.append((3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"))
    objs.append((4, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"))
    for i, page in enumerate(pages):
        pid, cid = page_obj_ids[i], content_obj_ids[i]
        objs.append((pid, (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            "/Contents %d 0 R >>" % (PAGE_W, PAGE_H, cid)).encode()))
        body = stream_for(page)
        objs.append((cid, b"<< /Length %d >>\nstream\n" % len(body) + body + b"\nendstream"))

    objs.sort(key=lambda o: o[0])
    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num, body in objs:
        offsets[num] = len(out)
        out += ("%d 0 obj\n" % num).encode() + body + b"\nendobj\n"
    xref_pos = len(out)
    max_obj = max(offsets)
    out += ("xref\n0 %d\n" % (max_obj + 1)).encode()
    out += b"0000000000 65535 f \n"
    for num in range(1, max_obj + 1):
        out += ("%010d 00000 n \n" % offsets.get(num, 0)).encode()
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF"
            % (max_obj + 1, xref_pos)).encode()
    return bytes(out)


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
    html_body = _html_email(body, profile)

    # Build the cover-letter PDF (recruiter-facing attachment). Non-fatal: if PDF
    # generation fails for any reason, we still send the email without the attachment.
    payload = {"recipient_email": to, "subject": subject, "body": html_body, "is_html": True}
    cover = (rec.get("cover_letter") or "").strip()
    if cover:
        try:
            who = (profile or {}).get("full_name") if profile else ""
            header = [str(who or "").strip(), str(rec.get("role") or "").strip()
                      + ((" — " + str(rec.get("company"))) if rec.get("company") else "")]
            header = [h for h in header if h]
            pdf_bytes = _make_cover_letter_pdf(cover, header)
            fname = ("Cover_Letter_" + str(rec.get("company") or "application")
                     .replace(" ", "_") + ".pdf")
            payload["attachment"] = {
                "name": fname,
                "mimetype": "application/pdf",
                "content": base64.b64encode(pdf_bytes).decode("ascii"),
            }
        except Exception:
            pass  # attachment is best-effort; never block the send

    # Send. Do NOT pass account_id — the backend resolves the invoking user's account.
    # If the send fails WITH an attachment, retry once WITHOUT it before giving up — a bad
    # attachment-param shape must never block the email or be mistaken for an auth problem.
    first_err = None
    try:
        pod.connectors.execute(GMAIL_AUTH_CONFIG, "GMAIL_SEND_EMAIL", payload)
    except Exception as e:
        first_err = e
        if "attachment" in payload:
            payload.pop("attachment", None)
            try:
                pod.connectors.execute(GMAIL_AUTH_CONFIG, "GMAIL_SEND_EMAIL", payload)
                first_err = None  # plain send succeeded
            except Exception as e2:
                first_err = e2
    if first_err is not None:
        # Genuine failure (most often auth/permission).
        return SendEmailResult(status="needs_auth", to=to,
                               message="Couldn't send (Gmail may need authorization): " + str(first_err)[:200])

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
