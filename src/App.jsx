import { useState, useEffect, useCallback, useMemo } from "react";

const API_BASE = "/api";

const ATS_COLORS = {
  greenhouse: "#2ea44f",
  ashby: "#6366f1",
  lever: "#8b5cf6",
  workday: "#f59e0b",
  linkedin: "#0a66c2",
  indeed: "#2164f3",
  wellfound: "#000",
  yc: "#f26522",
  unknown: "#555",
};

// Score color ramp for 0.00-10.00 scale
function getScoreColor(score) {
  if (score == null) return "#333";
  if (score >= 9) return "#10b981";    // emerald
  if (score >= 8) return "#34d399";    // green
  if (score >= 7) return "#86efac";    // light green
  if (score >= 6) return "#fde047";    // yellow
  if (score >= 5) return "#fbbf24";    // amber
  if (score >= 4) return "#fb923c";    // orange
  if (score >= 3) return "#f87171";    // light red
  return "#ef4444";                     // red
}

const STATUS_OPTIONS = ["new", "applied", "responded", "interviewing", "offer", "rejected", "skipped"];

const STATUS_COLORS = {
  new: "#10b981",
  applied: "#3b82f6",
  responded: "#60a5fa",
  interviewing: "#a855f7",
  offer: "#eab308",
  rejected: "#ef4444",
  skipped: "#555",
};

