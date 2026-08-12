# Operator — Business Plan: $0 → $10K MRR in 30 Days

**Prepared:** 2026-08-12 · **Product:** Operator — the Approval Center · **Goal:** $10,000 in monthly recurring revenue within 30 days of launch.

*Companion docs: [Product](PRODUCT.md) · [Market Analysis](MARKET.md).*

---

## 1. Executive summary

**The target is small in customer terms and large in execution terms.** $10K MRR at a $500/month anchor price = **~20 paying customers**. The [Market Analysis](MARKET.md) shows the serviceable market is in the millions and the affordability case is settled — so **the entire game in 30 days is distribution and activation, not demand generation.**

This plan wins with a **founder‑led, concierge motion**: a sharp single‑wedge offer, a **design‑partner program** for the first cohort, direct outreach to a segment that already pays for the category (small agencies), and **build‑in‑public on X where Operator demonstrates itself by running the founder's own account**. It is aggressive but achievable **if** the founder has (or can borrow) an audience/network and treats the 30 days as a full‑time sales sprint.

**Headline math:** 20 customers in 30 days ≈ **fewer than 1 close per weekday.** With a 20–30% demo‑to‑close rate, that's ~3–4 qualified demos per weekday — a reachable outbound + inbound number for a motivated founder.

**Honest feasibility read:** This is a **stretch goal.** The realistic distribution is roughly:
- **Base case (most likely):** $4–7K MRR by Day 30 (8–14 customers), $10K by Day 45–60.
- **Target case:** $10K MRR by Day 30 (20 customers) — requires a warm audience or a strong agency‑outreach hit rate.
- **Stretch:** $12–15K if one agency buys multiple client workspaces.

The plan is built to hit the target while banking the base case. Every tactic below is chosen for **speed‑to‑cash**, not long‑term brand.

---

## 2. Assumptions

| # | Assumption | Why it matters |
|---|---|---|
| 1 | Product is deployed, stable, and onboarding works end‑to‑end before Day 1. | You cannot sell a broken first session. Week 0 is a hard gate. |
| 2 | Founder can commit ~full‑time to sales for 30 days. | 20 closes require sustained outbound + demos + onboarding. |
| 3 | Founder has *some* reachable audience/network (X following, past clients, communities) — even a few thousand. | Warm distribution is the difference between base and target. |
| 4 | Payments are live (Stripe) and a subscription can be charged. | You must be able to take money on Day 1. |
| 5 | Blended AI COGS stays < ~20% of revenue via metering + the model lever. | Protects gross margin at $500 and validates the price. |
| 6 | Concierge onboarding (founder does setup with each customer) is acceptable at this scale. | High‑touch onboarding is the activation lever early; automate later. |

If assumption #1 or #4 is not true, **the clock does not start** — fix them first.

---

## 3. Pricing & packaging

Anchor on $500, but widen the funnel with an on‑ramp and reserve an agency tier for ARPA (per the [Market Analysis](MARKET.md) recommendation).

| Tier | Price | Who | What |
|---|---|---|---|
| **Starter** | **$149/mo** | Solo founders testing the water | Social + Content agents, 1 workspace, core integrations |
| **Operator** *(anchor)* | **$500/mo** | The core ICP | Full AI ops team, 1 workspace, all integrations, human‑in‑the‑loop |
| **Agency** | **$999–1,500/mo** | Small agencies | Multiple client workspaces, more seats |

**Founder / launch offers (drive the 30‑day sprint):**
- **Founding‑customer pricing:** first 20 customers lock **$500 → $399/mo for 12 months** (or Starter $149 → $99). Scarcity + urgency.
- **Design‑partner deal (first 5–10):** discounted or 1 month free **in exchange for a testimonial + a case study + weekly feedback.** These become your social proof engine.
- **Annual option:** 2 months free — pulls cash forward and cuts churn.
- **14‑day guarantee:** "Approve real work in your first week or your money back." De‑risks the buy; you can offer it because activation is fast.

### The "20 = $10K" mixes (any of these hits target)

| Scenario | Starter $149 | Operator $500 | Agency $999 | Customers | MRR |
|---|---|---|---|---|---|
| **All‑anchor** | 0 | 20 | 0 | 20 | $10,000 |
| **Balanced (planned)** | 10 | 12 | 2 | 24 | ~$9,500 → nudge to $10K |
| **Agency‑led** | 4 | 8 | 5 | 17 | ~$9,590 |
| **Founding‑price** | 5 (@$99) | 18 (@$399) | 1 (@$999) | 24 | ~$8,670 → add 3 anchors |

