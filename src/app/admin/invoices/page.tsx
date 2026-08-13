"use client";

import { useState } from "react";
import useSWR from "swr";
import { format, endOfMonth, startOfMonth, subMonths } from "date-fns";
import { FileDown, Trash2 } from "lucide-react";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AppShell } from "@/components/AppShell";
import {
  createInvoice,
  deleteInvoice,
  listInvoices,
  setInvoiceStatus,
  type InvoiceWithDetail,
} from "@/lib/repositories/invoices";
import { listProfiles } from "@/lib/repositories/teams";
import { buildInvoicePdf } from "@/lib/pdf/invoice";
import { downloadBlob } from "@/lib/download";
import { formatCents, formatMinutes, fromDateInput, toDateInput } from "@/lib/format";
import type { InvoiceStatus } from "@/types/db";

// Placeholder letterhead for the prototype — swap for the practice's real details.
const ISSUER = {
  practiceName: "Radiology Group",
  addressLines: ["123 Example Avenue", "Toronto, ON", "billing@yourpractice.com"],
};

export default function AdminInvoicesPage() {
  return (
    <RequireAdmin>
      <AppShell>
        <Invoices />
      </AppShell>
    </RequireAdmin>
  );
}

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "badge-ghost",
  sent: "badge-info",
  paid: "badge-success",
};

function Invoices() {
  const invoicesQuery = useSWR("invoices", listInvoices);
  const peopleQuery = useSWR("profiles", listProfiles);

  const lastMonth = subMonths(new Date(), 1);
  const [profileId, setProfileId] = useState("");
  const [start, setStart] = useState(() => toDateInput(startOfMonth(lastMonth)));
  const [end, setEnd] = useState(() => toDateInput(endOfMonth(lastMonth)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!profileId) return;
    setBusy(true);
    setError(null);
    try {
      await createInvoice(profileId, fromDateInput(start), fromDateInput(end));
      await invoicesQuery.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate that invoice.");
    } finally {
      setBusy(false);
    }
  };

  const download = (invoice: InvoiceWithDetail) => {
    downloadBlob(`${invoice.number}.pdf`, buildInvoicePdf(invoice, ISSUER));
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await invoicesQuery.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change did not go through.");
    }
  };

  const invoices = invoicesQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
        <p className="text-sm text-base-content/70">
          Pick a person and a period; the database totals their confirmed shifts and
          writes the line items. The PDF is rendered here in the browser — no amount is
          ever supplied by this page.
        </p>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body flex-row flex-wrap items-end gap-3">
          <label className="form-control">
            <span className="label-text mb-1 block text-xs">Person</span>
            <select
              className="select select-bordered select-sm w-64"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">Choose someone…</option>
              {(peopleQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email} ({p.role})
                </option>
              ))}
            </select>
          </label>
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
            className="btn btn-primary btn-sm"
            disabled={!profileId || busy}
            onClick={() => void generate()}
          >
            {busy ? "Generating…" : "Generate invoice"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="alert alert-error">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-box bg-base-100 shadow-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Person</th>
              <th>Period</th>
              <th className="text-right">Hours</th>
              <th className="text-right">Total</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoicesQuery.isLoading && (
              <tr>
                <td colSpan={7} className="py-8 text-center">
                  <span className="loading loading-spinner" aria-label="Loading" />
                </td>
              </tr>
            )}
            {!invoicesQuery.isLoading && invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-base-content/60">
                  No invoices yet.
                </td>
              </tr>
            )}
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="font-mono text-xs">{invoice.number}</td>
                <td>{invoice.profiles?.full_name || invoice.profiles?.email || "—"}</td>
                <td className="whitespace-nowrap text-base-content/70">
                  {format(fromDateInput(invoice.period_start), "d MMM")} –{" "}
                  {format(fromDateInput(invoice.period_end), "d MMM yyyy")}
                </td>
                <td className="text-right">{formatMinutes(invoice.total_minutes)}</td>
                <td className="text-right">{formatCents(invoice.total_cents)}</td>
                <td>
                  <select
                    className={`badge ${STATUS_BADGE[invoice.status]} badge-sm border-0`}
                    aria-label={`Status for ${invoice.number}`}
                    value={invoice.status}
                    onChange={(e) =>
                      void run(() =>
                        setInvoiceStatus(invoice.id, e.target.value as InvoiceStatus),
                      )
                    }
                  >
                    <option value="draft">draft</option>
                    <option value="sent">sent</option>
                    <option value="paid">paid</option>
                  </select>
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={() => download(invoice)}
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      PDF
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      aria-label={`Delete ${invoice.number}`}
                      onClick={() => void run(() => deleteInvoice(invoice.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
