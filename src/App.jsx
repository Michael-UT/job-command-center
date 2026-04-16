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
  builtin: "#14b8a6",
  startup_jobs: "#f97316",
  ai_jobs: "#06b6d4",
  unknown: "#555",
};

const EMPTY_PROFILE = { titles: [], negativeTitleKeywords: [], qualificationKeywords: [] };

function sanitizeItem(value) {
  return value.trim().replace(/\s+/g, " ");
}

function sanitizeNegativeItem(value) {
  return sanitizeItem(value)
    .replace(/^-+/, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

function addUniqueItem(items, rawValue) {
  const value = sanitizeItem(rawValue);
  if (!value) return items;
  if (items.some((item) => item.toLowerCase() === value.toLowerCase())) return items;
  return [...items, value];
}

function addUniqueNegativeItem(items, rawValue) {
  const value = sanitizeNegativeItem(rawValue);
  if (!value) return items;
  if (items.some((item) => item.toLowerCase() === value.toLowerCase())) return items;
  return [...items, value];
}

function removeItem(items, index) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function normalizeProfile(profile) {
  return {
    titles: profile?.titles || [],
    negativeTitleKeywords: profile?.negativeTitleKeywords || [],
    qualificationKeywords: profile?.qualificationKeywords || [],
  };
}

function addTitleInput(profile, rawValue) {
  const value = sanitizeItem(rawValue);
  if (!value) return profile;

  if (value.startsWith("-")) {
    return {
      ...profile,
      negativeTitleKeywords: addUniqueNegativeItem(profile.negativeTitleKeywords, value),
    };
  }

  return {
    ...profile,
    titles: addUniqueItem(profile.titles, value),
  };
}

function formatNegativeKeyword(value) {
  return `-${value}`;
}

function profileEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getMatchColor(score) {
  if (score >= 8) return "#10b981";
  if (score >= 6) return "#3b82f6";
  if (score >= 4) return "#f59e0b";
  return "#555";
}

function ChipEditor({
  label,
  items,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  placeholder,
  helpText,
  formatItemLabel = (item) => item,
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e0e5", marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: "#666" }}>{helpText}</div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          minHeight: 46,
          background: "#0a0a10",
          border: "1px solid #1a1a22",
          borderRadius: 8,
          padding: 8,
        }}
      >
        {items.map((item, index) => (
          <span
            key={`${item}-${index}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: formatItemLabel(item).startsWith("-") ? "#1c1114" : "#171722",
              border: formatItemLabel(item).startsWith("-") ? "1px solid #3b1c24" : "1px solid #252538",
              borderRadius: 999,
              padding: "5px 10px",
              fontSize: 10,
              color: formatItemLabel(item).startsWith("-") ? "#fca5a5" : "#d4d4dc",
            }}
          >
            <span>{formatItemLabel(item)}</span>
            <button
              onClick={() => onRemove(index)}
              style={{
                background: "none",
                border: "none",
                color: formatItemLabel(item).startsWith("-") ? "#d97777" : "#777",
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1,
              }}
              aria-label={`Remove ${formatItemLabel(item)}`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          style={{
            flex: 1,
            minWidth: 220,
            background: "transparent",
            border: "none",
            color: "#e0e0e5",
            fontSize: 11,
            outline: "none",
            padding: "6px 4px",
          }}
        />
      </div>
    </div>
  );
}

export default function JobCommandCenter() {
  const [data, setData] = useState({
    newToday: [],
    previouslySeen: [],
    applied: [],
    skipped: [],
    total: 0,
    last_scraped: null,
    scrape_stats: null,
    scrape_errors: [],
  });
  const [searchProfile, setSearchProfile] = useState(EMPTY_PROFILE);
  const [savedSearchProfile, setSavedSearchProfile] = useState(EMPTY_PROFILE);
  const [defaultProfile, setDefaultProfile] = useState(EMPTY_PROFILE);
  const [profileStats, setProfileStats] = useState(null);
  const [titleInput, setTitleInput] = useState("");
  const [negativeTitleInput, setNegativeTitleInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [search, setSearch] = useState("");
  const [filterATS, setFilterATS] = useState("all");
  const [minMatch, setMinMatch] = useState("all");
  const [scraping, setScraping] = useState(false);
  const [applying, setApplying] = useState(null);
  const [batchLimit, setBatchLimit] = useState("10");
  const [statusMsg, setStatusMsg] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/jobs`);
      if (res.ok) setData(await res.json());
    } catch {
      // server not running
    }
  }, []);

  const fetchSearchProfile = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/search-profile`);
      if (!res.ok) return;
      const result = await res.json();
      setSearchProfile(normalizeProfile(result.profile));
      setSavedSearchProfile(normalizeProfile(result.profile));
      setDefaultProfile(normalizeProfile(result.defaults));
      setProfileStats(result.query_matrix);
    } catch {
      // server not running
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchSearchProfile();
  }, [fetchJobs, fetchSearchProfile]);

  useEffect(() => {
    if (!scraping) return;
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, [scraping, fetchJobs]);

  const profileDirty = useMemo(
    () => !profileEquals(searchProfile, savedSearchProfile),
    [savedSearchProfile, searchProfile],
  );

  const handleScrape = async (quick = false) => {
    setScraping(true);
    setStatusMsg("Scraping with the current search profile. Check terminal for progress.");
    try {
      const res = await fetch(`${API_BASE}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quick }),
      });
      const result = await res.json();
      if (!res.ok) setStatusMsg(result.error || "Scrape failed");
      else setStatusMsg(`Scrape started (${result.mode} mode). Refresh in a few minutes.`);
    } catch {
      setStatusMsg("Failed to start scrape. Is the server running?");
    }
    setTimeout(() => {
      setScraping(false);
      fetchJobs();
    }, 300000);
  };

  const handleApply = async (jobId) => {
    setApplying(jobId);
    setStatusMsg("Apply agent started. Check terminal for interaction.");
    try {
      const res = await fetch(`${API_BASE}/apply/${jobId}`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) setStatusMsg(result.error || "Failed to start apply agent.");
      else setStatusMsg(result.message || "Apply started");
    } catch {
      setStatusMsg("Failed to start apply agent.");
    }
    setTimeout(() => {
      setApplying(null);
      fetchJobs();
    }, 5000);
  };

  const handleApplyAllNew = async () => {
    const parsed = Number.parseInt(batchLimit, 10);
    const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
    setStatusMsg(`Batch apply requested for up to ${limit} jobs. Check terminal for interaction.`);
    try {
      const res = await fetch(`${API_BASE}/apply-all-new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      const result = await res.json();
      if (!res.ok) setStatusMsg(result.error || "Failed to start batch apply.");
      else setStatusMsg(result.message || `Batch apply started for up to ${limit} jobs`);
    } catch {
      setStatusMsg("Failed to start batch apply.");
    }
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const res = await fetch(`${API_BASE}/search-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchProfile),
      });
      const result = await res.json();
      if (!res.ok) {
        setStatusMsg(result.error || "Failed to save search profile.");
        return;
      }

      setSearchProfile(normalizeProfile(result.profile));
      setSavedSearchProfile(normalizeProfile(result.profile));
      setDefaultProfile(normalizeProfile(result.defaults));
      setProfileStats(result.query_matrix);
      setStatusMsg("Search profile saved. The next scrape will use the updated titles, exclusions, and keywords.");
      fetchJobs();
    } catch {
      setStatusMsg("Failed to save search profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const filterJobs = (jobs) => {
    let filtered = jobs;

    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter((job) =>
        (job.title || "").toLowerCase().includes(lowerSearch)
        || (job.company || "").toLowerCase().includes(lowerSearch)
        || (job.location || "").toLowerCase().includes(lowerSearch),
      );
    }

    if (filterATS !== "all") {
      filtered = filtered.filter((job) => job.ats === filterATS);
    }

    if (minMatch !== "all") {
      const threshold = Number.parseInt(minMatch, 10);
      filtered = filtered.filter((job) => (job.match_score ?? -1) >= threshold);
    }

    return filtered;
  };

  const allATS = useMemo(() => {
    const all = [...data.newToday, ...data.previouslySeen, ...data.applied];
    return [...new Set(all.map((job) => job.ats))].sort();
  }, [data]);

  const formatDate = (iso) => {
    if (!iso) return "Never";
    const date = new Date(iso);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      + " "
      + date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const subtitle = useMemo(() => {
    if (searchProfile.titles.length === 0 && searchProfile.negativeTitleKeywords.length === 0) {
      return "Dynamic role search profile";
    }

    const preview = searchProfile.titles.slice(0, 3).join(" / ");
    const titleSummary = searchProfile.titles.length > 3
      ? `${preview} +${searchProfile.titles.length - 3} more`
      : preview;

    if (searchProfile.negativeTitleKeywords.length === 0) {
      return titleSummary;
    }

    const exclusionPreview = searchProfile.negativeTitleKeywords
      .slice(0, 2)
      .map(formatNegativeKeyword)
      .join(", ");

    return `${titleSummary} | excludes ${exclusionPreview}${searchProfile.negativeTitleKeywords.length > 2 ? ` +${searchProfile.negativeTitleKeywords.length - 2} more` : ""}`;
  }, [searchProfile]);

  const JobRow = ({ job, greyed = false }) => {
    const matchColor = getMatchColor(job.match_score ?? 0);

    return (
      <tr style={{ opacity: greyed ? 0.4 : 1, borderBottom: "1px solid #1a1a22" }}>
        <td style={{ padding: "10px 12px", fontSize: 12, maxWidth: 280 }}>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: greyed ? "#555" : "#c4b5fd", textDecoration: "none" }}
          >
            {job.title || "Untitled"}
          </a>
        </td>
        <td style={{ padding: "10px 8px", fontSize: 12, color: greyed ? "#444" : "#e0e0e5" }}>
          {job.company || "—"}
        </td>
        <td style={{ padding: "10px 8px", fontSize: 11, color: greyed ? "#444" : "#888" }}>
          {job.location || "—"}
        </td>
        <td style={{ padding: "10px 8px", fontSize: 11, color: job.salary ? (greyed ? "#444" : "#10b981") : "#333" }}>
          {job.salary || "—"}
        </td>
        <td style={{ padding: "10px 8px" }}>
          <span
            title={job.match_summary || "Local score from title, summary, and qualifications"}
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 4,
              background: `${matchColor}22`,
              color: matchColor,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {job.match_score ?? "—"}/10
          </span>
        </td>
        <td style={{ padding: "10px 8px" }}>
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 4,
              background: `${ATS_COLORS[job.ats] || "#555"}22`,
              color: ATS_COLORS[job.ats] || "#555",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            {job.ats}
          </span>
        </td>
        <td style={{ padding: "10px 8px", fontSize: 10, color: "#555" }}>{job.date_found}</td>
        <td style={{ padding: "10px 8px" }}>
          {greyed ? (
            <span style={{ fontSize: 10, color: "#555" }}>
              Applied {job.date_applied ? formatDate(job.date_applied) : ""}
            </span>
          ) : (
            <button
              onClick={() => handleApply(job.id)}
              disabled={applying === job.id}
              style={{
                background: applying === job.id ? "#333" : "#8b5cf6",
                color: "#fff",
                border: "none",
                padding: "4px 12px",
                borderRadius: 4,
                fontSize: 10,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {applying === job.id ? "..." : "Apply"}
            </button>
          )}
        </td>
      </tr>
    );
  };

  const JobTable = ({ jobs, greyed = false }) => (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid #222" }}>
          {["Title", "Company", "Location", "Salary", "Match", "ATS", "Found", ""].map((heading) => (
            <th
              key={heading}
              style={{
                padding: "8px 12px",
                fontSize: 9,
                color: "#555",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                textAlign: "left",
                fontWeight: 600,
              }}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} greyed={greyed} />
        ))}
      </tbody>
    </table>
  );

  const SectionHeader = ({ title, count, color = "#8b5cf6" }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 8px", padding: "0 4px" }}>
      <div style={{ width: 3, height: 16, background: color, borderRadius: 2 }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0e5", fontFamily: "'Space Grotesk', sans-serif" }}>
        {title}
      </span>
      <span style={{ fontSize: 11, color: "#555" }}>({count})</span>
    </div>
  );

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

      <div style={{ background: "linear-gradient(135deg, #0d0d15 0%, #1a0d2e 100%)", borderBottom: "1px solid #222", padding: "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 1400, margin: "0 auto", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>
              <span style={{ color: "#8b5cf6" }}>&#9889;</span> JOB COMMAND CENTER
            </h1>
            <p style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{subtitle}</p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#444", marginRight: 8 }}>
              Last scraped: {formatDate(data.last_scraped)}
            </span>
            <button
              onClick={() => handleScrape(true)}
              disabled={scraping}
              style={{
                background: "#1f2937",
                color: "#d1d5db",
                border: "1px solid #374151",
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Quick Scrape
            </button>
            <button
              onClick={() => handleScrape(false)}
              disabled={scraping}
              style={{
                background: scraping ? "#333" : "#10b981",
                color: "#fff",
                border: "none",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
              }}
            >
              {scraping ? "Scraping..." : "Scrape Now"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 24px" }}>
        {statusMsg && (
          <div style={{ background: "#111118", border: "1px solid #333", borderRadius: 6, padding: "8px 14px", marginBottom: 12, fontSize: 11, color: "#888", display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg("")} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 11 }}>
              x
            </button>
          </div>
        )}

        <div style={{ background: "#111118", border: "1px solid #1a1a22", borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#f3f4f6", marginBottom: 4, fontFamily: "'Space Grotesk', sans-serif" }}>
                Search Profile
              </div>
              <div style={{ fontSize: 10, color: "#666" }}>
                Target roles drive scraping queries. Negative title keywords are passed directly into Google-style `-term` filters. Qualification keywords drive the local 0–10 match score from cleaned job text.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "Titles", value: searchProfile.titles.length, color: "#8b5cf6" },
                { label: "Excludes", value: searchProfile.negativeTitleKeywords.length, color: "#ef4444" },
                { label: "Keywords", value: searchProfile.qualificationKeywords.length, color: "#10b981" },
                { label: "Batches", value: profileStats?.titleBatches || 0, color: "#f59e0b" },
                { label: "Queries", value: profileStats?.totalQueries || 0, color: "#3b82f6" },
              ].map((item) => (
                <div key={item.label} style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, padding: "8px 10px", minWidth: 80 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: item.color, fontFamily: "'Space Grotesk', sans-serif" }}>
                    {item.value}
                  </div>
                  <div style={{ fontSize: 8, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <ChipEditor
              label="Target Role Titles"
              items={searchProfile.titles}
              inputValue={titleInput}
              onInputChange={setTitleInput}
              onAdd={() => {
                setSearchProfile((current) => addTitleInput(current, titleInput));
                setTitleInput("");
              }}
              onRemove={(index) =>
                setSearchProfile((current) => ({
                  ...current,
                  titles: removeItem(current.titles, index),
                }))
              }
              placeholder='Type a role title and press Enter, for example "solutions architect AI"'
              helpText='These titles are chunked into scrape queries. If you type `-intern` here, it will be routed into the exclusion box below.'
            />

            <ChipEditor
              label="Negative Title Keywords"
              items={searchProfile.negativeTitleKeywords}
              inputValue={negativeTitleInput}
              onInputChange={setNegativeTitleInput}
              onAdd={() => {
                setSearchProfile((current) => ({
                  ...current,
                  negativeTitleKeywords: addUniqueNegativeItem(
                    current.negativeTitleKeywords,
                    negativeTitleInput,
                  ),
                }));
                setNegativeTitleInput("");
              }}
              onRemove={(index) =>
                setSearchProfile((current) => ({
                  ...current,
                  negativeTitleKeywords: removeItem(current.negativeTitleKeywords, index),
                }))
              }
              placeholder='Type a negative keyword and press Enter, for example "intern"'
              helpText="These are passed directly into the Google query as exclusions, so `intern` becomes `-intern`."
              formatItemLabel={formatNegativeKeyword}
            />

            <ChipEditor
              label="Qualification Keywords"
              items={searchProfile.qualificationKeywords}
              inputValue={keywordInput}
              onInputChange={setKeywordInput}
              onAdd={() => {
                setSearchProfile((current) => ({
                  ...current,
                  qualificationKeywords: addUniqueItem(current.qualificationKeywords, keywordInput),
                }));
                setKeywordInput("");
              }}
              onRemove={(index) =>
                setSearchProfile((current) => ({
                  ...current,
                  qualificationKeywords: removeItem(current.qualificationKeywords, index),
                }))
              }
              placeholder='Type a keyword and press Enter, for example "enterprise ai"'
              helpText="These are matched against cleaned job summaries and qualification sections, not raw HTML."
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={handleSaveProfile}
              disabled={profileSaving || !profileDirty}
              style={{
                background: profileSaving || !profileDirty ? "#333" : "#8b5cf6",
                color: "#fff",
                border: "none",
                padding: "8px 14px",
                borderRadius: 6,
                fontSize: 11,
                cursor: profileSaving || !profileDirty ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {profileSaving ? "Saving..." : "Save Search Profile"}
            </button>
            <button
              onClick={() => setSearchProfile(defaultProfile)}
              style={{
                background: "#0a0a10",
                color: "#aaa",
                border: "1px solid #2b2b3a",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Reset Defaults
            </button>
            {profileDirty && (
              <span style={{ fontSize: 10, color: "#888", alignSelf: "center" }}>
                Unsaved changes. Save before rescoring the board or running a scrape with the new profile.
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Total", val: data.total, color: "#8b5cf6" },
            { label: "New Today", val: data.newToday?.length || 0, color: "#10b981" },
            { label: "Previously Seen", val: data.previouslySeen?.length || 0, color: "#f59e0b" },
            { label: "Applied", val: data.applied?.length || 0, color: "#3b82f6" },
            { label: "Partial Data", val: data.scrape_stats?.detail_fetch_failed || 0, color: "#f59e0b" },
          ].map((stat) => (
            <div key={stat.label} style={{ background: "#111118", border: "1px solid #1a1a22", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: stat.color, fontFamily: "'Space Grotesk', sans-serif" }}>
                {stat.val}
              </div>
              <div style={{ fontSize: 8, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {data.scrape_errors?.length > 0 && (
          <div style={{ background: "#1a1111", border: "1px solid #3a1515", borderRadius: 6, padding: "6px 12px", marginBottom: 12, fontSize: 10, color: "#ef4444" }}>
            Scrape issues: {data.scrape_errors.map((error) => error.source).filter((value, index, array) => array.indexOf(value) === index).join(", ")}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search titles, companies, locations..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ flex: 1, minWidth: 200, background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "8px 12px", color: "#e0e0e5", fontSize: 12 }}
          />
          <select
            value={filterATS}
            onChange={(event) => setFilterATS(event.target.value)}
            style={{ background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "8px", color: "#e0e0e5", fontSize: 11 }}
          >
            <option value="all">All ATS</option>
            {allATS.map((ats) => (
              <option key={ats} value={ats}>{ats}</option>
            ))}
          </select>
          <select
            value={minMatch}
            onChange={(event) => setMinMatch(event.target.value)}
            style={{ background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "8px", color: "#e0e0e5", fontSize: 11 }}
          >
            <option value="all">All Matches</option>
            <option value="8">8+/10</option>
            <option value="6">6+/10</option>
            <option value="4">4+/10</option>
          </select>
          {(data.newToday?.length > 0 || data.previouslySeen?.length > 0) && (
            <>
              <input
                type="number"
                min="1"
                max="50"
                inputMode="numeric"
                value={batchLimit}
                onChange={(event) => setBatchLimit(event.target.value)}
                aria-label="Batch apply limit"
                style={{ width: 84, background: "#111118", border: "1px solid #222", borderRadius: 6, padding: "8px 10px", color: "#e0e0e5", fontSize: 11 }}
              />
              <button
                onClick={handleApplyAllNew}
                style={{ background: "#7c3aed", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}
              >
                Apply Pending ({(data.newToday?.length || 0) + (data.previouslySeen?.length || 0)})
              </button>
            </>
          )}
          <button onClick={fetchJobs} style={{ background: "#222", color: "#888", border: "1px solid #333", padding: "8px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
            Refresh
          </button>
        </div>

        {filterJobs(data.newToday || []).length > 0 && (
          <>
            <SectionHeader title="New Today" count={filterJobs(data.newToday).length} color="#10b981" />
            <div style={{ background: "#0d0d15", border: "1px solid #1a2a1a", borderRadius: 8, overflow: "hidden" }}>
              <JobTable jobs={filterJobs(data.newToday)} />
            </div>
          </>
        )}

        {filterJobs(data.previouslySeen || []).length > 0 && (
          <>
            <SectionHeader title="Previously Seen" count={filterJobs(data.previouslySeen).length} color="#f59e0b" />
            <div style={{ background: "#0d0d15", border: "1px solid #222", borderRadius: 8, overflow: "hidden" }}>
              <JobTable jobs={filterJobs(data.previouslySeen)} />
            </div>
          </>
        )}

        {filterJobs(data.applied || []).length > 0 && (
          <>
            <SectionHeader title="Applied" count={filterJobs(data.applied).length} color="#3b82f6" />
            <div style={{ background: "#0a0a10", border: "1px solid #1a1a22", borderRadius: 8, overflow: "hidden" }}>
              <JobTable jobs={filterJobs(data.applied)} greyed={true} />
            </div>
          </>
        )}

        {data.total === 0 && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#128269;</div>
            <div style={{ fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", marginBottom: 8 }}>
              No jobs yet
            </div>
            <div style={{ fontSize: 11, color: "#333" }}>
              Save a search profile, then click "Scrape Now" to search across ATS platforms and job boards.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