**Planned mix for the sprint:** aim for **~12 Operator + ~2 Agency + ~10 Starter**. The Starter tier feeds upgrades in Month 2 and keeps top‑of‑funnel wide without discounting the anchor.

---

## 4. The offer & positioning

**Do not sell "an AI platform."** Sell one acute, demonstrable win and expand once they're in (see the [Market Analysis](MARKET.md) wedge section).

**Primary wedge — "Your content, on autopilot, in your voice, with your approval."**
- The pitch: *"Operator learns your voice from your own posts, drafts a week of on‑brand content from current topics, and lines it up for you to approve in one click. Then it also runs your inbox, your CRM follow‑ups, and writes your daily brief."*
- Why it works: fastest "wow," cheapest to demo, and Operator can **run the founder's own X account as the live proof.**

**Secondary wedge — "Never drop an email or a lead again"** for service businesses and funded startups (inbox triage + CRM Radar).

**The one‑line positioning:**
> *Operator is the AI operations team for owner‑operators — it drafts your posts, emails, and follow‑ups across every tool you use, and nothing goes out until you approve it.*

**Lead with control.** The Approval Center + kill switch + caps directly answer *"what if it does something dumb in my name?"* — make it a headline benefit.

---

## 5. Unit economics

At $500/mo, the economics are strong and the price is defensible:

| Metric | Estimate | Notes |
|---|---|---|
| Price (anchor) | $500/mo | $6,000 ARR/customer |
| **AI COGS** | **~$30–90/mo/customer** | Metered per workspace; the `ANTHROPIC_MODEL` lever + Haiku‑pinned heavy ops keep blended cost low. Target < 20% of price. |
| Infra (Supabase/Vercel share) | ~$5–15/mo/customer | Fixed base amortized across accounts |
| **Gross margin** | **~80–90%** | Typical for AI SaaS with cost discipline |
| CAC (founder‑led, sprint) | ~$0–100/customer | Sweat + small ad/tool spend; mostly time |
| Payback | **< 1 month** | High‑margin + near‑zero CAC = immediate contribution |

**Margin guardrail:** watch the per‑workspace usage report weekly. If any customer's AI COGS approaches ~25% of their price, flip that workspace (or all) to the cheaper model, or move heavy‑usage customers to the Agency tier. The metering infrastructure exists specifically so margin never surprises you.

**Cash at target:** 20 customers ≈ **$10K MRR / $120K ARR** at ~85% gross margin ≈ **~$8.5K/mo gross profit** — enough to fund a first hire in Month 2–3.

---

## 6. The funnel math

Working backwards from 20 closes in ~22 selling days:

| Stage | Conversion | Needed (target) |
|---|---|---|
| Closes | — | **20** |
| Qualified demos → close | 25% | **80 demos** (~3.6/weekday) |
| Booked calls → qualified demo | 70% | **~115 calls booked** |
| Outreach/leads → booked call | 8–12% | **~1,000–1,400 touches** |

**Translation:** ~50–70 quality outbound touches per weekday (DMs, emails, replies) + inbound from build‑in‑public → ~4 demos/day → ~1 close/day. This is a **grind, but a countable one.** Concentrate touches on the highest‑intent segment (agencies, active X founders) to lift the top conversion and cut the volume needed.

**Leverage that reduces the grind:**
- **Design partners (5–10)** close from warm network in Week 1 — front‑load ~half the goal.
- **One agency** buying 2–3 client workspaces = 2–3 "closes" from one conversation.
- **Build‑in‑public inbound** compounds through the month, shifting the mix from outbound to inbound by Week 3–4.

---

## 7. Go‑to‑market: the 30‑day playbook

### Channel priorities (speed‑to‑cash order)

1. **Warm network + design partners** — fastest closes; your first 5–10 customers and case studies.
2. **Direct outreach to small agencies** — highest ACV, already pay for the category, map 1:1 to the approval workflow.
3. **X build‑in‑public (dogfooded)** — Operator runs the founder's account; every post is a live demo. Compounds into inbound.
4. **Founder/creator/indie communities** — Slack/Discord/subreddits; warm DMs + demos.
5. **Content/SEO on the wedge** — "AI social manager with approval," "AI inbox triage for founders" (slower; seeds Month 2).

### Week 0 — Pre‑launch prep (the gate)

