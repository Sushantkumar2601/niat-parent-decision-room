const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
test("end-to-end API: validation, AI preview, persistence, dashboard and status update", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "niat-room-"));
  const port = 31000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, "test.db"),
      OPENAI_API_KEY: "",
      RESEND_API_KEY: "",
      N8N_WEBHOOK_URL: "",
    },
    stdio: "ignore",
  });
  t.after(() => {
    child.kill("SIGTERM");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 40; i++) {
    try {
      health = await fetch(base + "/api/health");
      if (health.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(health && health.ok, "server should start");
  let r = await fetch(base + "/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  const lead = {
    studentName: "Test Student",
    parentName: "Test Parent",
    email: "test@example.com",
    phone: "9876543210",
    city: "Delhi",
    classYear: "2027",
    preferredCity: "Delhi NCR",
    budget: "Need fee clarity",
    priority: "Degree and recognition",
    objection: "Total fees and scholarships",
    readiness: "Shortlisting",
    consent: true,
  };
  r = await fetch(base + "/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead),
  });
  assert.equal(r.status, 201);
  const created = await r.json();
  assert.equal(created.aiUsed, false);
  assert.ok(created.score >= 65);
  assert.match(created.brief.caveat, /not an admission/);
  const metrics = await (await fetch(base + "/api/metrics")).json();
  assert.equal(metrics.total, 1);
  assert.equal(metrics.ready, 1);
  r = await fetch(`${base}/api/leads/${created.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Counselling booked" }),
  });
  assert.equal(r.status, 200);
  const detail = await (await fetch(`${base}/api/leads/${created.id}`)).json();
  assert.equal(detail.lead.status, "Counselling booked");
  assert.equal(detail.lead.student_name, "Test Student");
});
