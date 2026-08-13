// @vitest-environment node
//
// Runs the migrations against real PostgreSQL — PGlite is the actual engine compiled to
// WebAssembly, not a mock — and then exercises the rules that exist only in SQL.
//
// This is here because the rest of the suite cannot reach them. Authorisation in this
// project lives in Postgres by design (there is no server to put it in), so the checks
// that matter most are the ones a TypeScript test can say nothing about: who may write
// which column, whether a policy recurses, whether an RPC refuses the caller it should.
// The repository's own history is the argument — `0002` rolled back in full because the
// Supabase SQL editor runs a pasted script as one transaction, and two privilege defects
// reached the live project and were found only by probing it.
//
// What it does not cover: PostgREST, JWT issuance, and Supabase's own `auth` schema,
// which is stubbed below. A green run means the SQL is correct, not that the round trip
// through the API is.
//
// The file is one ordered scenario — each block builds on the last, which is unavoidable
// for a stateful database and is why nothing here runs concurrently.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const sqlFile = (relative: string) =>
  readFileSync(new URL(`../supabase/${relative}`, import.meta.url), "utf8");
const migration = (name: string) => sqlFile(`migrations/${name}`);

/**
 * The files a fresh install runs, in the order the README documents. 0002-0004 repair
 * projects created before those defects were found; 0001 was corrected in place, so they
 * are not replayed.
 */
const INSTALL_ORDER = [
  "0001_init.sql",
  "0005_flexible_hours.sql",
  "0006_timezones.sql",
  "0007_person_rates.sql",
  "0008_practice_settings.sql",
];

/**
 * The pieces of Supabase the migrations lean on. The real `auth.uid()` reads a JWT claim;
 * this reads a session GUC so one connection can act as different people.
 *
 * The time zone is pinned to UTC because a PostgREST connection runs there and PGlite would
 * otherwise inherit whatever the developer's machine is set to — the date-boundary defect
 * 0006 fixes is invisible on a machine that happens to sit in the practice's zone.
 */
const AUTH_STUB = `
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text not null,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('app.test_uid', true), '')::uuid
  $fn$;
  do $do$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated;
    end if;
  end $do$;
  set time zone 'UTC';
`;

const ALICE = "11111111-1111-1111-1111-111111111111"; // radiologist, holds the shifts
const BOB = "22222222-2222-2222-2222-222222222222"; // radiologist, holds nothing
const CAROL = "33333333-3333-3333-3333-333333333333"; // administrator

const SHIFT_A = "aaaaaaaa-0000-0000-0000-000000000001"; // 12:00-19:00, the 12-7 posting
const SHIFT_B = "bbbbbbbb-0000-0000-0000-000000000002"; // 20:00-00:00, adjacent to A
// 20:00-23:00 on 31 August in Toronto — which is 00:00-03:00 on 1 September in UTC.
const LATE_SHIFT = "cccccccc-0000-0000-0000-000000000003";

let db: PGlite;

/** Acts as a given user for subsequent statements; null is an anonymous caller. */
const as = (uid: string | null) => db.exec(`set app.test_uid = '${uid ?? ""}'`);

async function row<T = Record<string, unknown>>(sql: string): Promise<T> {
  const result = await db.query<T>(sql);
  return result.rows[0];
}

