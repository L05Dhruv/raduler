# Security

This is a prototype for staff scheduling. It holds names, roles, shifts, hours, pay
rates and invoices. **It holds no patient information, and must not be given any.**

The deployment target — GitHub Pages — cannot run server code. Everything below follows
from that: there is no trusted middle tier, so the database has to be the one that says
no.

## What is in place

### Authorisation lives in Postgres

Row-Level Security is enabled on every table, with the permissive defaults revoked
first and privileges granted back one at a time (`supabase/migrations/0001_init.sql`).
A signed-in user's JWT decides what they can see:

| Table | Regular user | Administrator |
| --- | --- | --- |
| `profiles` | own row | all rows |
| `shifts` | read all | full control |
| `shift_assignments` | read own, set own hours | read all, set anyone's hours |
| `time_off` | full control of own, while still pending | read all, approve or deny |
| `invoices` | read own | full control |
| `audit_log` | nothing | read |

`private.is_admin()` is a SECURITY DEFINER function in a schema PostgREST does not
expose. A policy on `profiles` that queried `profiles` would recurse forever; running
the check outside RLS breaks the cycle.

### Nobody can grant themselves anything

- A user holds `UPDATE` on exactly two columns of their own profile — `full_name` and
  `modality`. Role and hourly rate are not in the grant, so raising your own pay is
  rejected by the column privilege before RLS is even consulted. Admin changes go
  through `admin_update_profile()`.
- `time_off` insert and update policies both require `status = 'requested'`, so a user
  cannot approve their own leave. Decisions go through `decide_time_off()`.
- `shift_assignments` has no `INSERT` or `UPDATE` grant for anyone. The only ways a row
  appears or changes are `claim_shift()`, `release_shift()` and `set_shift_hours()`.
- Hours are bounded by the published shift. A radiologist may work 1–5 of a 12–7
  posting, but not 11–8: `set_shift_hours()` refuses anything outside the window for
  anyone but an administrator. See below for why that bound is the whole control.

### Claiming a shift is atomic and checked server-side

`claim_shift()` takes a row lock, then refuses the claim if the shift is not open, if
the caller's role does not match, if the dates fall inside their approved time off, or
if they already hold an overlapping shift. A partial unique index on confirmed
assignments makes double-booking impossible even under a race.

### Choosing your own hours is not choosing your own pay

Radiologists set the hours they actually work on a shift they hold — the 12–7 posting
worked 1–5 on a lighter day. `shift_assignments.actual_start / actual_end` carry the
choice, and because every hours and money expression reads
`coalesce(actual, scheduled)`, reports and invoices follow with no separate code path.

That means these two columns *are* the pay input, so `set_shift_hours()`
(`supabase/migrations/0005_flexible_hours.sql`) guards them in that order of severity:

1. **Only your own shift**, unless you are an administrator.
2. **Only inside the published window.** Without this, anyone holding a shift could bill
   any hours they liked. Administrators are exempt, because recording a genuine overrun
   is their job and the audit log names them for it.
3. **Never once invoiced.** `create_invoice()` snapshots minutes and amounts into
   `invoice_lines`; letting the source hours move afterwards is precisely how a report
   and an invoice for the same period come to disagree. The shift is frozen and the
   refusal names the invoice.
4. **Never overlapping another shift the same person holds**, compared on effective
   rather than scheduled times, so no hour is billed twice. Unreachable for a regular
   user — narrowing inside a window `claim_shift()` already proved conflict-free cannot
   create a conflict — but reachable through the administrator exemption in 2.

Every change writes an `assignment.hours` audit row with the old and new window and
whether an administrator made it on someone else's behalf.

The shared body lives in `private.apply_shift_hours()`, which returns a refusal reason
instead of raising so that one frozen day does not roll back a whole month's bulk edit.
It authenticates and checks ownership itself rather than trusting its callers, and
`EXECUTE` is revoked from `authenticated` as well as `anon` — `authenticated` holds
`USAGE` on schema `private`, so the revoke is what keeps it unreachable.

**What this does not solve:** narrowing your hours leaves the rest of the shift
unstaffed while it still reads `filled`. That is a scheduling problem rather than a
security one, and the admin roster counts and labels the affected shifts rather than
reopening them automatically — reassigning half a shift is a decision for a person.

### Money is never client-supplied

`hours_summary()` and `create_invoice()` compute hours and amounts in SQL from the same
expression. The invoice page picks a person and a period; the database decides what
that is worth. The PDF is rendered in the browser from the stored line items.

