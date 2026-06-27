#input_type_name: ScheduleFollowupInput
#output_type_name: ScheduleFollowupResult
#function_name: schedule_followup

from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from lemma_sdk import FunctionContext, Pod

# Stages that warrant chasing a follow-up. The initial "applied" stage is owned by
# outreach (send_email), and terminal stages have nothing to chase.
ACTIVE_STAGES = {"screening", "interview", "offer"}

# Days to wait before a stage follow-up is due. Keep in sync with send_email.
# TESTING: 0 = due immediately. Set to 5 for production.
FOLLOW_UP_DAYS = 0


class ScheduleFollowupInput(BaseModel):
    application_id: str
    stage: str


class ScheduleFollowupResult(BaseModel):
    status: str               # "scheduled" | "skipped" | "error"
    reason: str = ""
    followup_id: str = ""
    stage: str = ""
    follow_up_date: str = ""


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


async def schedule_followup(ctx: FunctionContext, data: ScheduleFollowupInput) -> ScheduleFollowupResult:
    stage = (data.stage or "").strip().lower()
    if not data.application_id:
        return ScheduleFollowupResult(status="error", reason="missing application_id")
    if stage not in ACTIVE_STAGES:
        return ScheduleFollowupResult(
            status="skipped", reason="stage '%s' is not an active stage" % stage, stage=stage
        )

    pod = Pod.from_env()
    fts = pod.table("followups")

    # Moving to a new stage supersedes earlier open follow-ups: close them so the
    # board shows only the current-stage follow-up and the cron stops chasing stale ones.
    try:
        for f in _items(fts.list(limit=500)):
            if f.get("application_id") != data.application_id:
                continue
            if f.get("is_followup_sent"):
                continue
            try:
                fts.update(f.get("id"), {"is_followup_sent": True})
            except Exception:
                pass
    except Exception:
        pass

    follow_up_date = (datetime.now(timezone.utc).date() + timedelta(days=FOLLOW_UP_DAYS)).isoformat()
    payload = {
        "application_id": data.application_id,
        "stage": stage,
        "follow_up_date": follow_up_date,
        "is_followup_sent": False,
        "followup_alarm_sent": False,
    }
    try:
        new = _to_dict(fts.create(payload))
    except Exception as e:
        return ScheduleFollowupResult(status="error", reason=str(e)[:200], stage=stage)

    return ScheduleFollowupResult(
        status="scheduled",
        followup_id=str(new.get("id", "")),
        stage=stage,
        follow_up_date=follow_up_date,
    )