/** Runs `sql` and returns the error message rather than throwing, or null if it passed. */
async function refusal(sql: string): Promise<string | null> {
  try {
    await db.exec(sql);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const setHours = (shift: string, start: string | null, end: string | null) =>
  `select public.set_shift_hours('${shift}'::uuid, ${
    start ? `'${start}'::timestamptz` : "null"
  }, ${end ? `'${end}'::timestamptz` : "null"})`;

const minutesFor = async (profile: string) => {
  const summary = await row<{ total_minutes: string | null }>(
    `select total_minutes from public.hours_summary('2026-09-01', '2026-09-30')
     where profile_id = '${profile}'`,
  );
  return Number(summary?.total_minutes ?? 0);
};

beforeAll(async () => {
  db = new PGlite();

  await db.exec(AUTH_STUB);
  for (const file of INSTALL_ORDER) await db.exec(migration(file));

  // Inserting into auth.users fires the profile trigger from 0001.
  await db.exec(`
    insert into auth.users (id, email) values
      ('${ALICE}', 'alice@practice.test'),
      ('${BOB}',   'bob@practice.test'),
      ('${CAROL}', 'carol@practice.test');

    update public.profiles set full_name = 'Alice', hourly_rate_cents = 26000
      where id = '${ALICE}';
    update public.profiles set full_name = 'Bob', hourly_rate_cents = 26000
      where id = '${BOB}';
    update public.profiles set full_name = 'Carol', role = 'admin'
      where id = '${CAROL}';

    insert into public.shifts
      (id, title, location, starts_at, ends_at, required_role)
    values
      ('${SHIFT_A}', 'Day Read', 'Main', '2026-09-01T12:00:00Z',
       '2026-09-01T19:00:00Z', 'radiologist'),
      ('${SHIFT_B}', 'Evening',  'Main', '2026-09-01T20:00:00Z',
       '2026-09-02T00:00:00Z', 'radiologist');
  `);
}, 120_000);

/**
 * The install order the README documents, run from an empty database.
 *
 * On its own instance rather than the shared one, because `seed.sql` adds 272 shifts and
 * four teams and every count assertion in the rest of this file would then be measuring
 * them instead of its own fixtures.
 *
 * This exists because the order is a fact about five separate files that nothing else
 * checks. A migration added out of sequence, or one that assumes a column a later file
 * drops, or a seed that still supplies a column that no longer exists, fails here rather
 * than in somebody's SQL editor halfway through a deploy.
 */
describe("the documented install order", () => {
  let install: PGlite;

  const value = async <T>(sql: string): Promise<T> => {
    const result = await install.query<Record<string, T>>(sql);
    return Object.values(result.rows[0])[0];
  };

  beforeAll(async () => {
    install = new PGlite();
    await install.exec(AUTH_STUB);
    for (const file of INSTALL_ORDER) await install.exec(migration(file));
    await install.exec(sqlFile("seed.sql"));
    // The operator step the README calls out separately: schema and configuration are not
    // the same thing, and the anchor is UTC until this is set.
    await install.exec(`set app.practice_timezone = 'America/Toronto'`);
  }, 120_000);

  it("creates the four teams, Paediatrics among them", async () => {
    const teams = await install.query<{ name: string }>(
      "select name from public.teams order by name",
    );
    expect(teams.rows.map((t) => t.name)).toEqual([
      "Body Imaging",
      "Emergency Radiology",
      "Neuro",
      "Paediatrics",
    ]);
  });

  it("publishes a roster with no mammography left in it", async () => {
    const titles = await install.query<{ title: string }>(
      "select distinct title from public.shifts order by title",
    );
    const names = titles.rows.map((t) => t.title);
    expect(names).toContain("Peds Clinic");
    expect(names).not.toContain("Screening Clinic");
    expect(names).not.toContain("Mammo Clinic");
    expect(await value<number>("select count(*)::int from public.shifts")).toBeGreaterThan(
      200,
    );
  });

  it("gives the paediatric clinic a modality and team that match its name", async () => {
    const row = await install.query<{ modality: string; team: string }>(`
      select s.modality, t.name as team
      from public.shifts s join public.teams t on t.id = s.team_id
      where s.title = 'Peds Clinic' limit 1
    `);
    expect(row.rows[0]).toEqual({ modality: "XR/US", team: "Paediatrics" });
  });

  it("leaves no shift rate column for the seed to have filled", async () => {
    // The seed and 0007 have to agree on this. If 0007 stopped dropping the column, or the
    // seed started supplying it again, one of them would fail on the other.
    expect(
      await value<number>(`
        select count(*)::int from information_schema.columns
        where table_schema = 'public' and table_name = 'shifts'
          and column_name = 'hourly_rate_cents'
      `),
    ).toBe(0);
  });

  it("enables row level security on every table it creates", async () => {
    const unprotected = await install.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(unprotected.rows.map((r) => r.tablename)).toEqual([]);
  });

  it("grants anon nothing in public, seeded data included", async () => {
    const leaks = await install.query(`
      select table_name from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
    `);
    expect(leaks.rows).toEqual([]);
  });

  it("resolves the practice zone once an operator sets it", async () => {
    expect(await value<string>("select public.practice_timezone()")).toBe(
      "America/Toronto",
    );
  });

  it("creates nobody — accounts come from real signups", async () => {
    // seed.sql deliberately does not invent profiles: they are minted by the trigger on
    // auth.users, so the first administrator still has to be promoted by hand.
    expect(await value<number>("select count(*)::int from public.profiles")).toBe(0);
  });

  it("applies as one transaction too, which is what a single paste becomes", async () => {
    // The Supabase SQL editor runs a pasted script as one transaction. For a fresh install
    // that is a feature — anything failing leaves nothing half-applied — but it only holds
    // if no file needs its own transaction, which this is here to keep true.
    const combined = new PGlite();
    await combined.exec(AUTH_STUB);
    await combined.exec(
      [...INSTALL_ORDER.map(migration), sqlFile("seed.sql")].join("\n"),
    );
    const shifts = await combined.query<{ n: number }>(
      "select count(*)::int as n from public.shifts",
    );
    expect(shifts.rows[0].n).toBeGreaterThan(200);
  }, 120_000);

  it("re-seeds cleanly after a reset", async () => {
    // The path the README documents for an existing project. Running seed.sql twice without
    // the reset would leave two rosters; with it, the count returns to where it was.
    const before = await value<number>("select count(*)::int from public.shifts");
    await install.exec(sqlFile("reset_seed.sql"));
    expect(await value<number>("select count(*)::int from public.shifts")).toBe(0);
    await install.exec(sqlFile("seed.sql"));
    expect(await value<number>("select count(*)::int from public.shifts")).toBe(before);
  }, 120_000);
});

describe("0001 — schema and triggers", () => {
  it("mints a profile for each new auth user", async () => {
    const profiles = await row<{ n: number }>(
      "select count(*)::int as n from public.profiles",
    );
    expect(profiles.n).toBe(3);
  });

  it("enables row level security on every public table", async () => {
    const unprotected = await db.query<{ tablename: string }>(`
      select tablename from pg_tables
      where schemaname = 'public' and not rowsecurity
    `);
    expect(unprotected.rows.map((r) => r.tablename)).toEqual([]);
  });
});

describe("claiming, then narrowing hours inside the window", () => {
  it("lets a radiologist claim a matching open shift", async () => {
    await as(ALICE);
    await db.exec(`select public.claim_shift('${SHIFT_A}'::uuid)`);
    const assignment = await row<{ status: string }>(
      `select status from public.shift_assignments where shift_id = '${SHIFT_A}'`,
    );
    expect(assignment.status).toBe("confirmed");
  });

  it("accepts 1-5 inside a published 12-7", async () => {
    expect(
      await refusal(
        setHours(SHIFT_A, "2026-09-01T13:00:00Z", "2026-09-01T17:00:00Z"),
      ),
    ).toBeNull();

    const stored = await row<{ actual_start: string; actual_end: string }>(
      `select actual_start, actual_end from public.shift_assignments
       where shift_id = '${SHIFT_A}'`,
    );
    expect(new Date(stored.actual_start).toISOString()).toBe("2026-09-01T13:00:00.000Z");
    expect(new Date(stored.actual_end).toISOString()).toBe("2026-09-01T17:00:00.000Z");
  });

  it("carries the choice into hours and pay, not just the row", async () => {
    const summary = await row<{ total_minutes: string; total_cents: string }>(
      `select total_minutes, total_cents from public.hours_summary('2026-09-01', '2026-09-30')
       where profile_id = '${ALICE}'`,
    );
    // Four hours of the published seven, at Alice's own $260/h — the rate now comes
    // from her profile, since shifts no longer carry one.
    expect(Number(summary.total_minutes)).toBe(240);
    expect(Number(summary.total_cents)).toBe(104000);
  });
});

describe("refusals", () => {
  it("will not let a holder extend past the published window", async () => {
    await as(ALICE);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T11:00:00Z", "2026-09-01T20:00:00Z"),
    );
    expect(err).toMatch(/outside the published shift/);
  });

  it("requires the end to follow the start", async () => {
    await as(ALICE);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T17:00:00Z", "2026-09-01T13:00:00Z"),
    );
    expect(err).toMatch(/end time has to be after/);
  });

  it("will not let another radiologist touch it", async () => {
    await as(BOB);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T13:00:00Z", "2026-09-01T17:00:00Z"),
    );
    expect(err).toMatch(/only change the hours on your own shifts/);
  });

  it("refuses an anonymous caller", async () => {
    await as(null);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T13:00:00Z", "2026-09-01T17:00:00Z"),
    );
    expect(err).toMatch(/Not authenticated/);
  });

  it("leaves the stored window untouched after all of that", async () => {
    expect(await minutesFor(ALICE)).toBe(240);
  });
});

