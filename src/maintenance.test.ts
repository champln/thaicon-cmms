import { describe, expect, it } from "vitest";
import {
  buildDemoMaintenanceState,
  createPlanCycles,
  getPmDueReminders,
  summarizePlan,
} from "./maintenance";
import type { MaintenancePlan, ServiceReport } from "./maintenance";

const plan: MaintenancePlan = {
  id: "PLAN-TEST",
  jobsiteId: "SITE-001",
  name: "แผนทดสอบ",
  serviceType: "PM",
  year: 2026,
  annualTarget: 1200,
  cycleMonths: 1,
  startMonth: 1,
  status: "active",
  createdBy: "admin-demo",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function report(status: ServiceReport["status"], quantity: number, cycleId: string): ServiceReport {
  return {
    id: `SR-${status}-${quantity}`,
    jobsiteId: plan.jobsiteId,
    planId: plan.id,
    cycleId,
    workOrderId: null,
    assetId: "AHU-001",
    assetName: "AHU",
    serviceDate: "2026-01-15",
    quantity,
    technicianName: "ช่างทดสอบ",
    customerName: "ผู้ตรวจรับ",
    workPerformed: "PM",
    findings: "ปกติ",
    actionTaken: "ตรวจสอบแล้ว",
    result: "normal",
    status,
    attachments: [],
    createdBy: "engineer-demo",
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    approvedBy: status === "approved" ? "admin-demo" : null,
    approvedAt: status === "approved" ? "2026-01-16T00:00:00.000Z" : null,
    rejectionReason: null,
  };
}

describe("maintenance plan cycles", () => {
  it("splits an annual monthly target into twelve equal cycles", () => {
    const cycles = createPlanCycles(plan);
    expect(cycles).toHaveLength(12);
    expect(cycles.every((cycle) => cycle.target === 100)).toBe(true);
    expect(cycles.reduce((total, cycle) => total + cycle.target, 0)).toBe(1200);
  });

  it("keeps the annual target exact when it does not divide evenly", () => {
    const cycles = createPlanCycles({ ...plan, annualTarget: 100, cycleMonths: 3 });
    expect(cycles).toHaveLength(4);
    expect(cycles.reduce((total, cycle) => total + cycle.target, 0)).toBe(100);
  });
});

describe("plan actual calculation", () => {
  it("counts only approved Service Reports", () => {
    const firstCycle = createPlanCycles(plan)[0];
    const summary = summarizePlan(plan, [
      report("approved", 60, firstCycle.id),
      report("submitted", 30, firstCycle.id),
      report("draft", 10, firstCycle.id),
      report("rejected", 5, firstCycle.id),
    ]);

    expect(summary.actual).toBe(60);
    expect(summary.remaining).toBe(1140);
    expect(summary.cycles[0].actual).toBe(60);
    expect(summary.cycles[0].remaining).toBe(40);
    expect(summary.pendingReports).toBe(1);
  });

  it("ships demo records for every functional workflow", () => {
    const state = buildDemoMaintenanceState();
    expect(state.plans.length).toBeGreaterThanOrEqual(6);
    expect(state.serviceReports.some((item) => item.status === "approved")).toBe(true);
    expect(state.serviceReports.some((item) => item.status === "submitted")).toBe(true);
    expect(state.serviceReports.every((item) => item.attachments.length > 0)).toBe(true);
    expect(state.repairRequests.length).toBeGreaterThan(0);
  });
});

describe("PM due reminders", () => {
  it("flags an incomplete past cycle as overdue", () => {
    const state = { plans: [plan], serviceReports: [], repairRequests: [] };
    const reminders = getPmDueReminders(state, "SITE-001", "2026-02-10");
    expect(reminders[0]).toMatchObject({ cycleId: "PLAN-TEST-C01", status: "overdue", remaining: 100 });
  });

  it("prioritizes a submitted Service Report for approval", () => {
    const firstCycle = createPlanCycles(plan)[0];
    const state = { plans: [plan], serviceReports: [report("submitted", 60, firstCycle.id)], repairRequests: [] };
    const reminders = getPmDueReminders(state, "SITE-001", "2026-02-10");
    expect(reminders[0].status).toBe("pending_approval");
  });
});