export default function JobCommandCenter() {
  const [data, setData] = useState({
    newToday: [], previouslySeen: [], applied: [], responded: [], interviewing: [],
    offer: [], rejected: [], skipped: [], total: 0, last_scraped: null, scrape_stats: null, scrape_errors: [],
  });
  const [activeTab, setActiveTab] = useState("jobs");
  const [stories, setStories] = useState({ content: "", count: 0 });
  const [search, setSearch] = useState("");
  const [filterATS, setFilterATS] = useState("all");
  const [excludeTerms, setExcludeTerms] = useState(() => {
    try { return JSON.parse(localStorage.getItem("jcc_exclude_terms") || "[]"); }
    catch { return []; }
  });
  const [excludeInput, setExcludeInput] = useState("");
  const [priorityOnly, setPriorityOnly] = useState(() => {
    return localStorage.getItem("jcc_priority_only") === "true";
  });
  const [scraping, setScraping] = useState(false);
  const [applying, setApplying] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      if (res.ok) setData(await res.json());
    } catch { /* server not running */ }
  }, []);

  const fetchStories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stories`);
      if (res.ok) setStories(await res.json());
    } catch { /* no stories yet */ }
  }, []);

  useEffect(() => { fetchJobs(); fetchStories(); }, [fetchJobs, fetchStories]);

  useEffect(() => {
    if (!scraping) return;
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, [scraping, fetchJobs]);

  // Persist exclude terms to localStorage
  useEffect(() => {
    localStorage.setItem("jcc_exclude_terms", JSON.stringify(excludeTerms));
  }, [excludeTerms]);

  // Persist priority-only toggle
  useEffect(() => {
    localStorage.setItem("jcc_priority_only", String(priorityOnly));
  }, [priorityOnly]);

  const addExcludeTerm = (term) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    if (excludeTerms.some(t => t.toLowerCase() === trimmed.toLowerCase())) return;
    setExcludeTerms([...excludeTerms, trimmed]);
    setExcludeInput("");
  };

  const removeExcludeTerm = (term) => {
    setExcludeTerms(excludeTerms.filter(t => t !== term));
  };

  const clearExcludeTerms = () => setExcludeTerms([]);

  const handleScrape = async (quick = false) => {
    setScraping(true);
    setStatusMsg("Scraping... check terminal for progress.");
    try {
      const res = await fetch(`${API_BASE}/scrape`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quick }) });
      const result = await res.json();
      if (!res.ok) setStatusMsg(result.error || "Scrape failed");
      else setStatusMsg(`Scrape started (${result.mode} mode). Refresh in a few minutes.`);
    } catch { setStatusMsg("Failed to start scrape. Is the server running?"); }
    setTimeout(() => { setScraping(false); fetchJobs(); }, 300000);
  };

  const handleApply = async (jobId) => {
    setApplying(jobId);
    setStatusMsg("Apply agent started. Check terminal for interaction.");
    try {
      const res = await fetch(`${API_BASE}/apply/${jobId}`, { method: "POST" });
      const result = await res.json();
      setStatusMsg(result.message || "Apply started");
    } catch { setStatusMsg("Failed to start apply agent."); }
    setTimeout(() => { setApplying(null); fetchJobs(); }, 5000);
  };

  const handleStatusChange = async (jobId, newStatus) => {
    try {
      await fetch(`${API_BASE}/jobs/${jobId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchJobs();
    } catch { setStatusMsg("Failed to update status."); }
  };

  const handleApplyAllNew = async () => {
    setStatusMsg("Batch apply started. Check terminal for interaction.");
    try {
      const res = await fetch(`${API_BASE}/apply-all-new`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }) });
      const result = await res.json();
      setStatusMsg(result.message || "Batch apply started");
    } catch { setStatusMsg("Failed to start batch apply."); }
  };

  // Debounce search input to avoid re-filtering on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Memoized filter function — stable across renders
  const filterFn = useMemo(() => {
    const s = debouncedSearch.toLowerCase();
    const excludeLower = excludeTerms.map(t => t.toLowerCase());
    return (jobs) => {
      if (!jobs || jobs.length === 0) return jobs;
      let f = jobs;
      if (s) {
        f = f.filter(j => (j.title || "").toLowerCase().includes(s) || (j.company || "").toLowerCase().includes(s) || (j.location || "").toLowerCase().includes(s));
      }
      if (filterATS !== "all") f = f.filter(j => j.ats === filterATS);
      if (priorityOnly) f = f.filter(j => j.priority);
      if (excludeLower.length > 0) {
        f = f.filter(j => {
          const title = (j.title || "").toLowerCase();
          const company = (j.company || "").toLowerCase();
          const location = (j.location || "").toLowerCase();
          return !excludeLower.some(t => title.includes(t) || company.includes(t) || location.includes(t));
        });
      }
      // Sort by score descending (nulls last)
      return [...f].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    };
  }, [debouncedSearch, filterATS, priorityOnly, excludeTerms]);

  // Pre-filter all sections once per filter change (instead of on every render)
  const filtered = useMemo(() => ({
    newToday: filterFn(data.newToday || []),
    previouslySeen: filterFn(data.previouslySeen || []),
    applied: filterFn(data.applied || []),
    responded: filterFn(data.responded || []),
    interviewing: filterFn(data.interviewing || []),
    offer: filterFn(data.offer || []),
    rejected: filterFn(data.rejected || []),
  }), [data, filterFn]);

  const filterJobs = (jobs) => jobs; // no-op now; sections use pre-filtered `filtered.*`

  // Count of jobs hidden by exclusions across visible job groups
  const hiddenCount = useMemo(() => {
    if (excludeTerms.length === 0) return 0;
    const allActive = [...(data.newToday || []), ...(data.previouslySeen || []), ...(data.applied || []), ...(data.responded || []), ...(data.interviewing || []), ...(data.offer || [])];
    const excludeLower = excludeTerms.map(t => t.toLowerCase());
    return allActive.filter(j => excludeLower.some(t => {
      const title = (j.title || "").toLowerCase();
      const company = (j.company || "").toLowerCase();
      const location = (j.location || "").toLowerCase();
      return title.includes(t) || company.includes(t) || location.includes(t);
    })).length;
  }, [data, excludeTerms]);

  const allATS = useMemo(() => {
    const all = [...data.newToday, ...data.previouslySeen, ...data.applied];
    return [...new Set(all.map(j => j.ats))].sort();
  }, [data]);

  const formatDate = (iso) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const ScoreBadge = ({ score }) => {
    if (score == null) return <span style={{ fontSize: 10, color: "#333" }}>--</span>;
    const color = getScoreColor(score);
    const display = Number(score).toFixed(2);
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}18`, padding: "2px 7px", borderRadius: 4, minWidth: 40, display: "inline-block", textAlign: "center" }}>
        {display}
      </span>
    );
  };

  const StatusSelect = ({ job }) => (
    <select
      value={job.status}
      onChange={(e) => handleStatusChange(job.id, e.target.value)}
      style={{
        background: "#111118", border: `1px solid ${STATUS_COLORS[job.status] || "#333"}`,
        borderRadius: 4, padding: "4px 8px", fontSize: 11, color: STATUS_COLORS[job.status] || "#888",
        cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
      }}
    >
      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
    </select>
  );

  const JobRow = ({ job, showApply = false }) => (
    <tr style={{ opacity: job.status === "rejected" || job.status === "skipped" ? 0.4 : 1, borderBottom: "1px solid #1a1a22" }}>
      <td style={{ padding: "10px 12px", fontSize: 12, maxWidth: 280 }}>
        {job.priority && <span title="Priority company" style={{ color: "#eab308", marginRight: 4 }}>★</span>}
        <a href={job.url} target="_blank" rel="noopener noreferrer" style={{ color: "#c4b5fd", textDecoration: "none" }}>
          {job.title || "Untitled"}
        </a>
      </td>
      <td style={{ padding: "10px 8px", fontSize: 12, color: "#e0e0e5" }}>{job.company || "\u2014"}</td>
      <td style={{ padding: "10px 8px", textAlign: "center" }}><ScoreBadge score={job.score} /></td>
      <td style={{ padding: "10px 8px", fontSize: 11, color: "#888" }}>{job.location || "\u2014"}</td>
      <td style={{ padding: "10px 8px", fontSize: 11, color: job.salary ? "#10b981" : "#333" }}>{job.salary || "\u2014"}</td>
      <td style={{ padding: "10px 8px" }}>
        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: `${ATS_COLORS[job.ats] || "#555"}22`, color: ATS_COLORS[job.ats] || "#555", textTransform: "uppercase", fontWeight: 600 }}>
          {job.ats}
        </span>
      </td>
      <td style={{ padding: "10px 8px", fontSize: 10, color: "#555" }}>{job.date_found}</td>
      <td style={{ padding: "10px 8px", display: "flex", gap: 4, alignItems: "center" }}>
        {showApply && (
          <button onClick={() => handleApply(job.id)} disabled={applying === job.id}
            style={{ background: applying === job.id ? "#333" : "#8b5cf6", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
            {applying === job.id ? "..." : "Apply"}
          </button>
        )}
        <StatusSelect job={job} />
      </td>
    </tr>
  );

  const JobTable = ({ jobs, showApply = false }) => (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #222" }}>
          {["Title", "Company", "Score", "Location", "Salary", "ATS", "Found", ""].map(h => (
            <th key={h} style={{ padding: "8px 12px", fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", textAlign: h === "Score" ? "center" : "left", fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {jobs.map(j => <JobRow key={j.id} job={j} showApply={showApply} />)}
      </tbody>
    </table>
  );

  const SectionHeader = ({ title, count, color = "#8b5cf6" }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 8px", padding: "0 4px" }}>
      <div style={{ width: 3, height: 16, background: color, borderRadius: 2 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e5", fontFamily: "'Space Grotesk', sans-serif" }}>{title}</span>
      <span style={{ fontSize: 11, color: "#555" }}>({count})</span>
    </div>
  );

  // Parse story bank markdown into sections
  const storySections = useMemo(() => {
    if (!stories.content) return [];
    return stories.content.split(/^---$/m).filter(s => s.trim()).map(section => {
      const lines = section.trim().split("\n");
      const headerLine = lines.find(l => l.startsWith("## "));
      const header = headerLine ? headerLine.replace("## ", "") : "Stories";
      const body = lines.filter(l => l !== headerLine).join("\n").trim();
      return { header, body };
    });
  }, [stories.content]);

  return (
    <div style={{ background: "#0a0a0f", color: "#e0e0e5", minHeight: "100vh", fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        input, select { font-family: inherit; }
        button:hover:not(:disabled) { filter: brightness(1.15); }
        tr:hover { background: #111118 !important; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg, #0d0d15 0%, #1a0d2e 100%)", borderBottom: "1px solid #222", padding: "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1400, margin: "0 auto" }}>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>
              <span style={{ color: "#8b5cf6" }}>&#9889;</span> JOB COMMAND CENTER
            </h1>
            <p style={{ fontSize: 10, color: "#555", marginTop: 2 }}>FDE / AI Deployment / Applied AI</p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#444", marginRight: 8 }}>
              Last scraped: {formatDate(data.last_scraped)}
            </span>
            <button onClick={() => handleScrape(false)} disabled={scraping}
              style={{ background: scraping ? "#333" : "#10b981", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
              {scraping ? "Scraping..." : "Scrape Now"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 24px" }}>
        {/* TAB NAVIGATION */}
        <div style={{ display: "flex", gap: 2, marginBottom: 12 }}>
          {[
            { id: "jobs", label: `Jobs (${data.total})` },
            { id: "pipeline", label: `Pipeline (${(data.applied?.length || 0) + (data.responded?.length || 0) + (data.interviewing?.length || 0) + (data.offer?.length || 0) + (data.rejected?.length || 0)})` },
            { id: "stories", label: `Stories (${stories.count})` },
          ].map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === "stories") fetchStories(); }}
              style={{
                background: activeTab === tab.id ? "#1a1a2e" : "transparent",
                border: activeTab === tab.id ? "1px solid #333" : "1px solid transparent",
                borderBottom: activeTab === tab.id ? "1px solid #1a1a2e" : "1px solid #333",
                borderRadius: "6px 6px 0 0", padding: "8px 16px", fontSize: 11, fontWeight: 600,
                color: activeTab === tab.id ? "#e0e0e5" : "#555", cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif",
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* STATUS MESSAGE */}
        {statusMsg && (
          <div style={{ background: "#111118", border: "1px solid #333", borderRadius: 6, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: "#888", display: "flex", justifyContent: "space-between" }}>
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg("")} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 11 }}>x</button>
          </div>
        )}

        {activeTab === "jobs" && (
          <>
            {/* STATS BAR */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 12 }}>
              {[
                { label: "Total", val: data.total, color: "#8b5cf6" },
                { label: "New Today", val: data.newToday?.length || 0, color: "#10b981" },
                { label: "Previously Seen", val: data.previouslySeen?.length || 0, color: "#f59e0b" },
                { label: "Applied", val: data.applied?.length || 0, color: "#3b82f6" },
                { label: "Interviewing", val: data.interviewing?.length || 0, color: "#a855f7" },
                { label: "Offers", val: data.offer?.length || 0, color: "#eab308" },
              ].map(s => (
                <div key={s.label} style={{ background: "#111118", border: "1px solid #1a1a22", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.val}</div>
                  <div style={{ fontSize: 8, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* SCRAPE ERRORS BANNER */}
            {data.scrape_errors?.filter(e => e.error !== "no results").length > 0 && (
              <div style={{ background: "#1a1111", border: "1px solid #3a1515", borderRadius: 6, padding: "6px 12px", marginBottom: 12, fontSize: 10, color: "#ef4444" }}>
                Scrape issues: {data.scrape_errors.filter(e => e.error !== "no results").map(e => e.source).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
              </div>
            )}

            {/* FILTERS + APPLY ALL */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input placeholder="Search titles, companies, locations..." value={search} onChange={e => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: 200, background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "8px 12px", color: "#e0e0e5", fontSize: 12 }} />
              <select value={filterATS} onChange={e => setFilterATS(e.target.value)}
                style={{ background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "8px", color: "#e0e0e5", fontSize: 11 }}>
                <option value="all">All ATS</option>
                {allATS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: priorityOnly ? "#eab308" : "#888", cursor: "pointer", padding: "8px 10px", background: "#111118", border: `1px solid ${priorityOnly ? "#eab308" : "#222"}`, borderRadius: 6 }}>
                <input type="checkbox" checked={priorityOnly} onChange={e => setPriorityOnly(e.target.checked)} style={{ cursor: "pointer" }} />
                <span>★ Priority only</span>
              </label>
              {(data.newToday?.length > 0 || data.previouslySeen?.length > 0) && (
                <button onClick={handleApplyAllNew}
                  style={{ background: "#7c3aed", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
                  Apply All New ({(data.newToday?.length || 0) + (data.previouslySeen?.length || 0)})
                </button>
              )}
              <button onClick={fetchJobs} style={{ background: "#222", color: "#888", border: "1px solid #333", padding: "8px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
                Refresh
              </button>
            </div>

            {/* EXCLUDE FILTER */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: "#0d0d15", border: "1px solid #1a1a22", borderRadius: 6 }}>
              <span style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Exclude</span>
              <input
                placeholder='e.g. "forward deployed", press Enter'
                value={excludeInput}
                onChange={e => setExcludeInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addExcludeTerm(excludeInput); } }}
                style={{ flex: 1, minWidth: 180, background: "#111118", border: "1px solid #222", borderRadius: 4, padding: "6px 10px", color: "#e0e0e5", fontSize: 11 }}
              />
              {excludeTerms.map(term => (
                <button
                  key={term}
                  onClick={() => removeExcludeTerm(term)}
                  title="Remove"
                  style={{ background: "#3a1515", color: "#fca5a5", border: "1px solid #5a1f1f", padding: "4px 8px 4px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
                >
                  {term}
                  <span style={{ fontSize: 12, opacity: 0.7 }}>&times;</span>
                </button>
              ))}
              {excludeTerms.length > 1 && (
                <button onClick={clearExcludeTerms} style={{ background: "transparent", color: "#666", border: "none", padding: "4px 6px", fontSize: 10, cursor: "pointer", textDecoration: "underline" }}>
                  Clear all
                </button>
              )}
              {hiddenCount > 0 && (
                <span style={{ fontSize: 10, color: "#fca5a5", marginLeft: "auto" }}>
                  {hiddenCount} hidden
                </span>
              )}
            </div>

            {/* NEW TODAY */}
            {filtered.newToday.length > 0 && (
              <>
                <SectionHeader title="New Today" count={filtered.newToday.length} color="#10b981" />
                <div style={{ background: "#0d0d15", border: "1px solid #1a2a1a", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.newToday} showApply={true} />
                </div>
              </>
            )}

            {/* PREVIOUSLY SEEN */}
            {filtered.previouslySeen.length > 0 && (
              <>
                <SectionHeader title="Previously Seen" count={filtered.previouslySeen.length} color="#f59e0b" />
                <div style={{ background: "#0d0d15", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.previouslySeen} showApply={true} />
                </div>
              </>
            )}

            {/* APPLIED */}
            {filtered.applied.length > 0 && (
              <>
                <SectionHeader title="Applied" count={filtered.applied.length} color="#3b82f6" />
                <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.applied} />
                </div>
              </>
            )}

            {/* RESPONDED */}
            {filtered.responded.length > 0 && (
              <>
                <SectionHeader title="Responded" count={filtered.responded.length} color="#60a5fa" />
                <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.responded} />
                </div>
              </>
            )}

            {/* INTERVIEWING */}
            {filtered.interviewing.length > 0 && (
              <>
                <SectionHeader title="Interviewing" count={filtered.interviewing.length} color="#a855f7" />
                <div style={{ background: "#0d0a15", border: "1px solid #2a1a3a", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.interviewing} />
                </div>
              </>
            )}

            {/* OFFER */}
            {filtered.offer.length > 0 && (
              <>
                <SectionHeader title="Offers" count={filtered.offer.length} color="#eab308" />
                <div style={{ background: "#0d0d10", border: "1px solid #3a3a1a", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.offer} />
                </div>
              </>
            )}

            {/* REJECTED */}
            {filtered.rejected.length > 0 && (
              <>
                <SectionHeader title="Rejected" count={filtered.rejected.length} color="#ef4444" />
                <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.rejected} />
                </div>
              </>
            )}

            {/* EMPTY STATE */}
            {data.total === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>&#128269;</div>
                <div style={{ fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 8 }}>No jobs yet</div>
                <div style={{ fontSize: 11, color: "#333" }}>Click "Scrape Now" to search for jobs across ATS platforms and job boards.</div>
              </div>
            )}
          </>
        )}

        {activeTab === "pipeline" && (
          <div style={{ marginTop: 8 }}>
            {/* PIPELINE STATS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 16 }}>
              {[
                { label: "Applied", val: data.applied?.length || 0, color: STATUS_COLORS.applied },
                { label: "Responded", val: data.responded?.length || 0, color: STATUS_COLORS.responded },
                { label: "Interviewing", val: data.interviewing?.length || 0, color: STATUS_COLORS.interviewing },
                { label: "Offers", val: data.offer?.length || 0, color: STATUS_COLORS.offer },
                { label: "Rejected", val: data.rejected?.length || 0, color: STATUS_COLORS.rejected },
              ].map(s => (
                <div key={s.label} style={{ background: "#111118", border: "1px solid #1a1a22", borderRadius: 8, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color, fontFamily: "'Space Grotesk', sans-serif" }}>{s.val}</div>
                  <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* INTERVIEWING — most important, show first */}
            {filtered.interviewing.length > 0 && (
              <>
                <SectionHeader title="Interviewing" count={filtered.interviewing.length} color={STATUS_COLORS.interviewing} />
                <div style={{ background: "#0d0a15", border: `1px solid ${STATUS_COLORS.interviewing}33`, borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.interviewing} />
                </div>
              </>
            )}

            {/* OFFERS */}
            {filtered.offer.length > 0 && (
              <>
                <SectionHeader title="Offers" count={filtered.offer.length} color={STATUS_COLORS.offer} />
                <div style={{ background: "#0d0d10", border: `1px solid ${STATUS_COLORS.offer}33`, borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.offer} />
                </div>
              </>
            )}

            {/* RESPONDED */}
            {filtered.responded.length > 0 && (
              <>
                <SectionHeader title="Responded" count={filtered.responded.length} color={STATUS_COLORS.responded} />
                <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.responded} />
                </div>
              </>
            )}

            {/* APPLIED */}
            {filtered.applied.length > 0 && (
              <>
                <SectionHeader title="Applied" count={filtered.applied.length} color={STATUS_COLORS.applied} />
                <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden" }}>
                  <JobTable jobs={filtered.applied} />
                </div>
              </>
            )}

            {/* REJECTED */}
            {filtered.rejected.length > 0 && (
              <>
                <SectionHeader title="Rejected" count={filtered.rejected.length} color={STATUS_COLORS.rejected} />
                <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden", opacity: 0.5 }}>
                  <JobTable jobs={filtered.rejected} />
                </div>
              </>
            )}

            {/* EMPTY STATE */}
            {(data.applied?.length || 0) + (data.responded?.length || 0) + (data.interviewing?.length || 0) + (data.offer?.length || 0) + (data.rejected?.length || 0) === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>&#128203;</div>
                <div style={{ fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 8 }}>Pipeline empty</div>
                <div style={{ fontSize: 11, color: "#333" }}>Change a job's status using the dropdown on the Jobs tab to start tracking it here.</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "stories" && (
          <div style={{ marginTop: 8 }}>
            {storySections.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>&#128218;</div>
                <div style={{ fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 8 }}>No stories yet</div>
                <div style={{ fontSize: 11, color: "#333" }}>Generate stories with: <code style={{ color: "#8b5cf6" }}>npm run stories -- &lt;job-id&gt;</code></div>
              </div>
            ) : (
              storySections.map((section, i) => (
                <div key={i} style={{ background: "#111118", border: "1px solid #1a1a22", borderRadius: 8, padding: "16px 20px", marginBottom: 12 }}>
                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, color: "#c4b5fd", marginBottom: 12 }}>
                    {section.header}
                  </h3>
                  <pre style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {section.body}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