describe("the administrator exemption", () => {
  it("lets an admin record an overrun beyond the published window", async () => {
    await as(CAROL);
    expect(
      await refusal(
        setHours(SHIFT_A, "2026-09-01T11:00:00Z", "2026-09-01T21:00:00Z"),
      ),
    ).toBeNull();
    expect(await minutesFor(ALICE)).toBe(600);
  });

  it("marks admin-made changes in the audit log", async () => {
    const audit = await row<{ n: number }>(`
      select count(*)::int as n from public.audit_log
      where action = 'assignment.hours' and (metadata -> 'by_admin')::boolean
    `);
    expect(audit.n).toBe(1);
  });
});

describe("restoring the published hours", () => {
  it("clears the override when both timestamps are null", async () => {
    await as(ALICE);
    expect(await refusal(setHours(SHIFT_A, null, null))).toBeNull();

    const cleared = await row<{ actual_start: null; actual_end: null }>(
      `select actual_start, actual_end from public.shift_assignments
       where shift_id = '${SHIFT_A}'`,
    );
    expect(cleared.actual_start).toBeNull();
    expect(cleared.actual_end).toBeNull();
  });

  it("puts the report back to the published seven hours", async () => {
    expect(await minutesFor(ALICE)).toBe(420);
  });
});

describe("no hour is billed twice", () => {
  it("refuses a window that overlaps another shift the person holds", async () => {
    await as(ALICE);
    await db.exec(`select public.claim_shift('${SHIFT_B}'::uuid)`);

    // Only reachable through the admin exemption: a holder cannot leave the window in
    // the first place, and claim_shift() already proved the two do not overlap.
    await as(CAROL);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T12:00:00Z", "2026-09-01T21:00:00Z"),
    );
    expect(err).toMatch(/overlap another shift/);
  });
});

