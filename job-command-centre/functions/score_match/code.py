#input_type_name: ScoreMatchInput
#output_type_name: ScoreMatchResult
#function_name: score_match

from pydantic import BaseModel, Field
from lemma_sdk import FunctionContext


class SkillJudgment(BaseModel):
    skill: str
    # The agent's semantic judgment of how well the resume covers this required skill.
    status: str = Field(description="one of: matched | partial | missing")
    # Optional importance weight (must-have = higher). Defaults to 1.0.
    weight: float = 1.0


class ScoreMatchInput(BaseModel):
    # One judgment per skill the JD requires.
    skills: list[SkillJudgment]


class ScoreMatchResult(BaseModel):
    match_score: int          # 0-100, deterministic weighted coverage
    matched: int
    partial: int
    missing: int
    total: int
    summary: str


# matched fully credits the skill, partial gives half, missing gives none.
_VALUE = {"matched": 1.0, "partial": 0.5, "missing": 0.0}


async def score_match(ctx: FunctionContext, data: ScoreMatchInput) -> ScoreMatchResult:
    skills = data.skills or []
    if not skills:
        return ScoreMatchResult(
            match_score=0, matched=0, partial=0, missing=0, total=0,
            summary="No required skills provided.",
        )

    total_weight = 0.0
    earned = 0.0
    matched = partial = missing = 0
    for s in skills:
        status = (s.status or "missing").strip().lower()
        value = _VALUE.get(status, 0.0)
        weight = s.weight if s.weight and s.weight > 0 else 1.0
        total_weight += weight
        earned += value * weight
        if status == "matched":
            matched += 1
        elif status == "partial":
            partial += 1
        else:
            missing += 1

    score = round(100 * earned / total_weight) if total_weight else 0
    summary = f"{matched} matched, {partial} partial, {missing} missing of {len(skills)} required skills."
    return ScoreMatchResult(
        match_score=score, matched=matched, partial=partial, missing=missing,
        total=len(skills), summary=summary,
    )
