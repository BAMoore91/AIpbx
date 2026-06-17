# Handoff → Claude for Chrome: Full Function & Form Test (Acme build)

**Audience:** Claude for Chrome (browser agent), driving the live AIpbx console.
**Goal:** Exercise **every page, form, and flow** by building a realistic test
company called **Acme**, then record **anything that doesn't work** in a
structured defect log to hand back to the engineering (Claude Code) session.

You are testing a real, deployed PBX admin console. Work methodically, top to
bottom. After each test case, mark it ✅ pass / ❌ fail. For every ❌, append an
entry to the **Defect Log** (format in §6). Do not stop on the first failure —
note it and keep going so we get full coverage in one pass.

---

## 1. Environment & access

| Item | Value |
|---|---|
| Console URL | `https://<CONSOLE_HOST>/`  (e.g. `https://68.183.23.118/`) |
| Login (platform superadmin) | `admin@pbx.example.com` / `<the BOOTSTRAP_ADMIN_PASSWORD>` |
| TLS | Self-signed if accessed by IP → browser shows "Not secure". Click **Advanced → Proceed** once. |
| Browser console | Keep **DevTools → Console** open the whole time. Any red error = a defect, even if the page "looks" fine. Capture the text. |

**First action:** load the URL, accept the cert warning, and sign in. If the
dashboard does not render (blank page, spinner forever, or a "Something went
wrong" card), that is a **Blocker** — log it with the Console output and stop to
report, because nothing else can be tested.

> Note on calls vs config: most of this test is **configuration / CRUD / UI**
> validation, which is fully browser-testable. **Live audio call flows** (does
> digit 6 actually ring all 5 phones?) require registered SIP endpoints and real
> media, which can't be fully verified by clicking forms. Test the *softphone
> registration* (§4.16) and, if it registers, attempt one internal call; mark
> the deeper call-routing behavior as **"config verified, live call not
> verified"** unless audio actually works.

---

## 2. How to record results

For **each** test case below:
1. Do the steps.
2. Compare to **Expected**.
3. Mark ✅ or ❌.
4. If ❌ (or any red Console error, HTTP 4xx/5xx in the Network tab, or a field
   that won't save): add a **Defect Log** entry (§6).

Severity guide:
- **Blocker** – can't proceed / page crashes / login broken / data won't save at all.
- **Major** – a documented feature is broken or a form rejects valid input.
- **Minor** – wrong label, validation gap, confusing UX, cosmetic-but-misleading.
- **Cosmetic** – purely visual.

---

## 3. PART A — Build the "Acme" company (the core scenario)

Do these **in order** (later steps reference earlier objects).

### 3.1 Create the tenant "Acme"
1. Sidebar → **Tenants** (visible only to the superadmin). If "Tenants" is
   missing from the sidebar, log Blocker.
2. Click **New Tenant**. Fill:
   - **Name:** `Acme`
   - **Slug:** `acme`
   - **SIP Domain:** leave blank (or `acme.<CONSOLE_HOST>`)
   - **Plan:** `Enterprise` (so limits don't block 5+ objects)
   - **Max extensions:** `50`
   - **Max concurrent calls:** `30`
   - **Admin email:** `admin@acme.test`
   - **Admin password:** `Acme-Admin-2026!`
3. Click **Create tenant**.
- **Expected:** modal closes, Acme appears in the list with plan **Enterprise**,
  usage `Ext 0/50`, status **Active**.
- ❌ if: create errors, 4xx/5xx in Network tab, or the admin sub-fields reject valid input.

### 3.2 Switch into the Acme tenant
1. Top-right **Tenant Switcher** (Building icon) → select **Acme (acme)**.
- **Expected:** the switcher now shows "Acme"; subsequent lists (Extensions,
  etc.) are empty and scoped to Acme. (You're now impersonating Acme as superadmin.)
- ❌ if: switching does nothing, or data from another tenant still shows.

### 3.3 Create 5 extensions
Sidebar → **Extensions** → **New Extension**, five times, with:

| Extension Number | Display Name | SIP Username | SIP Password | Type | Voicemail Enabled |
|---|---|---|---|---|---|
| 1001 | Alice Adams | 1001 | `Acme-1001!` | WebRTC (Browser) | ON |
| 1002 | Bob Brown  | 1002 | `Acme-1002!` | WebRTC (Browser) | ON |
| 1003 | Carol Cruz | 1003 | `Acme-1003!` | WebRTC (Browser) | ON |
| 1004 | Dan Diaz   | 1004 | `Acme-1004!` | WebRTC (Browser) | ON |
| 1005 | Eve Estes  | 1005 | `Acme-1005!` | WebRTC (Browser) | ON |

Leave Call Recording = **On Demand**, Ring Timeout = **30**, DND = OFF.
- **Expected:** each saves; list shows 5 rows; **Voicemail = On** for all; Type = WebRTC.
- ❌ if: any save fails, SIP password is rejected at ≥6 chars, or a saved row
  shows the wrong Type/Voicemail value.

### 3.4 Create the Sales **Queue** (rings all 5)
Sidebar → **Queues** → **New Queue**:
- **Extension Number:** `7000`
- **Queue Name:** `Sales Queue`
- **Ring Strategy:** `Ring All`
- **Max Wait (sec):** `120`
- **Max Callers:** `20`
- **Wrap-up Time (sec):** `30`
- **Service Level Target (sec):** `60`
- **Announce Position:** ON
- Save.

Then add members:
1. On the Sales Queue row → **Members** (or the members action).
2. Add extensions **1001, 1002, 1003, 1004, 1005** one at a time via the
   "Select extension to add…" dropdown.
- **Expected:** queue saves with strategy **Ring All**; members list shows all 5
  extensions.
- ❌ if: "Ring All" is rejected on save (see §5 suspect #3), the members dropdown
  is empty, or members don't persist after reopening.

### 3.5 Create the **Day IVR**
Sidebar → **IVR Menus** → **New Menu**:
- **Extension Number:** `8001`
- **Menu Name:** `Acme Day Menu`
- **Greeting Type:** `Text-to-Speech`
- **Timeout (sec):** `10`, **Max Retries:** `3`
- **Greeting Text:** `Thank you for calling Acme. Press 1 for Alice, 2 for Bob, 3 for Carol, 4 for Dan, 5 for Eve, or 6 for Sales.`
- **Key Mappings** → **Add Key** six times:

| Key | Destination Type | Destination ID | Label |
|---|---|---|---|
| 1 | Extension | `1001` | Alice |
| 2 | Extension | `1002` | Bob |
| 3 | Extension | `1003` | Carol |
| 4 | Extension | `1004` | Dan |
| 5 | Extension | `1005` | Eve |
| 6 | Queue | `7000` | Sales |

- Click **Save Menu**.
- **Expected:** menu saves; list shows 6 key rows. Reopen the menu and confirm
  all 6 mappings persisted exactly.
- ❌ if: a key row won't add, the destination type list is missing options, or
  mappings don't persist on reopen.
- **⚠️ Verify (suspect #1):** check the **Network** tab on Save — note the exact
  JSON sent for `options` (is the queue type sent as `"queue"`? is extension
  `"extension"`?). Record the payload in your notes; we need to confirm the UI's
  destination-type strings match what the backend router expects.

### 3.6 Create the **Night IVR** (digits → voicemail)
Sidebar → **IVR Menus** → **New Menu**:
- **Extension Number:** `8002`
- **Menu Name:** `Acme Night Menu`
- **Greeting Type:** `Text-to-Speech`
- **Greeting Text:** `Acme is closed. Press 1–5 to leave a voicemail for the person you're trying to reach.`
- **Key Mappings** (Add Key ×5):

| Key | Destination Type | Destination ID | Label |
|---|---|---|---|
| 1 | Voicemail | `1001` | VM Alice |
| 2 | Voicemail | `1002` | VM Bob |
| 3 | Voicemail | `1003` | VM Carol |
| 4 | Voicemail | `1004` | VM Dan |
| 5 | Voicemail | `1005` | VM Eve |

- **Save Menu.**
- **Expected:** saves; 5 voicemail mappings persist on reopen.
- ❌ if **Voicemail** is not an available Destination Type, or the rows don't persist.

### 3.7 Create the **Time Condition** (day ↔ night switch)
Sidebar → **Time Conditions** → **New Condition**:
- **Condition Name:** `Acme Business Hours`
- **Timezone:** `America/New_York`
- **When condition MATCHES** → Route To: `IVR Menu`, Destination ID: `8001` (Day)
- **When condition DOES NOT MATCH** → Route To: `IVR Menu`, Destination ID: `8002` (Night)
- **Save.**
- **Expected:** saves; list shows Match→IVR / No-Match→IVR.
- **⚠️ Known limitation to confirm (suspect #4):** the form shows an info box
  saying the actual day/night **time rules (Mon–Fri 09:00–17:00)** can only be
  set "via the API or a future UI update." Confirm there is **no way to enter the
  schedule in the browser** and log it as a **Major UX gap** ("time condition is
  not usable from the UI alone — the schedule can't be configured"). The
  match/no-match destinations are all you can set here.

### 3.8 Point an inbound number at the Time Condition
Sidebar → **Routing** → **DID Numbers** tab → **Add DID**:
- **E.164 Number:** `+15551230000`
- **Label:** `Acme Main Line`
- **Route To:** `Time Condition`
- **Destination ID:** the Time Condition's id (see note)
- Save.
- **Expected:** DID saves and shows "Routes To: Time Condition".
- **⚠️ Verify (suspect #2 & #5):**
  - Is **"Time Condition"** even offered in the DID *Route To* list? (The IVR/TC
    forms offer it, but confirm DID does too.) If it errors on save, log Major.
  - The **Destination ID** is free text with **no picker**. A Time Condition has
    no dialable number — you'd need its **UUID**. Note whether the UI gives you
    any way to obtain/select it. If you can't address the TC without hand-copying
    a UUID, log it as a **Major UX gap** ("routing targets that have no number
    require a UUID with no picker"). Try the TC's name first; if rejected, this
    is the defect.

> **Acme build done.** You should now have: 1 tenant, 5 extensions, 1 queue
> (5 members), 2 IVRs, 1 time condition, 1 DID. Record the final object counts.

---

## 4. PART B — Exhaustive page & form sweep

Still inside the **Acme** tenant unless noted. For each, open the page, then
create/edit/delete where a form exists. Log anything broken.

### 4.1 Dashboard (`/dashboard`)
- **Expected:** KPI cards render (Active Calls, Calls Today, Answered, Missed,
  Avg Handle Time, Queue SLA, Sentiment, Active Agents) with `0`/empty values,
  no broken charts, no Console errors.

### 4.2 Live Wallboard (`/wallboard`)
- **Expected:** loads without error (empty live data is fine).

### 4.3 Users (`/users`)
- **New User:** First `Test`, Last `User`, Email `t.user@acme.test`, Password
  `Acme-User-2026!`, Role `Agent` → **Create User**.
- Edit it: change Role to `Supervisor` → **Save Changes** (leave password blank).
- Delete it.
- **Expected:** create/edit/delete all succeed; list reflects each change; the
  "New Password (leave blank to keep)" path works on edit.

### 4.4 Extensions (`/extensions`)
- **Edit** ext 1005: toggle **Do Not Disturb** ON, **Save Changes**; reopen and
  confirm it stuck. Toggle it back OFF.
- Test validation: try a **SIP Password** of `123` (too short) → expect inline
  error, not a silent save.
- Test the other **Type** values (`SIP Phone`, `Virtual`) on a throwaway ext
  `1099` → **⚠️ suspect #6**: confirm the API accepts them (Network tab). Delete `1099`.

### 4.5 Trunks (`/trunks`)
- **New Trunk:** Name `Test Carrier`, Provider `Generic`, Host `sip.example.com`,
  Port `5060`, Transport `UDP`, Auth `Username/Password`, Username `acme`, Secret
  `trunksecret`, Max Channels `30`, Register ON, Active ON → **Save**.
- Edit (change Max Channels to 10), then Delete.
- Also click **Connect Twilio** to confirm the modal opens (do **not** submit
  real Twilio creds; just verify the form renders, then cancel).
- **Expected:** CRUD works; Twilio modal opens.

### 4.6 Routing → Outbound Routes
- **Add Route:** Name `LD`, Dial Pattern `_1NXXNXXXXXX`, Trunk = `Test Carrier`
  (recreate it if you deleted it), Prepend blank, Strip 0, Priority 0 → **Save**.
- Edit, then Delete.

### 4.7 Routing → Ring Groups
- **Add Ring Group:** Number `6000`, Name `All Staff`, Strategy `Ring All`,
  Ring Timeout 30 → **Save**.
- **⚠️ suspect #3:** also try Strategy `Round Robin` and `Random` on a throwaway
  group `6001` and confirm they save (Network tab); delete `6001`.

### 4.8 IVR Menus — already built two. Now **Edit** the Day Menu: change key 6's
  Label to `Sales Team`, Save, reopen, confirm. Then test **deleting** a key row.

### 4.9 Time Conditions — already built one. Edit it (change Timezone to
  `America/Chicago`), Save, confirm.

### 4.10 AI Agents (`/ai-agents`)
- **New Agent** → walk **all four tabs** (Core, Voice & STT, Tools, Advanced):
  - Core: Name `Acme Receptionist`, Ext/DID `9001`, Role text, Model
    `Claude Opus 4`, fill System Prompt + Greeting, KB = none.
  - Voice & STT: leave defaults.
  - Tools: toggle a couple on/off.
  - Advanced: Active ON.
  - **Create Agent.**
- Click **Test** on the new agent → send a chat message in the test panel.
  - **Expected:** the agent replies. ❌ if it errors (likely missing
    `ANTHROPIC_API_KEY` on the server → log as Major with the error text; this is
    useful info for Code).
- Edit the agent, then Delete it.

### 4.11 Knowledge Bases (`/knowledge-bases`)
- **New Knowledge Base:** Name `Acme FAQ`, description text → **Save**.
- **Manage Docs** → upload a small `.txt` file.
  - **Expected:** it appears with a status (pending/processing/ready). Note the
    final status; if it sticks on `error`/`processing` forever, log it.
- Delete the doc, then delete the KB.

### 4.12 Call History (`/cdr`)
- Open **Filters**: set Direction = Inbound, a date range → **Apply**.
- Click **Export CSV** → confirm a file downloads.
- **Expected:** filters apply without error (list may be empty). If a row exists,
  click it and confirm the detail view + transcript timeline render.

### 4.13 Recordings (`/recordings`)
- **Expected:** loads; search box works (empty results OK).

### 4.14 Voicemail (`/voicemail`)
- **Expected:** loads; "X unread · Y total" header renders (0 OK).

### 4.15 Messages (`/messages`)
- **Expected:** loads; search works (empty OK).

### 4.16 Softphone widget (bottom-right) — **registration test**
- Open the softphone. It tries to register the WebRTC extension belonging to the
  logged-in user. (The Acme admin has no extension, so it may show "unregistered"
  — that's expected. To truly test: assign ext 1001's `user_id` to a user you can
  log in as, or log in as a user who owns a WebRTC extension.)
- **Expected (best effort):** registration dot turns **green**. If it stays red,
  capture the Console/Network — WebRTC needs valid **wss://…:8089** TLS, which
  won't work on a self-signed IP cert. Log as "softphone registration fails on
  IP/self-signed cert" (this is expected without a real domain + Let's Encrypt;
  note it so Code knows the live-call test is blocked on TLS/domain).

### 4.17 Reports (`/reports`)
- Click each Report Type (Call Summary, Agent Performance, Queue Statistics,
  AI Agent Usage) and each Period (7/30/90 Days). Click **Export PDF**.
- **Expected:** each renders charts/cards without error; PDF exports.

### 4.18 Settings (`/settings`) — all four tabs
- **Profile:** change First/Last name → **Save Profile**; confirm Topbar initials
  update. (Email field should be disabled.)
- **Tenant:** confirm the info renders.
- **Webhooks:** **Add Webhook** → URL `https://example.com/hook`, pick a couple
  events, Save. Edit, then Delete.
- **Security:**
  - **Set up MFA** → confirm a secret + QR/otpauth shows. (You can stop before
    confirming a code unless you have an authenticator — if so, complete enable
    then **Disable MFA**.)
  - **Change Password:** use the current admin password + a new one →
    **Update Password**. (If you change it, **record the new password** so you
    aren't locked out, or change it back.)

### 4.19 Departments (`/departments`)
- **New Department:** Name `Sales`, description, Manager = none → **Create Department**.
- **Members** → add a user with role `Manager`; change the role; remove them.
- Edit the department, then Delete it.

### 4.20 Roles (`/roles`)
- In **System Roles**, toggle a permission for `supervisor` → **Save** for that
  role; **Reset** it. Confirm locked roles (admin) show "Full / locked".
- Repeat one toggle in **Department Roles**.

### 4.21 Tenant Switcher / superadmin
- Switch back to **My tenant (home)**. Confirm Acme data disappears and the
  platform view returns.
- Go to **Tenants**, **Edit** Acme (change Data Retention to `30`), Save.
- **Suspend** Acme, confirm status flips to Suspended, then **Activate** it.

---

## 5. PART C — Known suspects (give these extra attention)

These were flagged from the source code as likely mismatches between what the
**UI offers** and what the **API/router accepts**. Confirm each and log the result
(✅ works / ❌ broken) — these are high-value findings for Code:

1. **IVR/destination type strings.** UI destination dropdowns offer
   *IVR Menu / Time Condition / External* in some places, but the backend
   destination enum is `extension | ivr | queue | ring_group | ai_agent |
   voicemail`. Watch the **Network payload** when saving IVR keys, DID routes,
   and time-condition destinations. If the UI sends `ivr_menu` (not `ivr`),
   `time_condition`, or `external`, routing will silently break. **Report the
   exact strings sent.**
2. **DID → Time Condition / External.** Confirm whether the DID *Route To* list
   actually accepts `Time Condition` and `External` without a 4xx on save.
3. **Queue/Ring-Group strategies.** UI offers *Round Robin* and *Random*, but the
   API enum is `ringall | leastrecent | fewestcalls | rrmemory | linear`.
   Saving "Round Robin"/"Random" may 400. Confirm. (`Ring All` should be fine.)
4. **Time Condition schedule.** No UI to enter the Mon–Fri/start/end **rules** —
   confirm this gap (the feature is half-usable from the browser).
5. **Destination ID has no picker.** Routing targets without a dialable number
   (e.g. a Time Condition) require pasting a **UUID**. Confirm there's no
   in-UI way to find/select it.
6. **Extension Type values.** UI offers *SIP Phone* / *Virtual*; API enum is
   `softphone | webrtc | desk | ai_agent`. Confirm saving a non-WebRTC type
   doesn't 400.
7. **IVR retries / single digit.** Backend collects a **single** DTMF digit and
   does **not** loop on invalid input despite a "Max Retries" field. (Behavioral;
   only verifiable with a live call — note as "not browser-verifiable.")
8. **AI Agent test chat.** If the server has no `ANTHROPIC_API_KEY`, the **Test**
   chat will error — capture the message.

---

## 6. Defect Log format (hand this back to Code)

Append one block per failure. Keep it copy-pasteable.

```
### DEFECT <n> — <short title>
- Page/Route: <e.g. /ivr — New Menu modal>
- Severity: Blocker | Major | Minor | Cosmetic
- Steps: <numbered, minimal repro>
- Expected: <what should happen>
- Actual: <what happened>
- Console error: <paste red text, or "none">
- Network: <method + path + status, e.g. POST /api/ivr_menus → 400; response body>
- Suspect ref: <§5 #n, if applicable>
- Screenshot: <attach/note>
```

---

## 7. Final summary to return

End your run with:

1. **Coverage table** — every section in §3 and §4 with ✅/❌.
2. **Acme object counts** actually created (tenant / extensions / queue+members /
   IVRs / time condition / DID).
3. **Defect Log** (all entries from §6).
4. **§5 suspects verdict** — one line each (confirmed broken / works fine + the
   exact strings/statuses you observed).
5. **Top 3 things to fix first**, in your judgment.

Be precise and factual — paste real error text and HTTP statuses rather than
paraphrasing. This report goes straight back into the Claude Code session to
drive fixes.
