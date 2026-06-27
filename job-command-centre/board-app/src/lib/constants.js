// Pipeline stages, in board order. `c` is the CSS color used for the column dot.
export const STAGES = [
  { k: "applied", label: "Applied", c: "var(--applied)" },
  { k: "screening", label: "Screening", c: "var(--screening)" },
  { k: "interview", label: "Interview", c: "var(--interview)" },
  { k: "offer", label: "Offer", c: "var(--offer)" },
  { k: "rejected", label: "Rejected", c: "var(--rejected)" },
  { k: "withdrawn", label: "Withdrawn", c: "var(--withdrawn)" },
];

export const AGENT = "parser_scorer";
export const TABLE = "applications";
export const GRANT_KEYS = ["gmail_read", "gmail_write", "calendar_write"];
export const OUTREACH = "outreach_writer";
export const ORG_ID = "019eff08-dcc4-77e7-b25e-f68201fb0810";
export const GMAIL_AUTH_CONFIG_ID = "019f04d3-26fb-742a-9b9c-993a6ae55305";
