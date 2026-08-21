import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type {
  MaintenancePlan,
  MaintenanceState,
  RepairRequest,
  ReportAttachment,
  ServiceReport,
} from "./maintenance";

const PHOTO_BUCKET = "service-report-photos";

function requireClient(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

function safeFileName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "photo";
}

function mapPlan(row: Record<string, unknown>): MaintenancePlan {
  return {
    id: String(row.id), jobsiteId: String(row.jobsite_id), name: String(row.name), serviceType: String(row.service_type),
    year: Number(row.plan_year), annualTarget: Number(row.annual_target), cycleMonths: Number(row.cycle_months) as 1 | 2 | 3,
    startMonth: Number(row.start_month), status: row.status as MaintenancePlan["status"], createdBy: String(row.created_by),
    updatedAt: String(row.updated_at),
  };
}

function mapReport(row: Record<string, unknown>, attachments: ReportAttachment[]): ServiceReport {
  return {
    id: String(row.id), jobsiteId: String(row.jobsite_id), planId: String(row.plan_id), cycleId: String(row.cycle_id),
    workOrderId: row.work_order_id ? String(row.work_order_id) : null, assetId: String(row.asset_id), assetName: String(row.asset_name),
    serviceDate: String(row.service_date), quantity: Number(row.quantity), technicianName: String(row.technician_name),
    customerName: String(row.customer_name), workPerformed: String(row.work_performed), findings: String(row.findings),
    actionTaken: String(row.action_taken), result: row.result as ServiceReport["result"], status: row.status as ServiceReport["status"],
    attachments, createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    approvedBy: row.approved_by ? String(row.approved_by) : null, approvedAt: row.approved_at ? String(row.approved_at) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
  };
}

