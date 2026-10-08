import type { ServiceReport } from "./maintenance";

// Display only stored evidence; never infer a reviewer, timestamp or reason.
export function reportReviewMetadata(report: ServiceReport): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (report.version !== undefined) rows.push({ label: "เวอร์ชันรายงาน", value: String(report.version) });
  if (report.rejectionReason) rows.push({ label: "เหตุผลส่งกลับแก้ไข", value: report.rejectionReason });
  if (report.approvedBy) rows.push({ label: "รหัสผู้อนุมัติ", value: report.approvedBy });
  if (report.approvedAt) rows.push({ label: "เวลาอนุมัติ", value: report.approvedAt });
  return rows;
}