### Audit trail

`audit_log` is append-only: no role holds `UPDATE` or `DELETE` on it, and only SECURITY
DEFINER code inserts. Triggers record every change to profiles, shifts, time off, teams
and invoices, along with the acting user. A user who deletes their own time-off request
cannot erase the record of it.

### Session handling

- Passwordless magic links (PKCE). No password to reuse, phish or leak. The code
  verifier stays in the requesting browser, so an intercepted link is not redeemable
  elsewhere.
- **Fifteen-minute idle sign-out** with a warning at sixty seconds. Reading rooms are
  shared workstations; this is the control that matters most in the physical
  environment.
- Short-lived access tokens with rotating refresh, and a sign-out that clears local
  storage.

### Signup is not open

A trigger on `auth.users` rejects addresses outside the practice's domains:

```sql
alter database postgres set app.allowed_email_domains = 'yourpractice.com';
```

Left unset, anyone may register — acceptable while demoing, not otherwise.

### Application hardening

- Content-Security-Policy, `default-src 'self'`, with `connect-src` narrowed to the
  Supabase origin (`src/lib/security/csp.ts`). Emitted in **production builds only**:
  React's development build calls `eval()`, and with the policy applied the dev server
  fails to hydrate, leaving a dead page whose only symptom is one console line. A meta
  CSP on localhost protects nothing, and the shipped policy is unchanged — verify it on
  the built output, not under `pnpm dev`.
- zod validation on every form, backed by SQL `CHECK` constraints so the rules hold
  regardless of what the client sends.
- CSV export neutralises leading `=`, `+`, `-` and `@`, so a name typed into the app
  cannot execute as a formula when the export is opened in a spreadsheet.
- Free-text fields are short and labelled "never patient or clinical details".
- Dependabot on npm and Actions; every CI action pinned to a commit SHA; `pnpm audit`
  on each build.

## Known limitations

Stated plainly, because a prototype that overstates its protections is worse than one
that admits them.

| Limitation | Why | Consequence |
| --- | --- | --- |
| **CSP is a `<meta>` tag** | A static host cannot set response headers | No `frame-ancestors` — clickjacking is not blocked. Real headers need a host that serves them. |
| **`script-src` allows `'unsafe-inline'`** | Next's static export inlines hydration scripts and there is no server to mint a nonce | Weakens the main XSS defence |
| **Route guards are cosmetic** | No server to gate a static bundle | Anyone can load `/admin/*`; they get permission errors and empty results, but the pages render |
| **No MFA** | Not enabled in this prototype | A compromised mailbox is a compromised account |
| **No BAA** | Supabase's free tier does not include one | Patient information here would be a compliance breach |
| **Anon key is public** | It ships in the bundle | Correct by design, but it means RLS is doing *all* the work — a policy mistake is an immediate data exposure |

## Before this carries real data

In rough order of value:

1. **Require MFA for administrators**, enforced in the database rather than the UI —
   add `auth.jwt() ->> 'aal' = 'aal2'` to the admin policies, so a session without a
   second factor simply cannot read the admin tables.
2. **Move to Entra ID or Google Workspace SSO with SCIM.** At practice scale the
   biggest risk is not a broken policy, it is an account that outlives someone's
   employment. Directory-driven deprovisioning fixes that; `signInWithOtp` is one call
   to swap for `signInWithSSO`, and none of the authorisation logic changes.
3. ~~Review every policy against the negative tests below, and add a regression test per
   policy.~~ **Done** — `tests/migrations.test.ts`. It applies the schema to real
   Postgres and then drops the session to `authenticated` or `anon` with `SET ROLE`, so
   the policies apply as they do for a signed-in user rather than being bypassed by a
   superuser. Every check in the console list below runs in CI, alongside the grant
   baseline, the column privileges, the audit log's immutability and each RPC's
   refusals. What it cannot reach is PostgREST and real JWTs, so keep the manual pass
   for the round trip.
4. **Set the signup domain allowlist.**
5. **Host somewhere that can serve security headers** — the CSP caveats above go away.

## Before this touches patient information

GitHub Pages and Supabase's free tier are both unsuitable, and no amount of application
work changes that:

- A **BAA** with every processor (Supabase Team plan or self-hosted; not GitHub Pages).
- A private origin serving real security headers, not a public static host.
- Encryption of identifying columns beyond the platform's at-rest default.
- Audit log shipped off-platform, with a defined retention period.
- A documented backup and restore drill.
- Access reviews, an incident response plan, and staff training.