function mapRepair(row: Record<string, unknown>): RepairRequest {
  return {
    id: String(row.id), jobsiteId: String(row.jobsite_id), serviceReportId: row.service_report_id ? String(row.service_report_id) : null,
    assetId: String(row.asset_id), assetName: String(row.asset_name), requestedDate: String(row.requested_date), title: String(row.title),
    description: String(row.description), priority: row.priority as RepairRequest["priority"], status: row.status as RepairRequest["status"],
    reportedBy: String(row.reported_by), resolution: String(row.resolution ?? ""), createdBy: String(row.created_by),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export async function loadSupabaseMaintenanceState(jobsiteIds: string[]): Promise<MaintenanceState> {
  const client = requireClient();
  if (!jobsiteIds.length) return { plans: [], serviceReports: [], repairRequests: [] };
  const [plansResult, reportsResult, repairsResult] = await Promise.all([
    client.from("maintenance_plans").select("*").in("jobsite_id", jobsiteIds).order("plan_year", { ascending: false }),
    client.from("service_reports").select("*").in("jobsite_id", jobsiteIds).order("service_date", { ascending: false }),
    client.from("repair_requests").select("*").in("jobsite_id", jobsiteIds).order("requested_date", { ascending: false }),
  ]);
  if (plansResult.error) throw plansResult.error;
  if (reportsResult.error) throw reportsResult.error;
  if (repairsResult.error) throw repairsResult.error;

  const reportIds = (reportsResult.data ?? []).map((row) => String(row.id));
  const attachmentRows = reportIds.length
    ? await client.from("service_report_attachments").select("*").in("service_report_id", reportIds)
    : { data: [], error: null };
  if (attachmentRows.error) throw attachmentRows.error;

  const attachmentsByReport = new Map<string, ReportAttachment[]>();
  await Promise.all((attachmentRows.data ?? []).map(async (row) => {
    const storagePath = String(row.storage_path);
    const signed = await client.storage.from(PHOTO_BUCKET).createSignedUrl(storagePath, 3600);
    if (signed.error) throw signed.error;
    const attachment: ReportAttachment = {
      id: String(row.id), name: String(row.file_name), type: String(row.content_type), dataUrl: signed.data.signedUrl,
      storagePath, fileSize: Number(row.file_size),
    };
    const reportId = String(row.service_report_id);
    attachmentsByReport.set(reportId, [...(attachmentsByReport.get(reportId) ?? []), attachment]);
  }));

  return {
    plans: (plansResult.data ?? []).map((row) => mapPlan(row)),
    serviceReports: (reportsResult.data ?? []).map((row) => mapReport(row, attachmentsByReport.get(String(row.id)) ?? [])),
    repairRequests: (repairsResult.data ?? []).map((row) => mapRepair(row)),
  };
}

function changedByUpdatedAt<T extends { id: string; updatedAt: string }>(before: T[], after: T[]) {
  const previous = new Map(before.map((item) => [item.id, item.updatedAt]));
  return after.filter((item) => previous.get(item.id) !== item.updatedAt);
}

function removedIds<T extends { id: string }>(before: T[], after: T[]) {
  const currentIds = new Set(after.map((item) => item.id));
  return before.filter((item) => !currentIds.has(item.id)).map((item) => item.id);
}

async function uploadNewAttachments(client: SupabaseClient, reports: ServiceReport[], userId: string) {
  for (const report of reports) {
    for (const attachment of report.attachments.filter((item) => !item.storagePath)) {
      const response = await fetch(attachment.dataUrl);
      const blob = await response.blob();
      const storagePath = `${report.jobsiteId}/${report.id}/${attachment.id}-${safeFileName(attachment.name)}`;
      const upload = await client.storage.from(PHOTO_BUCKET).upload(storagePath, blob, { contentType: attachment.type, upsert: true });
      if (upload.error) throw upload.error;
      const metadata = await client.from("service_report_attachments").upsert({
        id: attachment.id, service_report_id: report.id, storage_path: storagePath, file_name: attachment.name,
        content_type: attachment.type || blob.type || "image/jpeg", file_size: blob.size, uploaded_by: userId,
      });
      if (metadata.error) throw metadata.error;
      attachment.storagePath = storagePath;
      attachment.fileSize = blob.size;
    }
  }
}

export async function syncSupabaseMaintenanceState(previous: MaintenanceState, current: MaintenanceState, userId: string) {
  const client = requireClient();
  const changedPlans = changedByUpdatedAt(previous.plans, current.plans);
  const changedReports = changedByUpdatedAt(previous.serviceReports, current.serviceReports);
  const changedRepairs = changedByUpdatedAt(previous.repairRequests, current.repairRequests);
  const currentAttachmentIds = new Set(current.serviceReports.flatMap((report) => report.attachments.map((attachment) => attachment.id)));
  const removedAttachments = previous.serviceReports
    .flatMap((report) => report.attachments)
    .filter((attachment) => !currentAttachmentIds.has(attachment.id));

  if (changedPlans.length) {
    const result = await client.from("maintenance_plans").upsert(changedPlans.map((plan) => ({
      id: plan.id, jobsite_id: plan.jobsiteId, name: plan.name, service_type: plan.serviceType, plan_year: plan.year,
      annual_target: plan.annualTarget, cycle_months: plan.cycleMonths, start_month: plan.startMonth, status: plan.status,
      created_by: plan.createdBy,
    })));
    if (result.error) throw result.error;
  }

  if (changedReports.length) {
    const result = await client.from("service_reports").upsert(changedReports.map((report) => ({
      id: report.id, jobsite_id: report.jobsiteId, plan_id: report.planId, cycle_id: report.cycleId,
      work_order_id: report.workOrderId, asset_id: report.assetId, asset_name: report.assetName, service_date: report.serviceDate,
      quantity: report.quantity, technician_name: report.technicianName, customer_name: report.customerName,
      work_performed: report.workPerformed, findings: report.findings, action_taken: report.actionTaken,
      result: report.result, status: report.status, created_by: report.createdBy, rejection_reason: report.rejectionReason,
    })));
    if (result.error) throw result.error;
    await uploadNewAttachments(client, changedReports, userId);
  }

  if (changedRepairs.length) {
    const result = await client.from("repair_requests").upsert(changedRepairs.map((request) => ({
      id: request.id, jobsite_id: request.jobsiteId, service_report_id: request.serviceReportId, asset_id: request.assetId,
      asset_name: request.assetName, requested_date: request.requestedDate, title: request.title, description: request.description,
      priority: request.priority, status: request.status, reported_by: request.reportedBy, resolution: request.resolution,
      created_by: request.createdBy,
    })));
    if (result.error) throw result.error;
  }

  const removedStoragePaths = removedAttachments.flatMap((attachment) => attachment.storagePath ? [attachment.storagePath] : []);
  if (removedStoragePaths.length) {
    const storageResult = await client.storage.from(PHOTO_BUCKET).remove(removedStoragePaths);
    if (storageResult.error) throw storageResult.error;
  }
  if (removedAttachments.length) {
    const metadataResult = await client.from("service_report_attachments").delete().in("id", removedAttachments.map((attachment) => attachment.id));
    if (metadataResult.error) throw metadataResult.error;
  }

  const removedReports = removedIds(previous.serviceReports, current.serviceReports);
  const removedRepairs = removedIds(previous.repairRequests, current.repairRequests);
  const removedPlans = removedIds(previous.plans, current.plans);
  if (removedReports.length) {
    const result = await client.from("service_reports").delete().in("id", removedReports);
    if (result.error) throw result.error;
  }
  if (removedRepairs.length) {
    const result = await client.from("repair_requests").delete().in("id", removedRepairs);
    if (result.error) throw result.error;
  }
  if (removedPlans.length) {
    const result = await client.from("maintenance_plans").delete().in("id", removedPlans);
    if (result.error) throw result.error;
  }
}