describe("bulk apply", () => {
  it("applies what fits and skips what does not, without rolling back", async () => {
    await as(ALICE);
    // 13:00-17:00 fits shift A and cannot fit shift B's 20:00-00:00.
    const results = await db.query<{
      shift_id: string;
      applied: boolean;
      reason: string | null;
    }>(`
      select shift_id, applied, reason from public.set_shift_hours_bulk('[
        {"shift_id": "${SHIFT_A}", "start": "2026-09-01T13:00:00Z", "end": "2026-09-01T17:00:00Z"},
        {"shift_id": "${SHIFT_B}", "start": "2026-09-01T13:00:00Z", "end": "2026-09-01T17:00:00Z"}
      ]'::jsonb)
    `);

    expect(results.rows).toHaveLength(2);
    const forA = results.rows.find((r) => r.shift_id === SHIFT_A);
    const forB = results.rows.find((r) => r.shift_id === SHIFT_B);

    expect(forA?.applied).toBe(true);
    expect(forB?.applied).toBe(false);
    expect(forB?.reason).toMatch(/outside the published shift/);
  });

  it("really wrote the half that applied", async () => {
    const stored = await row<{ actual_start: string | null }>(
      `select actual_start from public.shift_assignments where shift_id = '${SHIFT_A}'`,
    );
    expect(stored.actual_start).not.toBeNull();
  });

  it("rejects a payload that is not an array", async () => {
    const err = await refusal(`select public.set_shift_hours_bulk('"nonsense"'::jsonb)`);
    expect(err).toMatch(/Expected an array/);
  });
});

describe("an invoiced period freezes", () => {
  let invoiceNumber: string;

  it("bills the chosen hours, not the published ones", async () => {
    await as(CAROL);
    const invoice = await row<{ number: string }>(
      `select number from public.create_invoice('${ALICE}'::uuid, '2026-09-01', '2026-09-30')`,
    );
    invoiceNumber = invoice.number;

    const line = await row<{ minutes: string; rate_cents: string; amount_cents: string }>(
      `select minutes, rate_cents, amount_cents from public.invoice_lines
       where shift_id = '${SHIFT_A}'`,
    );
    expect(Number(line.minutes)).toBe(240);
    expect(Number(line.rate_cents)).toBe(26000);
    expect(Number(line.amount_cents)).toBe(104000);
  });

  it("stops the holder moving hours that are already on an invoice", async () => {
    await as(ALICE);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T14:00:00Z", "2026-09-01T18:00:00Z"),
    );
    expect(err).toMatch(/Already invoiced on/);
    expect(err).toContain(invoiceNumber);
  });

  it("stops an administrator too, while the invoice stands", async () => {
    await as(CAROL);
    const err = await refusal(
      setHours(SHIFT_A, "2026-09-01T14:00:00Z", "2026-09-01T18:00:00Z"),
    );
    expect(err).toMatch(/Already invoiced on/);
  });

  it("keeps the report and the invoice in agreement", async () => {
    const line = await row<{ minutes: string }>(
      `select minutes from public.invoice_lines where shift_id = '${SHIFT_A}'`,
    );
    expect(Number(line.minutes)).toBe(240);
    // Shift A's 240 plus shift B's published 240.
    expect(await minutesFor(ALICE)).toBe(480);
  });
});

describe("audit trail", () => {
  it("writes one row per applied change and none for a refusal", async () => {
    // Narrow, admin overrun, reset, bulk-apply. Every other attempt above was refused.
    const audit = await row<{ n: number }>(
      `select count(*)::int as n from public.audit_log where action = 'assignment.hours'`,
    );
    expect(audit.n).toBe(4);
  });

  it("records the window on either side of the change", async () => {
    const first = await row<{ old_start: string | null; new_start: string | null }>(`
      select metadata -> 'old' ->> 'start' as old_start,
             metadata -> 'new' ->> 'start' as new_start
      from public.audit_log
      where action = 'assignment.hours' order by id limit 1
    `);
    expect(first.old_start).toBeNull();
    expect(first.new_start).not.toBeNull();
  });

  it("grants nobody the means to rewrite it", async () => {
    const priv = await row<{ upd: boolean; del: boolean }>(`
      select has_table_privilege('authenticated', 'public.audit_log', 'UPDATE') as upd,
             has_table_privilege('authenticated', 'public.audit_log', 'DELETE') as del
    `);
    expect(priv.upd).toBe(false);
    expect(priv.del).toBe(false);
  });
});

