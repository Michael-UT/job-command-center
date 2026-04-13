// Priority companies: the user's top target companies.
// Each scrape pulls ALL current jobs from these companies' ATS boards,
// regardless of title match. Jobs from these companies get a +1 score boost
// and a star badge in the dashboard.

export interface PriorityCompany {
  name: string;
  careersUrl: string;
  ats: "ashby" | "greenhouse" | "lever" | "rippling" | "workday" | "custom" | null;
  slug: string | null; // ATS slug for API calls
}

export const PRIORITY_COMPANIES: PriorityCompany[] = [
  { name: "Abnormal", careersUrl: "https://abnormalsecurity.com/careers", ats: "greenhouse", slug: "abnormalsecurity" },
  { name: "Adaptive Security", careersUrl: "https://www.adaptivesecurity.com/careers", ats: "ashby", slug: "adaptivesecurity" },
  { name: "Agency", careersUrl: "https://www.agen.cy/careers", ats: "custom", slug: null },
  { name: "Anduril", careersUrl: "https://anduril.com/careers", ats: "custom", slug: null },
  { name: "Anthropic", careersUrl: "https://anthropic.com/careers", ats: "greenhouse", slug: "anthropic" },
  { name: "Applied Compute", careersUrl: "https://appliedcompute.com/careers", ats: "ashby", slug: "Applied Compute" },
  { name: "Applied Intuition", careersUrl: "https://appliedintuition.com/careers", ats: "greenhouse", slug: "appliedintuition" },
  { name: "Arcade", careersUrl: "https://arcade.dev/careers", ats: "ashby", slug: "arcade-ai" },
  { name: "Assort Health", careersUrl: "https://assorthealth.com/careers", ats: "ashby", slug: "assorthealth" },
  { name: "Avoca", careersUrl: "https://avoca.ai/careers", ats: "ashby", slug: "avoca" },
  { name: "Baseten", careersUrl: "https://baseten.co/careers", ats: "ashby", slug: "baseten" },
  { name: "Basis", careersUrl: "https://basis.ai/careers", ats: "ashby", slug: "basis-ai" },
  { name: "Braintrust", careersUrl: "https://braintrustdata.com/careers", ats: "ashby", slug: "braintrust" },
  { name: "Browserbase", careersUrl: "https://browserbase.com/careers", ats: "ashby", slug: "browserbase" },
  { name: "Canva", careersUrl: "https://canva.com/careers", ats: "custom", slug: null },
  { name: "Chroma", careersUrl: "https://www.trychroma.com/careers", ats: "ashby", slug: "trychroma" },
  { name: "Clay", careersUrl: "https://clay.com/careers", ats: "ashby", slug: "claylabs" },
  { name: "ClickHouse", careersUrl: "https://clickhouse.com/careers", ats: "greenhouse", slug: "clickhouse" },
  { name: "Cognition", careersUrl: "https://cognition.ai/careers", ats: "ashby", slug: "cognition" },
  { name: "Conductor", careersUrl: "https://www.conductor.build/careers", ats: "rippling", slug: "conductor" },
  { name: "CrewAI", careersUrl: "https://crewai.com/careers", ats: "custom", slug: null },
  { name: "Crosby", careersUrl: "https://crosby.ai/careers", ats: "ashby", slug: "crosby" },
  { name: "Cursor", careersUrl: "https://cursor.sh/careers", ats: "custom", slug: null },
  { name: "Databricks", careersUrl: "https://databricks.com/careers", ats: "greenhouse", slug: "databricks" },
  { name: "David AI", careersUrl: "https://davidai.com/careers", ats: "ashby", slug: "david-ai" },
  { name: "Decagon", careersUrl: "https://decagon.ai/careers", ats: "ashby", slug: "decagon" },
  { name: "Doppel", careersUrl: "https://www.doppel.com/company/careers", ats: "ashby", slug: "doppel" },
  { name: "Dust", careersUrl: "https://dust.tt/careers", ats: "ashby", slug: "dust" },
  { name: "E2B", careersUrl: "https://e2b.dev/careers", ats: "ashby", slug: "e2b" },
  { name: "ElevenLabs", careersUrl: "https://elevenlabs.io/careers", ats: "ashby", slug: "elevenlabs" },
  { name: "Exa", careersUrl: "https://exa.ai/careers", ats: "ashby", slug: "exa" },
  { name: "Factory", careersUrl: "https://factory.ai/careers", ats: "custom", slug: null },
  { name: "Fal", careersUrl: "https://fal.ai/careers", ats: "greenhouse", slug: "fal" },
  { name: "Fireworks AI", careersUrl: "https://fireworks.ai/careers", ats: "greenhouse", slug: "fireworksai" },
  { name: "Flock Safety", careersUrl: "https://flocksafety.com/careers", ats: "ashby", slug: "Flock Safety" },
  { name: "Gamma", careersUrl: "https://gamma.app/careers", ats: "ashby", slug: "gamma" },
  { name: "General Counsel (GC AI)", careersUrl: "https://gc.ai/company/careers", ats: "custom", slug: null },
  { name: "Glean", careersUrl: "https://glean.com/careers", ats: "greenhouse", slug: "gleanwork" },
  { name: "Gong", careersUrl: "https://gong.io/careers", ats: "greenhouse", slug: "gongio" },
  { name: "Granola", careersUrl: "https://granola.ai/careers", ats: "ashby", slug: "granola" },
  { name: "Harvey", careersUrl: "https://harvey.ai/careers", ats: "ashby", slug: "harvey" },
  { name: "Icon", careersUrl: "https://icon.com/careers", ats: "greenhouse", slug: "iconcareers" },
  { name: "Juicebox", careersUrl: "https://juicebox.ai/careers", ats: "ashby", slug: "juicebox" },
  { name: "LangChain", careersUrl: "https://www.langchain.com/careers", ats: "ashby", slug: "langchain" },
  { name: "Legora", careersUrl: "https://legora.com/careers", ats: "ashby", slug: "legora" },
  { name: "Linear", careersUrl: "https://linear.app/careers", ats: "ashby", slug: "linear" },
  { name: "Listen", careersUrl: "https://listenlabs.ai/careers", ats: "ashby", slug: "listenlabs" },
  { name: "LlamaIndex", careersUrl: "https://llamaindex.ai/careers", ats: "ashby", slug: "llamaindex" },
  { name: "Lovable", careersUrl: "https://lovable.dev/careers", ats: "ashby", slug: "lovable" },
  { name: "Matic Robotics", careersUrl: "https://maticrobots.com/careers", ats: "ashby", slug: "MaticRobots" },
  { name: "Mintlify", careersUrl: "https://mintlify.com/careers", ats: "ashby", slug: "mintlify" },
  { name: "Modal", careersUrl: "https://modal.com/careers", ats: "ashby", slug: "modal" },
  { name: "Momentic", careersUrl: "https://momentic.ai/careers", ats: "ashby", slug: "momentic" },
  { name: "n8n", careersUrl: "https://n8n.io/careers", ats: "ashby", slug: "n8n" },
  { name: "OpenAI", careersUrl: "https://openai.com/careers", ats: "ashby", slug: "openai" },
  { name: "OpenEvidence", careersUrl: "https://openevidence.com/careers", ats: "ashby", slug: "openevidence" },
  { name: "OpenRouter", careersUrl: "https://openrouter.ai/careers", ats: "ashby", slug: "openrouter" },
  { name: "PACE", careersUrl: "https://paceai.co/careers", ats: "rippling", slug: "pace" },
  { name: "Parallel", careersUrl: "https://parallel.ai/careers", ats: "ashby", slug: "parallel" },
  { name: "Physical Intelligence", careersUrl: "https://physicalintelligence.company/careers", ats: "ashby", slug: "physicalintelligence" },
  { name: "Profound", careersUrl: "https://www.tryprofound.com/careers", ats: "ashby", slug: "profound" },
  { name: "Ramp", careersUrl: "https://ramp.com/careers", ats: "ashby", slug: "ramp" },
  { name: "Reality Defender", careersUrl: "https://www.realitydefender.com/careers", ats: "ashby", slug: "realitydefender" },
  { name: "Resend", careersUrl: "https://resend.com/careers", ats: "ashby", slug: "resend" },
  { name: "Retell", careersUrl: "https://retellai.com/careers", ats: "ashby", slug: "retell-ai" },
  { name: "Rillet", careersUrl: "https://rillet.ai/careers", ats: "ashby", slug: "rillet" },
  { name: "Serval", careersUrl: "https://serval.ai/careers", ats: "ashby", slug: "serval" },
  { name: "Sierra", careersUrl: "https://sierra.ai/careers", ats: "ashby", slug: "sierra" },
  { name: "Stripe", careersUrl: "https://stripe.com/jobs", ats: "greenhouse", slug: "stripe" },
  { name: "Supabase", careersUrl: "https://supabase.com/careers", ats: "ashby", slug: "supabase" },
  { name: "Together.ai", careersUrl: "https://together.ai/careers", ats: "greenhouse", slug: "togetherai" },
  { name: "Turbopuffer", careersUrl: "https://turbopuffer.com/careers", ats: "ashby", slug: "turbopuffer" },
  { name: "Vercel", careersUrl: "https://vercel.com/careers", ats: "greenhouse", slug: "vercel" },
  { name: "Wispr Flow", careersUrl: "https://wispr.ai/careers", ats: "ashby", slug: "wispr-flow" },
  { name: "XBow", careersUrl: "https://xbow.ai/careers", ats: "ashby", slug: "xbowcareers" },
];

// Normalize a company name for matching (lowercase, alphanumeric only)
export function normalizeCompanyName(name: string | null): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build a set of normalized priority company names for fast lookup
const PRIORITY_NORMALIZED = new Set(
  PRIORITY_COMPANIES.map((c) => normalizeCompanyName(c.name)),
);

// Check if a given company name matches any priority company
export function isPriorityCompany(companyName: string | null): boolean {
  if (!companyName) return false;
  const normalized = normalizeCompanyName(companyName);
  if (PRIORITY_NORMALIZED.has(normalized)) return true;
  // Also check partial matches (e.g., "Anthropic, PBC" matches "Anthropic")
  for (const priority of PRIORITY_NORMALIZED) {
    if (priority.length >= 5 && normalized.includes(priority)) return true;
  }
  return false;
}
