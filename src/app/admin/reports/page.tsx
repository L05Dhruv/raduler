"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { endOfMonth, startOfMonth, subMonths } from "date-fns";
import { BarChart3, Download } from "lucide-react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AppShell } from "@/components/AppShell";
import { PageTransition } from "@/components/PageTransition";
import { EmptyState } from "@/components/ui/EmptyState";
import { getHoursSummary, summaryToCsv } from "@/lib/repositories/reports";
import { downloadBlob } from "@/lib/download";
import { formatCents, formatMinutes, fromDateInput, toDateInput, toHours } from "@/lib/format";
import type { HoursSummaryRow } from "@/types/db";

export default function AdminReportsPage() {
  return (
    <RequireAdmin>
      <AppShell>
        <PageTransition>
          <HoursReport />
        </PageTransition>
      </AppShell>
    </RequireAdmin>
  );
}

function HoursReport() {
  const [start, setStart] = useState(() => toDateInput(startOfMonth(new Date())));
  const [end, setEnd] = useState(() => toDateInput(endOfMonth(new Date())));

  const query = useSWR(["hours", start, end], () =>
    getHoursSummary(fromDateInput(start), fromDateInput(end)),
  );

  const rows = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => b.total_minutes - a.total_minutes),
    [query.data],
  );

  const totals = rows.reduce(
    (acc, r) => ({
      minutes: acc.minutes + r.total_minutes,
      cents: acc.cents + r.total_cents,
      shifts: acc.shifts + Number(r.shifts_count),
    }),
    { minutes: 0, cents: 0, shifts: 0 },
  );

  const chartData = rows.map((r) => ({
    name: r.full_name || "Unnamed",
    hours: toHours(r.total_minutes),
  }));

  const exportCsv = () => {
    downloadBlob(
      `raduler-hours-${start}-to-${end}.csv`,
      new Blob([summaryToCsv(rows)], { type: "text/csv;charset=utf-8" }),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Hours worked</h1>
          <p className="text-sm text-base-content/70">
            Confirmed shifts only, from the same database function that totals an
            invoice — the two cannot disagree.
          </p>
        </div>

        {/* Filters sit in one row above the chart. */}
        <div className="flex flex-wrap items-end gap-2">
          <label className="form-control">
            <span className="label-text mb-1 block text-xs">From</span>
            <input
              type="date"
              className="input input-bordered input-sm"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 block text-xs">To</span>
            <input
              type="date"
              className="input input-bordered input-sm"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const prev = subMonths(fromDateInput(start), 1);
              setStart(toDateInput(startOfMonth(prev)));
              setEnd(toDateInput(endOfMonth(prev)));
            }}
          >
            Previous month
          </button>
          <button
            className="btn btn-outline btn-sm gap-1"
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="People with hours" value={String(rows.length)} loading={query.isLoading} />
        <StatCard label="Shifts covered" value={String(totals.shifts)} loading={query.isLoading} />
        <StatCard label="Total hours" value={formatMinutes(totals.minutes)} loading={query.isLoading} />
        <StatCard label="Total cost" value={formatCents(totals.cents)} loading={query.isLoading} />
      </div>

      <section className="viz-root surface p-4">
        <h2 className="mb-3 text-sm font-medium">Hours per person</h2>
        {query.isLoading ? (
          <div className="flex h-72 items-center justify-center">
            <span className="loading loading-spinner" aria-label="Loading" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No confirmed shifts in this period"
            hint="Hours appear once people claim shifts that start between these dates."
          />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 38 + 40)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
              barCategoryGap="28%"
            >
              {/* Recessive grid: value axis only, so it guides without competing. */}
              <CartesianGrid
                horizontal={false}
                stroke="var(--viz-grid)"
                strokeDasharray="2 4"
              />
              <XAxis
                type="number"
                tick={{ fill: "var(--viz-text)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                unit="h"
              />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={{ fill: "var(--viz-text)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: "var(--viz-grid)" }}
                formatter={(value) => [`${Number(value)} h`, "Hours"]}
                contentStyle={{
                  background: "var(--color-base-100)",
                  border: "1px solid var(--viz-grid)",
                  borderRadius: "0.5rem",
                  fontSize: "0.8125rem",
                }}
              />
              {/* One series, so no legend — the heading names it. Rounded ends on the
                  data end only; the baseline end stays square. */}
              <Bar dataKey="hours" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill="var(--series-1)" />
                ))}
                <LabelList
                  dataKey="hours"
                  position="right"
                  formatter={(v) => `${Number(v)}h`}
                  style={{ fill: "var(--viz-text)", fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <TableView rows={rows} />
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="surface p-4">
      <p className="text-sm text-base-content/60">{label}</p>
      {loading ? (
        <div className="shimmer mt-1.5 h-7 w-20 rounded-field bg-base-300/40" />
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
      )}
    </div>
  );
}

/** The chart's accessible twin — exact figures, and what the CSV mirrors. */
function TableView({ rows }: { rows: HoursSummaryRow[] }) {
  return (
    <div className="surface overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th className="text-right">Shifts</th>
            <th className="text-right">Hours</th>
            <th className="text-right">Earnings</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-base-content/50">
                Nothing to report for this period.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.profile_id} className="border-base-300/40 transition-colors hover:bg-base-300/25">
              <td>{r.full_name || "Unnamed"}</td>
              <td className="text-base-content/70">{r.role}</td>
              <td className="text-right">{r.shifts_count}</td>
              <td className="text-right">{formatMinutes(r.total_minutes)}</td>
              <td className="text-right">{formatCents(r.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
