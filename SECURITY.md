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
| `shift_assignments` | read own | read all |
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
- `shift_assignments` has no `INSERT` or `UPDATE` grant for anyone. The only way a row
  appears is `claim_shift()`.

### Claiming a shift is atomic and checked server-side

`claim_shift()` takes a row lock, then refuses the claim if the shift is not open, if
the caller's role does not match, if the dates fall inside their approved time off, or
if they already hold an overlapping shift. A partial unique index on confirmed
assignments makes double-booking impossible even under a race.

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
  Supabase origin (`src/lib/security/csp.ts`).
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
3. **Review every policy against the negative tests below**, and add a regression test
   per policy.
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

## Verifying the boundary

The claims above are only worth what the tests show. Sign in as a regular user, open
the browser console, and confirm each of these:

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
```

And the race: call `claim_shift` for the same shift from two browsers at once. Exactly
one succeeds.

## Reporting

Email <dhruv@elevatedretreats.ca>. This is a prototype and carries no bug bounty.