- [ ] Deploy is stable; onboarding, Stripe subscription, and a first approved action all work end‑to‑end.
- [ ] Landing page live with the wedge offer, pricing, a 60–90s demo video (screen‑record a real approve→publish), and a "Book a demo"/checkout button.
- [ ] Design‑partner one‑pager + a **list of 100 named targets** (agencies + active X founders you can reach) with a personalization note each.
- [ ] Outreach templates + a 10‑minute demo script ready (Appendix).
- [ ] Turn Operator **on for your own accounts** — it starts running your X + inbox so the account is a live billboard.
- [ ] Instrument: a simple pipeline tracker (touches → calls → demos → closes) and the usage/COGS report.

### Week 1 — Design partners + build‑in‑public launch (target: **6–8 customers**)

- **Mon–Tue:** DM/email your 20 warmest contacts with the design‑partner offer; book calls. Publish the "I built an AI ops team and it runs my own account — here's proof" launch thread.
- **Wed–Fri:** Run design‑partner onboarding calls (concierge setup live on the call → they see a real approved action before hanging up). Close 5–10 design partners. Post daily build‑in‑public updates (real approvals, real drafts).
- **Cadence:** 50+ outbound touches/day to the agency list; 3–5 demos/day.

### Week 2 — Agency outreach + first case studies (target: **+5–6, running ~12–14**)

- Turn design partners' early wins into **2–3 short case studies / testimonial clips** (use Case Studies A–D framing from [Product](PRODUCT.md)).
- Heavy **agency outbound**: lead with "run all your clients' content through one approval queue." Offer the Agency tier + a client‑workspace demo.
- Keep build‑in‑public daily; start a lightweight referral ask ("know a founder drowning in content?").

### Week 3 — Scale what's converting (target: **+5–6, running ~17–20**)

- Double down on the highest‑converting channel from Weeks 1–2 (likely agencies or X inbound).
- Publish the wedge content pieces for SEO/long‑tail; run a small newsletter/micro‑influencer placement in the solopreneur‑tools niche if budget allows.
- Convert Starter trials → Operator with a "you approved 40 things this week; unlock email + CRM" upgrade nudge.

### Week 4 — Close the gap + lock retention (target: **hit 20, secure the base**)

- **Close the gap:** revisit every warm‑but‑unclosed lead with a deadline‑bound founding‑price offer; ask design partners for one referral each.
- **Convert to annual** where possible (2 months free) to bank cash and cut churn.
- **Onboarding health check** with every customer — get each to a repeatable weekly habit (approve the queue) so Month‑2 churn is low.

---

## 8. Founder‑led sales motion

**Outbound is high‑personalization, low‑volume‑per‑target, high‑intent.**

- **Agencies:** find them on X/LinkedIn/agency directories; reference their actual client work. Angle: *throughput per head + one approval queue + reduces their tool stack.*
- **Active X founders:** reply meaningfully to their posts for a few days, then DM. Angle: *"I'll set it up to run your account in 15 minutes — watch it draft your next week in your voice."*
- **Demo = do it live.** In a 10‑minute call, connect their X + Gmail, paste their brief, and produce real approved drafts *on the call.* Seeing their own voice come out of it closes deals.

**Design‑partner program (the flywheel):** 5–10 partners get founding pricing/free month in exchange for a testimonial, a case study, and weekly feedback. Their wins become your Week‑2 proof and your Week‑3 inbound.

---

## 9. Onboarding & activation

**Activation is the make‑or‑break metric, not signups.** The one number that predicts revenue: **time‑to‑first‑approved‑action.**

- **Concierge onboarding** for every paying customer in the sprint: a 15–20 minute call where you (the founder) connect their tools, fill the brief with them, and get them to approve a real piece of work.
- **First‑week success plan:** by Day 7 they should have (1) connected Gmail + X, (2) a filled brief, (3) run a Deep Dive, (4) approved at least 5 real actions, (5) established the daily‑brief + approve‑the‑queue habit.
- **Guarantee backs it:** "Approve real work in week one or your money back" — you can offer this precisely because activation is fast and concierge‑assisted.

---

## 10. Retention & expansion

- **Habit = retention.** The daily brief + a short approval queue create a daily open. Nudges pull them back (stale approvals, a sale, a goal behind pace).
- **Expansion levers:** Starter → Operator (unlock email + CRM); Operator → Agency (add client workspaces); annual conversion.
- **Churn guards:** weekly usage/health review; proactively reach anyone who hasn't approved anything in 5+ days (the product even surfaces this signal internally).
- **Target:** logo churn < 5%/mo in the first 90 days; net revenue retention > 100% via upgrades.

---

## 11. KPIs & weekly targets

