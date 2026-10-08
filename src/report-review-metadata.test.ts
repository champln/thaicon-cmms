import { describe, it, expect } from "vitest";
import { reportReviewMetadata } from "./report-review-metadata";
import type { ServiceReport } from "./maintenance";
describe("stored report review evidence", () => {
  it("does not invent legacy evidence", () => {
    expect(reportReviewMetadata({} as ServiceReport)).toEqual([]);
  });
  it("preserves exact return reason and actual version", () => {
    expect(reportReviewMetadata({ version: 3, rejectionReason: "เพิ่มรายละเอียดและรูป\nตรวจมอเตอร์" } as ServiceReport)).toEqual([
      { label: "เวอร์ชันรายงาน", value: "3" }, { label: "เหตุผลส่งกลับแก้ไข", value: "เพิ่มรายละเอียดและรูป\nตรวจมอเตอร์" },
    ]);
  });
  it("uses stored reviewer ID/time without fabricating a name", () => {
    expect(reportReviewMetadata({ approvedBy: "actor-uuid", approvedAt: "2026-10-06T01:00:00Z" } as ServiceReport)).toEqual([
      { label: "รหัสผู้อนุมัติ", value: "actor-uuid" }, { label: "เวลาอนุมัติ", value: "2026-10-06T01:00:00Z" },
    ]);
  });
});
