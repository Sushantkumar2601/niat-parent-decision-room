let currentBrief = null,
  currentLeadId = null,
  allLeads = [];
const $ = (s) => document.querySelector(s);
function go(view) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("active", v.id === view));
  document
    .querySelectorAll(".nav")
    .forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  $("#pageTitle").textContent = {
    overview: "Growth overview",
    create: "Build a decision brief",
    leads: "Lead pipeline",
  }[view];
  if (view === "leads") loadLeads();
  if (view === "overview") loadDashboard();
  window.scrollTo(0, 0);
}
document
  .querySelectorAll("[data-view]")
  .forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
document
  .querySelectorAll("[data-go]")
  .forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
async function api(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}
async function loadDashboard() {
  try {
    const [m, l, h] = await Promise.all([
      api("/api/metrics"),
      api("/api/leads"),
      api("/api/health"),
    ]);
    $("#mTotal").textContent = m.total;
    $("#mReady").textContent = m.ready;
    $("#mSent").textContent = m.sent;
    $("#mAvg").textContent = m.avg;
    allLeads = l.leads;
    $("#recent").innerHTML =
      l.leads.slice(0, 5).map(recentRow).join("") ||
      '<div class="empty">No leads yet. Create the first decision brief.</div>';
    const states = [
      `AI: ${h.aiConfigured ? "API connected" : "API key needed"}`,
      `Email: ${h.emailConfigured ? "configured" : "not configured"}`,
      `n8n: ${h.automationConfigured ? "webhook connected" : "optional webhook not configured"}`,
    ];
    $("#integrationStatus").textContent = states.join("  ·  ");
    $("#syslabel").textContent = h.aiConfigured
      ? "AI API connected"
      : "AI key needed";
  } catch (e) {
    $("#integrationStatus").textContent = "Backend unavailable: " + e.message;
  }
}
function recentRow(x) {
  return `<div class="recent-row"><div><b>${esc(x.student_name)}</b><small>${esc(x.parent_name)}</small></div><div>${esc(x.city)}<small>${esc(x.objection)}</small></div><span class="score">${x.score}/100</span></div>`;
}
async function loadLeads() {
  try {
    const d = await api("/api/leads");
    allLeads = d.leads;
    renderLeads();
  } catch (e) {
    $("#leadRows").innerHTML =
      `<tr><td colspan="6">${esc(e.message)}</td></tr>`;
  }
}
function renderLeads() {
  const q = $("#searchLeads").value.toLowerCase(),
    st = $("#filterStatus").value;
  const rows = allLeads.filter(
    (x) =>
      (!st || x.status === st) &&
      [x.student_name, x.parent_name, x.city, x.email, x.objection]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  $("#leadRows").innerHTML =
    rows
      .map(
        (x) =>
          `<tr><td><b>${esc(x.student_name)}</b><small>${esc(x.parent_name)} · ${esc(x.email)}</small></td><td>${esc(x.city)}<small>${esc(x.class_year)} · ${esc(x.preferred_city || "No campus preference")}</small></td><td>${esc(x.objection)}</td><td><span class="score">${x.score}/100</span></td><td><select class="status-select" data-status="${x.id}">${["New", "Contacted", "Counselling booked", "Attended", "Enrolled", "Not proceeding"].map((s) => `<option ${s === x.status ? "selected" : ""}>${s}</option>`).join("")}</select></td><td>${x.ai_model?.includes("fallback") ? "Rule-based" : "AI"}<small>Email: ${esc(x.email_status)}</small></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6" class="empty">No matching leads.</td></tr>';
  document.querySelectorAll("[data-status]").forEach((el) =>
    el.addEventListener("change", async () => {
      try {
        await api(`/api/leads/${el.dataset.status}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: el.value }),
        });
      } catch (e) {
        alert(e.message);
      }
    }),
  );
}
$("#searchLeads").addEventListener("input", renderLeads);
$("#filterStatus").addEventListener("change", renderLeads);

$('#leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.currentTarget;
  const f = new FormData(form);
  const b = Object.fromEntries(f.entries());
  b.consent = f.get('consent') === 'on';

  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = 'Preparing your brief…';

  try {
    const d = await api('/api/leads', {
      method: 'POST',
      body: JSON.stringify(b)
    });

    currentBrief = d.brief;
    currentLeadId = d.id;

    showBrief(d, b);
    form.reset();

  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Generate AI decision brief <b>✳</b>';
  }
});

function showBrief(d, b) {
  $("#resultTitle").textContent =
    d.brief.headline || "Your decision brief is ready";
  $("#resultMeta").textContent =
    `Lead score ${d.score}/100 · ${d.aiUsed ? "Generated with " + d.aiModel : "Preview mode: OpenAI API key not configured"} · Email ${d.emailStatus}`;
  const block = (title, content) =>
    `<div class="brief-block"><h4>${title}</h4>${content}</div>`;
  $("#resultContent").innerHTML =
    block("Family context", `<p>${esc(d.brief.summary || "")}</p>`) +
    block(
      "Verified NIAT context",
      `<ul>${(d.brief.facts || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`,
    ) +
    block(
      "Questions for the counsellor",
      `<ol>${(d.brief.questions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`,
    ) +
    block("Recommended next step", `<p>${esc(d.brief.nextStep || "")}</p>`) +
    `<p class="caveat">${esc(d.brief.caveat || "")}</p>`;
  $("#resultModal").classList.remove("hidden");
}
$("#closeModal").addEventListener("click", () =>
  $("#resultModal").classList.add("hidden"),
);
$("#toLeads").addEventListener("click", () => {
  $("#resultModal").classList.add("hidden");
  go("leads");
});
$("#copyBrief").addEventListener("click", async () => {
  const t = [
    currentBrief.headline,
    currentBrief.summary,
    "VERIFIED FACTS",
    ...(currentBrief.facts || []),
    "COUNSELLOR QUESTIONS",
    ...(currentBrief.questions || []),
    currentBrief.nextStep,
    currentBrief.caveat,
  ].join("\n");
  await navigator.clipboard.writeText(t);
  $("#copyBrief").textContent = "Copied ✓";
});
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
loadDashboard();
