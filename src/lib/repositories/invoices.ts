import { getSupabase } from "@/lib/supabase/client";
import type { Invoice, InvoiceLine, InvoiceStatus, Profile } from "@/types/db";
import { toDateInput } from "@/lib/format";

export interface InvoiceWithDetail extends Invoice {
  invoice_lines: InvoiceLine[];
  profiles: Pick<Profile, "full_name" | "email" | "role"> | null;
}

export async function listInvoices(): Promise<InvoiceWithDetail[]> {
  const { data, error } = await getSupabase()
    .from("invoices")
    .select("*, invoice_lines(*), profiles(full_name, email, role)")
    .order("issued_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceWithDetail[];
}

/**
 * The RPC totals the invoice from the assignment records itself. Nothing about the
 * amount is supplied by this page — an admin picks a person and a period, and the
 * database decides what that is worth.
 */
export async function createInvoice(
  profileId: string,
  start: Date,
  end: Date,
): Promise<Invoice> {
  const { data, error } = await getSupabase().rpc("create_invoice", {
    p_profile_id: profileId,
    p_start: toDateInput(start),
    p_end: toDateInput(end),
  });
  if (error) throw new Error(error.message);
  return data as Invoice;
}

export async function setInvoiceStatus(
  id: string,
  status: InvoiceStatus,
): Promise<void> {
  const { error } = await getSupabase()
    .from("invoices")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteInvoice(id: string): Promise<void> {
  const { error } = await getSupabase().from("invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
