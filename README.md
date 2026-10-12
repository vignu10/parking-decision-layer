# Parking Operations Decision Layer (powered by Jev)

A pilot build of the PRD *"Parking Operations Decision Layer"*, covering the **support desk** (S-1 to S-8),
the **agent guard** (D-9, D-10) and the **shared decision layer** (F-1 to F-8).

> AI sorts and suggests. Business rules and people keep control of money and safety.

```
item ─► Jev (typed questions, one call) ─► our rules ─► AUTO | REVIEW | HUMAN | BLOCKED ─► actions + audit log
                                          1. hard rules (safety, money, policy)
                                          2. confidence gate = weakest gating question
```

## Run it

```bash
npm install
cp .env.example .env.local     # optional: JEV_PROVIDER=mock is the default
npm run dev                    # http://localhost:3000
npm test                       # 38 tests, including PRD §12 acceptance criteria
```

Runs fully offline with a deterministic **mock Jev**, so a demo never depends on the network.

### Switching to real Jev

| `JEV_PROVIDER` | Key | Endpoint |
|---|---|---|
| `mock` (default) | none | offline keyword heuristics |
| `vercel` | `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/v1/evaluate`, model `typesafe-ai/jev` (no waitlist) |
| `typesafe` | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone`, model `jev-latest` |

**Before relying on a real provider, run one real call** (PRD §10 says the request/response field names are unverified):

```bash
JEV_PROVIDER=vercel AI_GATEWAY_API_KEY=... npm run verify:jev
```

It prints the request, the raw response and how we parse it. If parsing fails, adjust `parseAnswers()` in
`src/lib/jev/http.ts`. Until then, any response we can't read routes to HUMAN — never to AUTO.

## The console

| Page | What it shows |
|---|---|
| **Triage** | Send a support message or an agent action; see Jev's typed answers, the confidence gate against the thresholds, the route, the rule that fired, the actions and exactly what was sent to Jev (after redaction). Includes `API failure + safety` and `timeout` demo samples. |
| **Queue** | REVIEW and HUMAN items, safety and urgent first. Approve & execute / Reject (logged as an override) / Mark handled. Money moves only from here. |
| **Audit log** | Append-only events: decisions, actions, approvals, rejections, errors, config changes. Export as JSONL. |
| **Evaluate** | Rollout phase 1: runs the labelled sample set with the current settings and reports agreement by confidence band, against the 95% AUTO-band target. |
| **Settings** | Thresholds, safety trigger, shadow mode, per-workflow kill switches, AUTO toggles per action, refund limit, timeout, redaction. |

### Demo script (about 10 minutes)

Before the meeting: run **Evaluate** on real Jev, set the safety trigger and thresholds in **Settings**, then
make a few decisions so the tiles aren't empty. Keep a mock deployment or `npm run dev` with `JEV_PROVIDER=mock` as a backup.

1. **The problem (1 min).** Every message and alert is read and sorted by hand; urgent items wait behind routine ones.
2. **Routine → AUTO.** Triage → `info` sample. Jev answers four typed questions in one call; point at the
   per-question confidence and the weakest one setting the gate. Template sent, nobody touched it.
3. **Money → REVIEW.** `double charge` sample. 90%+ confidence and it still waits for a person: `HR-2 Money`.
4. **Safety → HUMAN.** `locked-in-car` sample. Security paged, duty manager assigned: `HR-1 Safety`.
5. **Jev down.** `API failure + safety` chip. The model fails, our keyword rule still pages security.
   "A failure degrades to today's manual process, never to unsafe automation."
6. **Agent guard.** Agent action tab → `refund ₹200 · a04` ("refund all customers") → BLOCKED.
   Then `refund ₹1800 · a02` → REVIEW, over the ₹500 limit.
7. **People stay in control.** Queue → enter your name → approve the refund → Audit log shows who approved, then the refund.
8. **Rollout is a switch.** Settings → turn on remote barrier open → re-run the barrier sample → AUTO. Turn on
   shadow mode → everything is logged, nothing runs. Show a kill switch.
9. **How we'd know it's safe.** Evaluate → agreement by confidence band, 95% target, zero safety/money misses.
10. **Cost and ask (1 min).** Cost tile: fractions of a cent per decision. Ask for: 50–100 anonymised real cases
    per workflow, sign-off on the refund rule conflict, and a shadow-mode pilot.

## Deploy to Vercel (GitHub)

1. **Push to GitHub** (from this folder, in PowerShell):
   ```powershell
   git init
   git add .
   git commit -m "Parking decision layer pilot"
   git branch -M main
   git remote add origin https://github.com/<you>/parking-decision-layer.git   # create the empty repo first
   git push -u origin main
   ```
   `.env.local` is git-ignored, so your keys are not pushed.
2. **Import** at vercel.com/new → pick the repo → Framework: Next.js → **Deploy**.
3. **Add Redis:** project → **Storage** → **Upstash for Redis** (free plan) → connect to the project.
   This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Environment variables** (project → Settings → Environment Variables):
   `JEV_PROVIDER=vercel`, `AI_GATEWAY_API_KEY=…`, `DEMO_PASSWORD=…`
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables apply.
6. Open the URL, enter any username and the password. The status bar should read **Jev: vercel** and **Storage: redis**.
   Settings are stored in Redis, so set the thresholds once on the hosted site.

Every `git push` to `main` redeploys automatically.

## How the PRD maps to code

| PRD | Where |
|---|---|
| F-1 one call, typed answers | `src/lib/jev/` (`JevClient` interface; `mock.ts`, `http.ts`) |
| F-2 min-confidence gate, F-3 thresholds | `src/lib/core/gate.ts` |
| F-4 hard rules before the gate | `decide()` in `src/lib/workflows/*.ts` |
| F-5 append-only audit | `src/lib/core/store.ts` (`appendAudit`, frozen events) |
| F-6 config | `src/lib/core/config.ts`, `/api/config`, Settings page |
| F-7 errors/timeouts → HUMAN | `src/lib/core/engine.ts` (`fallback`, timeout race) |
| F-8 shadow mode | `config.shadowMode`; engine skips actions |
| S-1 … S-8 | `src/lib/workflows/support.ts` |
| D-9, D-10 | `src/lib/workflows/agentGuard.ts` |
| NFR privacy (redaction) | `src/lib/core/redact.ts` |
| NFR operability (dashboard) | `/api/metrics`, Triage metric tiles |
| §9 phase 1 offline evaluation | `src/lib/evaluate.ts`, Evaluate page |
| §12 acceptance criteria | `tests/acceptance.test.ts` (AC3 is the Alerts workflow, not in this scope) |

## Decisions I made where the PRD was open

- **D-10 vs hard rule #2.** D-10 lets agent refunds at or below ₹500 execute at high confidence; hard rule #2 and
  acceptance criterion #2 say no refund executes without approval. The D-10 behaviour is behind a setting that is
  **off by default**. The PRD owner should pick one.
- **Safety is caught two ways.** Jev's `is_safety_risk` counts if P ≥ 0.30 (not just ≥ 0.5), *and* a deterministic
  keyword rule runs in our code. The keyword rule still works when Jev is down.
- **Blocking is the safe direction.** The agent guard blocks whenever `violates_policy` leans yes or
  `matches_request` leans no, regardless of confidence.
- **`is_urgent` sets priority only.** The gate uses `category`, `is_safety_risk` and `wants_money_back`.
- **Rollout defaults.** Only fixed-template replies are AUTO-enabled (phase 4). Pass re-sync and remote barrier open
  are off (phase 5); confident items for those go to REVIEW.

## Not production-ready yet

- **Storage** is in-memory locally and Redis when hosted. Production needs a database with an append-only audit
  table (no update/delete grants) and the agreed retention.
- **Integrations are dummies** (`src/lib/integrations/`): they log what they would do. Wire up the helpdesk, payment
  gateway, gate controller, pager and pass service with least-privilege service accounts.
- **Auth is a shared demo password.** The approver name is free text. Production needs SSO, with the approver taken from the session.
- **Redaction misses names.** It needs an NER step, and TypeSafe's data terms need review (PRD §7).
- **The sample set is synthetic.** Phase 1 needs 50–100 anonymised real cases per workflow with known outcomes.
- **Out of scope here:** the Alerts, Bugs, CI and PR workflows (D-1 to D-8). The engine is shared, so each one is a
  new file in `src/lib/workflows/` with its questions and `decide()` rules.
