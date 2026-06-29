import { field, asArray } from "./helpers.js";

function val(v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
  return String(v);
}

function line(label, v) {
  const s = val(v);
  return s ? label + ": " + s + "\n" : "";
}

// Bound a value's text length so we don't blow up the prompt with long prose
// (raw resume / JD boilerplate). Keeps the head — where the substance usually is.
function clip(v, n) {
  const s = val(v);
  return s.length <= n ? s : s.slice(0, n) + " …[truncated]";
}

// Builds a single self-contained context block embedding everything the drafting
// agents need (application + resume + profile), so the agent makes NO read calls
// and only does one write. Used by outreach + follow-up generation.
export function agentContextBlock(r, resume, profile) {
  let s = "=== APPLICATION ===\n";
  s += line("company", field(r, "company"));
  s += line("role", field(r, "role"));
  s += line("must_have_skills", asArray(field(r, "must_have_skills")));
  s += line("match_score", field(r, "match_score"));
  s += line("resume_gaps", field(r, "resume_gaps"));
  s += line("contact_name", field(r, "contact_name"));
  s += line("contact_email", field(r, "contact_email"));
  s += line("email_subject", field(r, "email_subject"));

  // The JD's hard requirements are already extracted into must_have_skills above,
  // so a capped JD keeps the signal and drops boilerplate.
  const jd = field(r, "jd_text");
  if (jd) s += "\n=== JOB DESCRIPTION ===\n" + clip(jd, 1400) + "\n";

  if (resume) {
    s += "\n=== RESUME USED ===\n";
    // Prefer the PARSED resume fields — they carry the real evidence (skills,
    // experience, projects) far more compactly than the full raw page. Only fall
    // back to the raw text (capped) when the resume wasn't parsed into fields.
    const skills = asArray(field(resume, "skills"));
    const work = field(resume, "work_experience");
    const projects = field(resume, "projects");
    const hasParsed = skills.length || work || projects;
    if (hasParsed) {
      let rb = "";
      rb += line("skills", skills);
      rb += line("work_experience", work);
      rb += line("projects", projects);
      rb += line("competitions", field(resume, "competitions"));
      rb += line("education", field(resume, "education"));
      rb += line("certifications", field(resume, "certifications"));
      s += clip(rb, 2400);
    } else {
      s += clip(field(resume, "raw_resume_text"), 2000) + "\n";
    }
  }

  if (profile) {
    s += "\n=== YOUR PROFILE (for the signature) ===\n";
    s += line("full_name", field(profile, "full_name"));
    s += line("email", field(profile, "email"));
    s += line("phone", field(profile, "phone"));
    s += line("headline", field(profile, "headline"));
    s += line("links", field(profile, "links"));
  }

  return s;
}
