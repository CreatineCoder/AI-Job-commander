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

  const jd = field(r, "jd_text");
  if (jd) s += "\n=== JOB DESCRIPTION ===\n" + jd + "\n";

  if (resume) {
    s += "\n=== RESUME USED ===\n";
    const raw = field(resume, "raw_resume_text");
    if (raw) {
      s += raw + "\n";
    } else {
      s += line("skills", asArray(field(resume, "skills")));
      s += line("projects", field(resume, "projects"));
      s += line("work_experience", field(resume, "work_experience"));
      s += line("competitions", field(resume, "competitions"));
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