| Metric | Wk 1 | Wk 2 | Wk 3 | Wk 4 |
|---|---|---|---|---|
| New customers | 6–8 | +5–6 | +5–6 | +to‑20 |
| Cumulative MRR | ~$2.5K | ~$5K | ~$7.5K | **$10K** |
| Demos held | 15+ | 18+ | 18+ | 15+ |
| Outbound touches | 250+ | 250+ | 200+ | 150+ |
| Activation (first approved action) | 100% of paid | 100% | 100% | 100% |
| Blended AI COGS | < 20% | < 20% | < 20% | < 20% |

**Daily dashboard:** touches → calls booked → demos held → closes → MRR; plus this‑week churn and the per‑workspace COGS report.

---

## 12. Risks & contingencies

| Risk | Signal (by Day 15) | Contingency |
|---|---|---|
| **Behind pace** (< $4K MRR by Day 15) | Cumulative closes < 8 | Lean harder on agencies (multi‑workspace = multi‑close); deepen the founding‑price urgency; add a limited "done‑for‑you first month" upsell. |
| **Great demos, low closes** | Demo→close < 15% | Tighten the offer/guarantee; shorten time‑to‑value on the call; add social proof (design‑partner clips) earlier. |
| **Activation stalls** | Paid users not approving anything | Mandatory concierge onboarding; simplify to the single wedge; personally babysit week‑1 usage. |
| **AI COGS creep** | Any workspace COGS > 25% | Flip `ANTHROPIC_MODEL` to the cheaper tier; move heavy users to Agency pricing. |
| **Trust incident** (an autopilot mistake) | A customer complaint | Lean into the approval‑first story; default new customers to Approval, not Auto; publish the guardrails. |
| **Support overwhelm** | Founder underwater | Cap the sprint cohort (e.g. 25 customers), waitlist the rest, hire help from Month‑2 gross profit. |

**Fallback framing:** if Day 30 lands at $5–7K MRR, that is a **successful launch** — a validated $500 price, real logos, case studies, and a repeatable motion. $10K then follows in the next 2–4 weeks. Do not sacrifice retention/margin to force a vanity number by Day 30.

---

## 13. Beyond the sprint (Days 31–90)

- **Productize onboarding** (self‑serve + templates) to lift capacity beyond founder concierge.
- **Turn the strongest wedge into a content/SEO engine** for compounding inbound.
- **Build the agency motion** (multi‑workspace, seats, white‑label consideration) — the highest‑ARPA path to the *next* $10K.
- **Ship coming‑soon connectors** (Slack, LinkedIn, Webflow) to close feature objections.
- **Target:** $25–40K MRR by Day 90 on the back of the case studies, referrals, and inbound seeded in the first 30 days.

---

## 14. Appendix

### A. Cold outreach template (agency)

> **Subject: one approval queue for all your clients' content**
>
> Hi {name} — saw {specific client/work}. Quick one: I built **Operator**, an AI ops team that drafts your clients' posts + emails in *their* voice and lines everything up in one approval queue — nothing publishes until you click approve. Agencies are using it to run more clients per manager and cut their tool stack.
>
> Want a 10‑minute demo where I set it up on one of your clients live? You'll see a week of on‑brand drafts by the end of the call.

### B. Cold DM template (founder on X)

> {name}, your posts on {topic} are great. I built a tool that learns your voice and drafts your next week from current topics — you approve in one click, and it also runs your inbox + follow‑ups. Want me to set it up on your account in 15 min and show you? It's running my own account right now.

### C. 10‑minute live demo script

1. **(1 min)** Their pain in one sentence, mirrored back.
2. **(3 min)** Connect their X + Gmail; paste a 3‑line brief.
3. **(3 min)** Hit Run → show real, on‑voice drafts appear in the **Approval Center**; edit one, approve one → it posts/sends for real.
4. **(2 min)** Show the **Daily Brief** + **guardrails** ("nothing goes out without you; kill switch; caps").
5. **(1 min)** Founding‑price offer + guarantee → ask for the card.

### D. Definition of done for the sprint

- **Primary:** $10,000 MRR by Day 30.
- **Banked success:** ≥ $5K MRR, ≥ 3 published case studies, a repeatable demo→close motion, < 5% week‑1 churn, blended COGS < 20%.

---

*This plan is a roadmap, not a guarantee. The 30‑day target is aggressive and depends most on the founder's reachable audience and outbound intensity. The unit economics, market size, and price are sound; execution speed on distribution and activation determines whether $10K lands at Day 30 or Day 60.*
