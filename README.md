# Parent Decision Room — NIAT Growth Hack Challenge

A conversion-focused prototype for Track B: turn existing interested leads into better-prepared counselling conversations through an AI-generated, evidence-first family decision brief.

## Product workflow

1. **Family intake** — responsive form captures student/parent context, contact details, preferred location, readiness and primary objection; validates consent and input.
2. **AI decision brief** — server calls the OpenAI Chat Completions API to synthesise the lead context with a curated set of verified public NIAT facts. The model is instructed not to invent campus-specific details. If no API key is configured, a transparent rule-based preview is used and labelled as such.
3. **Lead intelligence** — lead is stored in SQLite and assigned a transparent 0–100 readiness score.
4. **Follow-up automation** — Nodemailer sends the family brief and optional counsellor handoff; optional n8n webhook posts the lead + brief to an automation workflow.
5. **Growth dashboard** — metrics, lead list, status updates, score and email status.

## Connected tools

- OpenAI API (real model inference when `OPENAI_API_KEY` is set)
- SQLite via better-sqlite3 (persistent lead store)
- Resend Email API (family and optional counsellor email)
- n8n webhook (optional downstream workflow)
- Express.js API / web server

## Run locally

Requires Node.js 22.5+ (uses the built-in `node:sqlite` module).

```bash
cp .env.example .env
npm install
# Fill OPENAI_API_KEY and optional Resend / n8n values in .env
npm start
```

Open http://localhost:3000.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | HTTP port (default 3000) |
| `OPENAI_API_KEY` | For live AI | Server-side OpenAI API key; never expose in browser |
| `OPENAI_MODEL` | No | Defaults to `gpt-4.1-mini` |
| `RESEND_API_KEY` | For email | Resend API key (server-side) |
| `MAIL_FROM` | No | Sender identity |
| `COUNSELLOR_EMAIL` | No | Optional counsellor handoff recipient |
| `N8N_WEBHOOK_URL` | No | Optional n8n webhook URL |

## Deployment

Deploy as a Node web service on Render, Railway, Fly.io or another Node host. Build command: `npm install`; start command: `npm start`. Add environment variables in the host dashboard. Mount a persistent disk for `leads.db` (set `DB_PATH` to the mounted path). Configure OpenAI and Resend credentials server-side. Test `/api/health`, create a test lead, check AI generation, email delivery, n8n execution and lead status update. This project is not yet deployed; no hosting credentials are embedded.

## n8n workflow idea

Webhook trigger (`lead.created`) → IF score >= 65 → send internal Slack/email notification → append to CRM/Google Sheet → create counsellor follow-up task. The application posts the payload when `N8N_WEBHOOK_URL` is configured.

## API routes

- `GET /api/health`
- `GET /api/metrics`
- `GET /api/leads`
- `GET /api/leads/:id`
- `POST /api/leads`
- `PATCH /api/leads/:id/status`

## Trust and data handling

This is an independent challenge prototype, not an official NIAT tool. It does not make admission recommendations, promise outcomes, or infer campus-specific fees/hostel/accreditation facts. Families should verify details with the university and authorised NIAT counsellor. Collect only necessary data, obtain consent, and configure retention/access controls before any real-world pilot. SQLite is suitable for a demo; production should use managed Postgres/MongoDB, authentication, role-based access, audit logs, rate limiting and an approved privacy notice.

## Testing notes

Verified locally on Node v22.16.0: HTTP homepage, CSS and JS returned 200; `/api/health` returned healthy; valid test lead was created and persisted; brief generation returned the labelled rule-based preview because no OpenAI key was present; metrics, lead detail and status update worked; invalid input returned 400; `node --test` passed the end-to-end API test. Live AI, Resend email and n8n delivery have not been tested because credentials/webhook authorization were not provided. The rule-based preview is not represented as a real AI inference.
