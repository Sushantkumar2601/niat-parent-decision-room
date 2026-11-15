// Node 22+ native HTTP + SQLite. No runtime dependencies.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
try {
  const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch {}
const PORT = process.env.PORT || 3000,
  ROOT = path.join(__dirname, "public");
const db = new DatabaseSync(
  process.env.DB_PATH || path.join(__dirname, "leads.db"),
);
db.exec("PRAGMA journal_mode=WAL");
db.exec(
  `CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,student_name TEXT NOT NULL,parent_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,city TEXT NOT NULL,class_year TEXT NOT NULL,preferred_city TEXT,budget TEXT,priority TEXT,objection TEXT,readiness TEXT,consent INTEGER NOT NULL DEFAULT 0,score INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'New',ai_brief TEXT NOT NULL,ai_model TEXT,email_status TEXT NOT NULL DEFAULT 'not_configured',webhook_status TEXT NOT NULL DEFAULT 'not_configured')`,
);
const FACTS = `Verified public NIAT facts (checked 16 Nov 2026): NIAT is an upskilling initiative by NxtWave, not a university or degree-awarding body. The collaborating university awards the degree after its coursework, examinations and required credits; NIAT upskilling is separate and non-credit. The public website lists 35+ collaborating institutions across 15 cities (directory may change by intake). NAT is a 90-minute assessment followed by counselling for qualified candidates and NIAT enrolment confirmation; university admission is separately governed by each university. Portal displays ₹1,200 NAT registration fee; recheck before payment. Fees, hostel, transport and facilities vary by institution. NIAT provides placement support but does not guarantee jobs or internships; some aggregate outcome figures include multiple NxtWave programs. Sources: https://www.niatindia.com/ ; https://www.niatindia.com/campus ; https://www.niatindia.com/llm-info ; https://apply.niatindia.com/login-gnc/`;
function json(res, status, data) {
  const s = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(s);
}
function validate(b) {
  for (const k of [
    "studentName",
    "parentName",
    "email",
    "phone",
    "city",
    "classYear",
    "objection",
  ])
    if (typeof b[k] !== "string" || !b[k].trim()) return `${k} is required`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))
    return "Enter a valid email address";
  if (!/^[+\d][\d\s-]{7,14}$/.test(b.phone))
    return "Enter a valid phone number";
  if (!["2026", "2027", "2028", "Other"].includes(b.classYear))
    return "Select a valid passing year";
  if (!b.consent) return "Consent is required";
  if (
    b.studentName.length > 80 ||
    b.parentName.length > 80 ||
    b.objection.length > 700
  )
    return "One or more fields are too long";
  return null;
}
function score(b) {
  let s = 25;
  if (b.readiness === "Ready to apply") s += 35;
  else if (b.readiness === "Shortlisting") s += 25;
  else s += 10;
  if (b.budget === "Budget confirmed") s += 15;
  else if (b.budget === "Need fee clarity") s += 8;
  if (b.preferredCity) s += 10;
  if (b.classYear === "2027") s += 10;
  return Math.min(100, s);
}
function fallback(b) {
  const actions = {
    "Degree and university recognition":
      "Confirm the exact degree-awarding university, program name, applicable approvals and university admission requirements directly with the university.",
    "Total fees and scholarships":
      "Request a written campus-specific breakup separating university fees, NIAT upskilling fees, hostel/mess and other charges; verify scholarship conditions.",
    "Placements and internships":
      "Ask for cohort-specific outcomes and distinguish placement support, internship opportunities and guarantees. NIAT states it does not guarantee employment.",
    "Campus, hostel and safety":
      "Confirm campus facilities, hostel location, accommodation type, fees, transport and student support with the selected institution.",
    "Course quality and practical learning":
      "Ask to inspect the current curriculum, project examples, lab access, mentor model, timetable and assessment method.",
    "Admission process and eligibility":
      "Verify NAT eligibility and timing with NIAT, then independently confirm the chosen university’s eligibility and admission steps.",
  };
  return {
    headline: `A decision brief for ${b.studentName}`,
    summary: `${b.studentName} is a ${b.classYear} applicant from ${b.city}. The family is ${b.readiness || "still exploring"} and has identified “${b.objection}” as the main decision question. Preferred location: ${b.preferredCity || "not specified"}.`,
    facts: [
      "NIAT is a NxtWave upskilling initiative; it is not the degree-awarding university.",
      "The collaborating university handles university admission and awards the degree after its academic requirements are met.",
      "NIAT upskilling is separate and non-credit; exact total costs vary by institution.",
      "NIAT offers placement support but does not guarantee a job or internship.",
    ],
    questions: [
      actions[b.objection] ||
        "Ask the authorised counsellor to clarify this concern with current campus-specific written information.",
      "What is the exact university and degree title for the preferred campus?",
      "Can the family receive the complete written fee schedule and refund policy?",
      "Which campus-specific hostel, transport and student-support arrangements apply?",
    ],
    nextStep:
      "Book a counselling conversation and ask the counsellor to verify every campus-specific item in writing.",
    caveat:
      "Informational preparation brief only—not an admission, legal, accreditation, fee or placement guarantee. Confirm campus-specific details with the university and authorised counsellor.",
  };
}
async function makeBrief(b) {
  if (!process.env.OPENAI_API_KEY)
    return {
      brief: fallback(b),
      model: "rule-based preview (OpenAI key not configured)",
      aiUsed: false,
    };
  const prompt = `You are an evidence-first admissions decision assistant. Return JSON with keys headline,summary,facts (array),questions (array),nextStep,caveat. Use only verified facts below plus the family's stated preferences. Never invent campus-specific fees, accreditation, placement rates, hostel details, admission chances or scholarships. Mark unknowns for counsellor confirmation. Do not pressure the family. VERIFIED FACTS: ${FACTS}\nLEAD: ${JSON.stringify({ studentName: b.studentName, parentName: b.parentName, city: b.city, classYear: b.classYear, preferredCity: b.preferredCity, budget: b.budget, priority: b.priority, objection: b.objection, readiness: b.readiness })}`;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return valid JSON only. Be factual and transparent about unknowns.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!r.ok) throw Error(`OpenAI API returned ${r.status}`);
  const d = await r.json(),
    raw = d.choices?.[0]?.message?.content;
  if (!raw) throw Error("Empty AI response");
  return {
    brief: JSON.parse(raw),
    model: d.model || process.env.OPENAI_MODEL,
    aiUsed: true,
  };
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function emailLead(lead, brief) {
  if (!process.env.RESEND_API_KEY) return "not_configured";
  const html = `<h2>${esc(brief.headline)}</h2><p>${esc(brief.summary)}</p><h3>Verified context</h3><ul>${(brief.facts || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><h3>Questions to resolve</h3><ol>${(brief.questions || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol><p>${esc(brief.nextStep)}</p><small>${esc(brief.caveat)}</small>`;
  async function send(to, subject, body) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:
          process.env.MAIL_FROM || "NIAT Decision Room <onboarding@resend.dev>",
        to: [to],
        subject,
        html: body,
      }),
    });
    if (!r.ok) throw Error(`Resend API returned ${r.status}`);
  }
  await send(lead.email, "Your personalised NIAT decision brief", html);
  if (process.env.COUNSELLOR_EMAIL)
    await send(
      process.env.COUNSELLOR_EMAIL,
      `New priority lead: ${lead.student_name} (score ${lead.score})`,
      `<p>${esc(lead.student_name)} / ${esc(lead.parent_name)} · ${esc(lead.phone)} · ${esc(lead.email)}</p><p>Score ${lead.score}; concern: ${esc(lead.objection)}</p>${html}`,
    );
  return "sent";
}
async function webhook(lead, brief) {
  if (!process.env.N8N_WEBHOOK_URL) return "not_configured";
  try {
    const r = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "lead.created", lead, brief }),
    });
    return r.ok ? "sent" : `failed_${r.status}`;
  } catch {
    return "failed";
  }
}
async function body(req) {
  let x = "";
  for await (const c of req) {
    x += c;
    if (x.length > 100000) throw Error("Payload too large");
  }
  return x ? JSON.parse(x) : {};
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      });
      return res.end();
    }
    const u = new URL(req.url, "http://localhost");
    if (req.method === "GET" && u.pathname === "/api/health")
      return json(res, 200, {
        ok: true,
        aiConfigured: !!process.env.OPENAI_API_KEY,
        emailConfigured: !!process.env.RESEND_API_KEY,
        automationConfigured: !!process.env.N8N_WEBHOOK_URL,
        storage: "SQLite (node:sqlite)",
      });
    if (req.method === "GET" && u.pathname === "/api/metrics") {
      const total = db.prepare("SELECT COUNT(*) n FROM leads").get().n,
        ready = db
          .prepare("SELECT COUNT(*) n FROM leads WHERE score>=65")
          .get().n,
        sent = db
          .prepare("SELECT COUNT(*) n FROM leads WHERE email_status='sent'")
          .get().n,
        avg = db
          .prepare("SELECT COALESCE(ROUND(AVG(score)),0) n FROM leads")
          .get().n;
      return json(res, 200, {
        total,
        ready,
        sent,
        avg,
        statuses: db
          .prepare("SELECT status,COUNT(*) count FROM leads GROUP BY status")
          .all(),
      });
    }
    if (req.method === "GET" && u.pathname === "/api/leads") {
      return json(res, 200, {
        leads: db
          .prepare(
            "SELECT id,created_at,student_name,parent_name,email,phone,city,class_year,preferred_city,budget,priority,objection,readiness,score,status,email_status,webhook_status,ai_model FROM leads ORDER BY created_at DESC LIMIT 250",
          )
          .all(),
      });
    }
    if (req.method === "POST" && u.pathname === "/api/leads") {
      const b = await body(req),
        err = validate(b);
      if (err) return json(res, 400, { error: err });
      const generated = await makeBrief(b),
        id = crypto.randomUUID(),
        now = new Date().toISOString(),
        s = score(b);
      const lead = {
        id,
        created_at: now,
        updated_at: now,
        student_name: b.studentName.trim(),
        parent_name: b.parentName.trim(),
        email: b.email.trim().toLowerCase(),
        phone: b.phone.trim(),
        city: b.city.trim(),
        class_year: b.classYear,
        preferred_city: b.preferredCity || "",
        budget: b.budget || "",
        priority: b.priority || "",
        objection: b.objection,
        readiness: b.readiness || "Exploring",
        consent: 1,
        score: s,
        status: "New",
        ai_brief: JSON.stringify(generated.brief),
        ai_model: generated.model,
        email_status: "not_configured",
        webhook_status: "not_configured",
      };
      db.prepare(
        `INSERT INTO leads(${Object.keys(lead).join(",")}) VALUES(${Object.keys(
          lead,
        )
          .map((k) => "@" + k)
          .join(",")})`,
      ).run(lead);
      let emailStatus = "not_configured",
        webhookStatus = "not_configured";
      try {
        emailStatus = await emailLead(lead, generated.brief);
      } catch (e) {
        emailStatus = "failed";
        console.error(e.message);
      }
      try {
        webhookStatus = await webhook(lead, generated.brief);
      } catch {
        webhookStatus = "failed";
      }
      db.prepare(
        "UPDATE leads SET email_status=?,webhook_status=?,updated_at=? WHERE id=?",
      ).run(emailStatus, webhookStatus, new Date().toISOString(), id);
      return json(res, 201, {
        id,
        score: s,
        brief: generated.brief,
        aiUsed: generated.aiUsed,
        aiModel: generated.model,
        emailStatus,
        webhookStatus,
      });
    }
    const statusMatch = u.pathname.match(/^\/api\/leads\/([^/]+)\/status$/);
    if (req.method === "PATCH" && statusMatch) {
      const b = await body(req),
        allowed = [
          "New",
          "Contacted",
          "Counselling booked",
          "Attended",
          "Enrolled",
          "Not proceeding",
        ];
      if (!allowed.includes(b.status))
        return json(res, 400, { error: "Invalid status" });
      const r = db
        .prepare("UPDATE leads SET status=?,updated_at=? WHERE id=?")
        .run(b.status, new Date().toISOString(), statusMatch[1]);
      return json(
        res,
        r.changes ? 200 : 404,
        r.changes ? { ok: true } : { error: "Lead not found" },
      );
    }
    const detail = u.pathname.match(/^\/api\/leads\/([^/]+)$/);
    if (req.method === "GET" && detail) {
      const lead = db.prepare("SELECT * FROM leads WHERE id=?").get(detail[1]);
      if (!lead) return json(res, 404, { error: "Not found" });
      lead.ai_brief = JSON.parse(lead.ai_brief);
      return json(res, 200, { lead });
    }
    if (req.method === "GET") {
      const file = path.join(
        ROOT,
        u.pathname === "/"
          ? "index.html"
          : path.normalize(u.pathname).replace(/^\/+/, ""),
      );
      if (!file.startsWith(ROOT)) return json(res, 403, { error: "Forbidden" });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile())
        return json(res, 404, { error: "Not found" });
      const ext = path.extname(file),
        types = {
          ".html": "text/html",
          ".css": "text/css",
          ".js": "text/javascript",
          ".svg": "image/svg+xml",
        };
      res.writeHead(200, {
        "Content-Type":
          (types[ext] || "application/octet-stream") + "; charset=utf-8",
      });
      return fs.createReadStream(file).pipe(res);
    }
    return json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    return json(res, 500, {
      error: "Server error",
      detail: process.env.NODE_ENV === "development" ? e.message : undefined,
    });
  }
});
server.listen(PORT, () =>
  console.log(`Parent Decision Room listening on ${PORT}`),
);