Nothing in the current data model needs patient data. Keep it that way for as long as
possible — the compliance burden is paid on the *first* identifying field, not the tenth.

### Maintaining the baseline

Supabase's default privileges grant `anon` and `authenticated` access to newly created
objects in `public`. `0001` revokes those grants, but only for the objects that existed
when it ran. **Anything added later — a table via the dashboard editor, a new RPC —
starts open and must be revoked explicitly.** Two defects of exactly this shape were
found by probing the live project and fixed in
`supabase/migrations/0002_fix_function_privileges.sql`:

- Every RPC kept PostgreSQL's default `EXECUTE` grant to `PUBLIC`, because the blanket
  revoke ran earlier in the file than the functions it was meant to cover. Nothing was
  exploitable — each function re-checks the caller — but anonymous requests reached the
  inside of admin functions before being refused.
- `authenticated` held neither `USAGE` on schema `private` nor `EXECUTE` on
  `private.is_admin()`. Policy expressions run with the querying user's privileges, so
  every admin policy would have failed outright for signed-in users.

When adding a table: `revoke all on public.<table> from anon, authenticated;` then grant
back only what is needed, and enable RLS before inserting a row.

## Verifying the boundary

**Every check in this section is also asserted automatically** by
`tests/migrations.test.ts`, against the same schema on a real Postgres. Run `pnpm
test:sql` for the fast answer. What follows is the manual pass, which is still worth
doing after a deploy because it goes through PostgREST and a real JWT — the two things
the automated version cannot reach.

Start with the anonymous checks — no session required, and they confirm the deny-by-default
grants are intact. Every one must be refused:

```bash
# Expect 42501 "permission denied" on all of them, not data and not a 404.
for t in shifts profiles shift_assignments time_off invoices audit_log teams; do
  curl -sS "$SUPABASE_URL/rest/v1/$t?select=*&limit=1" -H "apikey: $ANON_KEY"
done
```

A `404 PGRST205` means the migration has not run. Data means the grants are wrong.

Then sign in as a regular user, open the browser console, and confirm each of these:

```js
// One row — your own — not the whole practice.
await supabase.from('profiles').select('*')

// Rejected: hourly_rate_cents is not in the column grant.
await supabase.from('profiles').update({ hourly_rate_cents: 999999 }).eq('id', myId)

// Rejected: no INSERT grant exists on this table for anyone.
await supabase.from('shift_assignments').insert({ shift_id: someId, profile_id: myId })

// Rejected: the insert policy only accepts status = 'requested'.
await supabase.from('time_off').insert({ profile_id: myId, starts_on: '2026-09-01',
  ends_on: '2026-09-05', status: 'approved' })

// Empty: reading the audit log is administrators only.
await supabase.from('audit_log').select('*')

// Raises: the shift falls inside approved time off.
await supabase.rpc('claim_shift', { p_shift_id: overlappingShiftId })

// Accepted: any window inside a 12-7 shift you hold.
await supabase.rpc('set_shift_hours', { p_shift_id: myShiftId,
  p_start: '2026-09-01T13:00:00-04:00', p_end: '2026-09-01T17:00:00-04:00' })

// Raises "outside the published shift": the bound is the whole control here.
await supabase.rpc('set_shift_hours', { p_shift_id: myShiftId,
  p_start: '2026-09-01T06:00:00-04:00', p_end: '2026-09-01T23:00:00-04:00' })

// Raises "You can only change the hours on your own shifts."
await supabase.rpc('set_shift_hours', { p_shift_id: someoneElsesShiftId,
  p_start: '2026-09-01T13:00:00-04:00', p_end: '2026-09-01T17:00:00-04:00' })

// Raises and names the invoice, once an admin has invoiced that period.
await supabase.rpc('set_shift_hours', { p_shift_id: invoicedShiftId,
  p_start: '2026-09-01T13:00:00-04:00', p_end: '2026-09-01T17:00:00-04:00' })

// Rejected: the helper is revoked from `authenticated`, not just `anon`.
await supabase.rpc('apply_shift_hours', { p_shift_id: myShiftId,
  p_start: null, p_end: null })

```

And the race: call `claim_shift` for the same shift from two browsers at once. Exactly
one succeeds.

## Reporting

Email <dhruv@elevatedretreats.ca>. This is a prototype and carries no bug bounty.