describe("privileges", () => {
  it("exposes the hours RPCs to signed-in users only", async () => {
    const priv = await row<Record<string, boolean>>(`
      select
        has_function_privilege('authenticated',
          'public.set_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as auth_single,
        has_function_privilege('authenticated',
          'public.set_shift_hours_bulk(jsonb)', 'EXECUTE') as auth_bulk,
        has_function_privilege('anon',
          'public.set_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as anon_single,
        has_function_privilege('anon',
          'public.set_shift_hours_bulk(jsonb)', 'EXECUTE') as anon_bulk
    `);
    expect(priv.auth_single).toBe(true);
    expect(priv.auth_bulk).toBe(true);
    expect(priv.anon_single).toBe(false);
    expect(priv.anon_bulk).toBe(false);
  });

  it("keeps the private helper unreachable, including from authenticated", async () => {
    // authenticated holds USAGE on schema private (0003), so the revoke on the helper
    // is the only thing standing between it and a direct call.
    const priv = await row<{ auth_helper: boolean; anon_helper: boolean }>(`
      select
        has_function_privilege('authenticated',
          'private.apply_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as auth_helper,
        has_function_privilege('anon',
          'private.apply_shift_hours(uuid, timestamptz, timestamptz)', 'EXECUTE') as anon_helper
    `);
    expect(priv.auth_helper).toBe(false);
    expect(priv.anon_helper).toBe(false);
  });

  it("never lets a user write their own role or pay band", async () => {
    const priv = await row<{ rate: boolean; role: boolean; name: boolean }>(`
      select
        has_column_privilege('authenticated', 'public.profiles', 'hourly_rate_cents', 'UPDATE') as rate,
        has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') as role,
        has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') as name
    `);
    expect(priv.rate).toBe(false);
    expect(priv.role).toBe(false);
    expect(priv.name).toBe(true);
  });

  it("leaves shift_assignments writable only through the RPCs", async () => {
    const priv = await row<{ ins: boolean; upd: boolean; sel: boolean }>(`
      select has_table_privilege('authenticated', 'public.shift_assignments', 'INSERT') as ins,
             has_table_privilege('authenticated', 'public.shift_assignments', 'UPDATE') as upd,
             has_table_privilege('authenticated', 'public.shift_assignments', 'SELECT') as sel
    `);
    expect(priv.ins).toBe(false);
    expect(priv.upd).toBe(false);
    expect(priv.sel).toBe(true);
  });

  it("grants anon nothing at all in public", async () => {
    const leaks = await db.query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
    `);
    expect(leaks.rows).toEqual([]);
  });
});

/**
 * The policies themselves, which is the part that actually decides who sees what.
 *
 * Everything above runs as `postgres`, and a superuser bypasses RLS entirely — so none
 * of it says anything about the policies. `SET ROLE` drops the connection to a real
 * grantee, at which point the policies apply exactly as they do for a signed-in user
 * and these become the automated form of the manual console checklist in SECURITY.md.
 */
describe("row level security, as a real non-superuser", () => {
  const asRole = (role: "authenticated" | "anon", uid: string | null = null) =>
    db.exec(`reset role; set app.test_uid = '${uid ?? ""}'; set role ${role};`);

  // Later blocks and teardown need superuser again; a leaked SET ROLE would cascade.
  afterEach(() => db.exec("reset role"));

  describe("profiles", () => {
    it("shows a user their own row and nobody else's", async () => {
      await asRole("authenticated", ALICE);
      const rows = await db.query<{ id: string }>("select id from public.profiles");
      expect(rows.rows.map((r) => r.id)).toEqual([ALICE]);
    });

    it("shows an administrator everyone", async () => {
      await asRole("authenticated", CAROL);
      const rows = await db.query<{ id: string }>("select id from public.profiles");
      expect(rows.rows).toHaveLength(3);
    });

    it("refuses a self-awarded pay rise at the column grant", async () => {
      await asRole("authenticated", ALICE);
      const err = await refusal(
        `update public.profiles set hourly_rate_cents = 999999 where id = '${ALICE}'`,
      );
      expect(err).toMatch(/permission denied/);
    });

    it("refuses a self-promotion to admin", async () => {
      await asRole("authenticated", ALICE);
      const err = await refusal(
        `update public.profiles set role = 'admin' where id = '${ALICE}'`,
      );
      expect(err).toMatch(/permission denied/);
    });

    it("still lets someone rename themselves", async () => {
      await asRole("authenticated", ALICE);
      expect(
        await refusal(
          `update public.profiles set full_name = 'Dr Alice' where id = '${ALICE}'`,
        ),
      ).toBeNull();
    });
  });

  describe("shift_assignments", () => {
    it("cannot be written directly, only through the RPCs", async () => {
      await asRole("authenticated", BOB);
      const err = await refusal(`
        insert into public.shift_assignments (shift_id, profile_id)
        values ('${SHIFT_A}', '${BOB}')
      `);
      expect(err).toMatch(/permission denied/);
    });

    it("hides other people's assignments — the reason the calendar reads status", async () => {
      await asRole("authenticated", BOB);
      const rows = await db.query("select id from public.shift_assignments");
      expect(rows.rows).toEqual([]);
    });
  });

  describe("time_off", () => {
    it("accepts a request for yourself", async () => {
      await asRole("authenticated", ALICE);
      expect(
        await refusal(`
          insert into public.time_off (profile_id, starts_on, ends_on, kind)
          values ('${ALICE}', '2026-10-05', '2026-10-09', 'vacation')
        `),
      ).toBeNull();
    });

    it("refuses one that approves itself on the way in", async () => {
      await asRole("authenticated", ALICE);
      const err = await refusal(`
        insert into public.time_off (profile_id, starts_on, ends_on, kind, status)
        values ('${ALICE}', '2026-11-02', '2026-11-06', 'vacation', 'approved')
      `);
      expect(err).toMatch(/row-level security/);
    });

    it("refuses one filed on someone else's behalf", async () => {
      await asRole("authenticated", BOB);
      const err = await refusal(`
        insert into public.time_off (profile_id, starts_on, ends_on, kind)
        values ('${ALICE}', '2026-12-01', '2026-12-03', 'vacation')
      `);
      expect(err).toMatch(/row-level security/);
    });

    it("hides one person's leave from another", async () => {
      await asRole("authenticated", BOB);
      const rows = await db.query("select id from public.time_off");
      expect(rows.rows).toEqual([]);
    });

    it("will not let a user approve their own pending request", async () => {
      await asRole("authenticated", ALICE);
      // The policy's USING and WITH CHECK both pin status to 'requested', so the row
      // matches going in and fails coming out: zero rows updated rather than an error.
      await db.exec(
        `update public.time_off set status = 'approved' where profile_id = '${ALICE}'`,
      ).catch(() => undefined);
      await db.exec("reset role");
      const approved = await row<{ n: number }>(`
        select count(*)::int as n from public.time_off
        where profile_id = '${ALICE}' and status = 'approved'
      `);
      expect(approved.n).toBe(0);
    });
  });

  describe("invoices and the audit log", () => {
    it("keeps one person's invoice away from another", async () => {
      await asRole("authenticated", BOB);
      const rows = await db.query("select id from public.invoices");
      expect(rows.rows).toEqual([]);
    });

    it("shows an invoice to the person it bills", async () => {
      await asRole("authenticated", ALICE);
      const rows = await db.query("select id from public.invoices");
      expect(rows.rows).toHaveLength(1);
    });

    it("hides invoice lines along with their invoice", async () => {
      await asRole("authenticated", BOB);
      const rows = await db.query("select id from public.invoice_lines");
      expect(rows.rows).toEqual([]);
    });

    it("keeps the audit log to administrators", async () => {
      await asRole("authenticated", BOB);
      const asUser = await db.query("select id from public.audit_log");
      expect(asUser.rows).toEqual([]);

      await asRole("authenticated", CAROL);
      const asAdmin = await db.query("select id from public.audit_log");
      expect(asAdmin.rows.length).toBeGreaterThan(0);
    });
  });

  describe("the open-shift board", () => {
    it("is readable by everyone signed in — that is the point of it", async () => {
      await asRole("authenticated", BOB);
      const rows = await db.query("select id from public.shifts");
      expect(rows.rows).toHaveLength(2);
    });

    it("is not writable by a non-admin", async () => {
      await asRole("authenticated", BOB);
      const err = await refusal(`
        insert into public.shifts (title, starts_at, ends_at)
        values ('Ghost shift', '2026-09-20T08:00:00Z', '2026-09-20T16:00:00Z')
      `);
      expect(err).toMatch(/row-level security/);
    });
  });

  describe("anonymous callers", () => {
    // The first checks in SECURITY.md's verification section, run automatically.
    for (const table of [
      "profiles",
      "shifts",
      "shift_assignments",
      "time_off",
      "invoices",
      "audit_log",
      "teams",
    ]) {
      it(`cannot read ${table}`, async () => {
        await asRole("anon");
        const err = await refusal(`select * from public.${table} limit 1`);
        expect(err).toMatch(/permission denied/);
      });
    }

    it("cannot call the claim RPC", async () => {
      await asRole("anon");
      const err = await refusal(`select public.claim_shift('${SHIFT_A}'::uuid)`);
      expect(err).toMatch(/permission denied/);
    });
  });
});

/**
 * 0006. The session runs in UTC above, as PostgREST's does, which is the whole point:
 * `timestamptz::date` resolved there put an evening shift on the following day and
 * counted it in the wrong month.
 */
describe("the practice zone anchors every date boundary", () => {
  const toronto = () => db.exec(`set app.practice_timezone = 'America/Toronto'`);
  const unset = () => db.exec("reset app.practice_timezone");

  const bobMinutes = async (from: string, to: string) => {
    const r = await db.query<{ total_minutes: string }>(
      `select total_minutes from public.hours_summary('${from}','${to}')
       where profile_id = '${BOB}'`,
    );
    return r.rows.length ? Number(r.rows[0].total_minutes) : null;
  };

  it("defaults to UTC, so applying the migration alone changes no figure", async () => {
    await unset();
    const zone = await row<{ practice_timezone: string }>(
      "select public.practice_timezone()",
    );
    expect(zone.practice_timezone).toBe("UTC");
  });

  it("reads the configured zone", async () => {
    await toronto();
    const zone = await row<{ practice_timezone: string }>(
      "select public.practice_timezone()",
    );
    expect(zone.practice_timezone).toBe("America/Toronto");
  });

  it("counts a late-evening shift in the practice's month", async () => {
    await toronto();
    await db.exec(`
      insert into public.shifts
        (id, title, location, starts_at, ends_at, required_role)
      values ('${LATE_SHIFT}', 'Late Read', 'Main',
              '2026-08-31T20:00:00-04:00', '2026-08-31T23:00:00-04:00',
              'radiologist')
    `);
    await as(BOB);
    await db.exec(`select public.claim_shift('${LATE_SHIFT}'::uuid)`);

    expect(await bobMinutes("2026-08-01", "2026-08-31")).toBe(180);
    expect(await bobMinutes("2026-09-01", "2026-09-30")).toBeNull();
  });

  it("is the defect being fixed: under UTC the same shift moves month", async () => {
    // Same data, same query, anchor removed. Three hours worked on 31 August land in
    // September, and every report and invoice for both months is wrong by that much.
    await unset();
    expect(await bobMinutes("2026-08-01", "2026-08-31")).toBeNull();
    expect(await bobMinutes("2026-09-01", "2026-09-30")).toBe(180);
    await toronto();
  });

  it("dates an invoice line by the practice's calendar day", async () => {
    await toronto();
    await as(CAROL);
    await db.exec(
      `select public.create_invoice('${BOB}'::uuid, '2026-08-01', '2026-08-31')`,
    );
    const line = await row<{ worked_on: Date; minutes: string }>(
      `select l.worked_on, l.minutes from public.invoice_lines l
       where l.shift_id = '${LATE_SHIFT}'`,
    );
    expect(new Date(line.worked_on).toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(Number(line.minutes)).toBe(180);
  });

  it("records the zone the invoice was computed in", async () => {
    const audit = await row<{ zone: string }>(`
      select metadata ->> 'practice_timezone' as zone from public.audit_log
      where action = 'invoice.create' order by id desc limit 1
    `);
    expect(audit.zone).toBe("America/Toronto");
  });

  it("compares approved leave against practice-zone dates when claiming", async () => {
    await toronto();
    // Leave covering 31 August only. The shift runs 20:00-23:00 that evening, which in
    // UTC is 1 September — so before this fix the claim went straight through.
    await db.exec(`
      insert into public.time_off (profile_id, starts_on, ends_on, kind, status)
      values ('${BOB}', '2026-08-31', '2026-08-31', 'vacation', 'approved')
    `);
    await db.exec(`select public.release_shift('${LATE_SHIFT}'::uuid)`);
    await as(BOB);
    const err = await refusal(`select public.claim_shift('${LATE_SHIFT}'::uuid)`);
    expect(err).toMatch(/inside your approved time off/);

    // Put the scenario back: the leave goes, the shift is re-claimed. Without this the
    // block below finds Bob holding nothing and reads it as a pay change.
    await db.exec(`delete from public.time_off where profile_id = '${BOB}'`);
    await db.exec(`select public.claim_shift('${LATE_SHIFT}'::uuid)`);
  });
});

describe("a person's home time zone", () => {
  it("starts unset, meaning the practice zone", async () => {
    const profile = await row<{ timezone: string | null }>(
      `select timezone from public.profiles where id = '${ALICE}'`,
    );
    expect(profile.timezone).toBeNull();
  });

  it("can be set by the person themselves", async () => {
    await db.exec("reset role");
    await db.exec(`set app.test_uid = '${ALICE}'`);
    await db.exec("set role authenticated");
    const err = await refusal(
      `update public.profiles set timezone = 'America/Vancouver' where id = '${ALICE}'`,
    );
    await db.exec("reset role");
    expect(err).toBeNull();

    const profile = await row<{ timezone: string }>(
      `select timezone from public.profiles where id = '${ALICE}'`,
    );
    expect(profile.timezone).toBe("America/Vancouver");
  });

  it("refuses a zone Postgres does not recognise", async () => {
    const err = await refusal(
      `update public.profiles set timezone = 'Mars/Olympus_Mons' where id = '${ALICE}'`,
    );
    expect(err).toMatch(/Unknown time zone/);
  });

  it("still cannot be used as a way into the pay columns", async () => {
    await db.exec("reset role");
    await db.exec(`set app.test_uid = '${ALICE}'`);
    await db.exec("set role authenticated");
    const err = await refusal(`
      update public.profiles set timezone = 'America/Toronto', hourly_rate_cents = 999999
      where id = '${ALICE}'
    `);
    await db.exec("reset role");
    expect(err).toMatch(/permission denied/);
  });

  it("changes nothing about what anyone is paid", async () => {
    // The home zone is presentation. hours_summary reads the practice zone only.
    await db.exec(`set app.practice_timezone = 'America/Toronto'`);
    const withVancouverHome = await row<{ total_minutes: string }>(
      `select total_minutes from public.hours_summary('2026-08-01','2026-08-31')
       where profile_id = '${BOB}'`,
    );
    expect(Number(withVancouverHome.total_minutes)).toBe(180);
  });
});

/**
 * 0007. Pay is a property of the person, not the posting. The shift column is gone, so
 * there is exactly one rate per person and one place it is set.
 */
describe("one rate per person", () => {
  it("has no rate column on shifts at all", async () => {
    const gone = await row<{ rate_column_gone: boolean }>(`
      select not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'shifts'
          and column_name = 'hourly_rate_cents'
      ) as rate_column_gone
    `);
    expect(gone.rate_column_gone).toBe(true);
  });

  it("pays the holder their profile rate", async () => {
    // Bob holds three hours in August at his $260.
    const before = await row<{ total_cents: string }>(
      `select total_cents from public.hours_summary('2026-08-01','2026-08-31')
       where profile_id = '${BOB}'`,
    );
    expect(Number(before.total_cents)).toBe(78000);
  });

  it("follows a rate change on the profile", async () => {
    await as(CAROL);
    await db.exec(
      `select public.admin_update_profile('${BOB}'::uuid, 'radiologist', 30000, true)`,
    );
    const after = await row<{ total_cents: string }>(
      `select total_cents from public.hours_summary('2026-08-01','2026-08-31')
       where profile_id = '${BOB}'`,
    );
    expect(Number(after.total_cents)).toBe(90000);
  });

  it("leaves an already-issued invoice alone when the rate moves", async () => {
    // The reason invoice_lines stores rate_cents rather than recomputing it: Bob's August
    // invoice was issued at $260 and must still say $260 after his raise, or a document
    // already sent would quietly disagree with itself.
    const line = await row<{ rate_cents: string; amount_cents: string }>(
      `select rate_cents, amount_cents from public.invoice_lines
       where shift_id = '${LATE_SHIFT}'`,
    );
    expect(Number(line.rate_cents)).toBe(26000);
    expect(Number(line.amount_cents)).toBe(78000);
  });

  it("still refuses to let anyone set their own rate", async () => {
    await db.exec("reset role");
    await db.exec(`set app.test_uid = '${BOB}'`);
    await db.exec("set role authenticated");
    const err = await refusal(
      `update public.profiles set hourly_rate_cents = 999999 where id = '${BOB}'`,
    );
    await db.exec("reset role");
    expect(err).toMatch(/permission denied/);
  });

  it("lets a person read their own rate, which is what the profile page shows", async () => {
    await db.exec("reset role");
    await db.exec(`set app.test_uid = '${BOB}'`);
    await db.exec("set role authenticated");
    const own = await db.query<{ hourly_rate_cents: number }>(
      "select hourly_rate_cents from public.profiles",
    );
    await db.exec("reset role");
    expect(own.rows).toHaveLength(1);
    expect(Number(own.rows[0].hourly_rate_cents)).toBe(30000);
  });
});

/**
 * 0008. Configuration lives in a table because the database setting it used to live in
 * cannot be set on Supabase: `postgres` owns the database but is not a superuser, and from
 * PostgreSQL 15 a custom parameter at database level needs superuser. Verified against a
 * live project — `42501: permission denied to set parameter` — which meant the reporting
 * anchor silently stayed on UTC and the signup allowlist could never be turned on.
 */
describe("practice settings, without a superuser", () => {
  it("defaults to UTC when nothing is configured", async () => {
    await db.exec("reset app.practice_timezone");
    await db.exec("update private.practice_settings set timezone = null where id");
    expect(
      (await row<{ practice_timezone: string }>("select public.practice_timezone()"))
        .practice_timezone,
    ).toBe("UTC");
  });

  it("lets an administrator set the zone through the RPC", async () => {
    await as(CAROL);
    const applied = await row<{ set_practice_settings: string }>(
      `select public.set_practice_settings('America/New_York', 'practice.test')`,
    );
    expect(applied.set_practice_settings).toBe("America/New_York");
  });

  it("anchors reporting to it, with no database-level setting in play", async () => {
    // The whole point. 20:00-23:00 on 31 August in New York is 1 September in UTC, so this
    // is the same boundary case 0006 covers — now driven by the table instead.
    const august = await row<{ total_minutes: string | null }>(
      `select total_minutes from public.hours_summary('2026-08-01','2026-08-31')
       where profile_id = '${BOB}'`,
    );
    expect(Number(august?.total_minutes ?? 0)).toBe(180);
  });

  it("refuses a zone Postgres does not recognise", async () => {
    await as(CAROL);
    const err = await refusal(
      `select public.set_practice_settings('Mars/Olympus_Mons', null)`,
    );
    expect(err).toMatch(/Unknown time zone/);
  });

  it("refuses a non-administrator", async () => {
    await as(ALICE);
    const err = await refusal(
      `select public.set_practice_settings('America/Toronto', null)`,
    );
    expect(err).toMatch(/Administrator access required/);
  });

  it("records the change, old value and new", async () => {
    const audit = await row<{ old_zone: string | null; new_zone: string }>(`
      select metadata -> 'old' ->> 'timezone' as old_zone,
             metadata -> 'new' ->> 'timezone' as new_zone
      from public.audit_log where action = 'settings.update' order by id limit 1
    `);
    expect(audit.new_zone).toBe("America/New_York");
  });

  it("keeps the settings row unreadable and unwritable directly", async () => {
    const priv = await row<{ sel: boolean; upd: boolean }>(`
      select has_table_privilege('authenticated', 'private.practice_settings', 'SELECT') as sel,
             has_table_privilege('authenticated', 'private.practice_settings', 'UPDATE') as upd
    `);
    expect(priv.sel).toBe(false);
    expect(priv.upd).toBe(false);
  });

  it("cannot hold a second row", async () => {
    const err = await refusal(
      "insert into private.practice_settings (id) values (false)",
    );
    expect(err).toBeTruthy();
  });

  it("enforces the signup allowlist that was previously inert", async () => {
    const refused = await refusal(`
      insert into auth.users (id, email)
      values ('99999999-9999-9999-9999-999999999999', 'outsider@elsewhere.test')
    `);
    expect(refused).toMatch(/Email domain is not permitted/);

    const accepted = await refusal(`
      insert into auth.users (id, email)
      values ('88888888-8888-8888-8888-888888888888', 'newhire@practice.test')
    `);
    expect(accepted).toBeNull();
  });
});
