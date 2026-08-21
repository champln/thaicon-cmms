export type PlanStatus = "draft" | "active" | "completed";
export type ReportStatus = "draft" | "submitted" | "approved" | "rejected";
export type RepairStatus = "draft" | "open" | "in_progress" | "resolved" | "cancelled";

export type MaintenancePlan = {
  id: string;
  jobsiteId: string;
  name: string;
  serviceType: string;
  year: number;
  annualTarget: number;
  cycleMonths: 1 | 2 | 3;
  startMonth: number;
  status: PlanStatus;
  createdBy: string;
  updatedAt: string;
};

export type PlanCycle = {
  id: string;
  planId: string;
  sequence: number;
  label: string;
  startMonth: number;
  endMonth: number;
  target: number;
};

export type ReportAttachment = {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  storagePath?: string;
  fileSize?: number;
};

export type ServiceReport = {
  id: string;
  jobsiteId: string;
  planId: string;
  cycleId: string;
  workOrderId: string | null;
  assetId: string;
  assetName: string;
  serviceDate: string;
  quantity: number;
  technicianName: string;
  customerName: string;
  workPerformed: string;
  findings: string;
  actionTaken: string;
  result: "normal" | "repair_required";
  status: ReportStatus;
  attachments: ReportAttachment[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
};

export type RepairRequest = {
  id: string;
  jobsiteId: string;
  serviceReportId: string | null;
  assetId: string;
  assetName: string;
  requestedDate: string;
  title: string;
  description: string;
  priority: "low" | "normal" | "high" | "critical";
  status: RepairStatus;
  reportedBy: string;
  resolution: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MaintenanceState = {
  plans: MaintenancePlan[];
  serviceReports: ServiceReport[];
  repairRequests: RepairRequest[];
};

export type PlanSummary = {
  plan: MaintenancePlan;
  cycles: Array<PlanCycle & { actual: number; remaining: number; progress: number }>;
  actual: number;
  remaining: number;
  progress: number;
  approvedReports: number;
  pendingReports: number;
};

export type PmDueReminder = {
  id: string;
  planId: string;
  planName: string;
  cycleId: string;
  cycleLabel: string;
  dueDate: string;
  target: number;
  actual: number;
  remaining: number;
  daysUntilDue: number;
  status: "overdue" | "due_soon" | "pending_approval";
};

const STORAGE_KEY = "thaicon-cmms-maintenance-v3";
const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const now = "2026-08-21T09:30:00.000Z";

function svgPhoto(label: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="${color}"/><circle cx="400" cy="210" r="105" fill="#fff" fill-opacity=".18"/><path d="M260 370l105-105 70 68 55-47 90 84z" fill="#fff" fill-opacity=".72"/><text x="400" y="455" text-anchor="middle" font-family="Arial" font-size="34" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().split("-")[0].toUpperCase()
    : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${suffix}`;
}

export function createUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createPlanCycles(plan: MaintenancePlan): PlanCycle[] {
  const count = Math.ceil(12 / plan.cycleMonths);
  const baseTarget = Math.floor(plan.annualTarget / count);
  let allocated = 0;

  return Array.from({ length: count }, (_, index) => {
    const startMonth = ((plan.startMonth - 1 + index * plan.cycleMonths) % 12) + 1;
    const endMonth = ((startMonth - 1 + plan.cycleMonths - 1) % 12) + 1;
    const target = index === count - 1 ? plan.annualTarget - allocated : baseTarget;
    allocated += target;
    const label = plan.cycleMonths === 1
      ? THAI_MONTHS[startMonth - 1]
      : `${THAI_MONTHS[startMonth - 1]} - ${THAI_MONTHS[endMonth - 1]}`;
    return {
      id: `${plan.id}-C${String(index + 1).padStart(2, "0")}`,
      planId: plan.id,
      sequence: index + 1,
      label,
      startMonth,
      endMonth,
      target,
    };
  });
}

export function summarizePlan(plan: MaintenancePlan, reports: ServiceReport[]): PlanSummary {
  const planReports = reports.filter((report) => report.planId === plan.id);
  const approved = planReports.filter((report) => report.status === "approved");
  const cycles = createPlanCycles(plan).map((cycle) => {
    const actual = approved
      .filter((report) => report.cycleId === cycle.id)
      .reduce((total, report) => total + report.quantity, 0);
    return {
      ...cycle,
      actual,
      remaining: Math.max(cycle.target - actual, 0),
      progress: cycle.target > 0 ? Math.round((actual / cycle.target) * 1000) / 10 : 0,
    };
  });
  const actual = approved.reduce((total, report) => total + report.quantity, 0);

  return {
    plan,
    cycles,
    actual,
    remaining: Math.max(plan.annualTarget - actual, 0),
    progress: plan.annualTarget > 0 ? Math.round((actual / plan.annualTarget) * 1000) / 10 : 0,
    approvedReports: approved.length,
    pendingReports: planReports.filter((report) => report.status === "submitted").length,
  };
}

export function getJobsiteSummaries(state: MaintenanceState, jobsiteId: string) {
  return state.plans
    .filter((plan) => plan.jobsiteId === jobsiteId)
    .map((plan) => summarizePlan(plan, state.serviceReports));
}

function cycleDueDate(plan: MaintenancePlan, cycle: PlanCycle) {
  const absoluteEndMonth = plan.startMonth - 1 + ((cycle.sequence - 1) * plan.cycleMonths) + plan.cycleMonths;
  const year = plan.year + Math.floor((absoluteEndMonth - 1) / 12);
  const month = ((absoluteEndMonth - 1) % 12) + 1;
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

export function getPmDueReminders(
  state: MaintenanceState,
  jobsiteId: string,
  referenceDate = new Date().toISOString().slice(0, 10),
): PmDueReminder[] {
  const reference = new Date(`${referenceDate}T00:00:00Z`).getTime();
  const dayMs = 86_400_000;
  const reminders: PmDueReminder[] = [];
  state.plans.filter((plan) => plan.jobsiteId === jobsiteId && plan.status === "active").forEach((plan) => {
    const summary = summarizePlan(plan, state.serviceReports);
    summary.cycles.forEach((cycle) => {
      if (cycle.remaining <= 0) return;
      const dueDate = cycleDueDate(plan, cycle);
      const daysUntilDue = Math.ceil((new Date(`${dueDate}T00:00:00Z`).getTime() - reference) / dayMs);
      const hasPending = state.serviceReports.some((report) => report.cycleId === cycle.id && report.status === "submitted");
      const status: PmDueReminder["status"] | null = hasPending ? "pending_approval" : daysUntilDue < 0 ? "overdue" : daysUntilDue <= 30 ? "due_soon" : null;
      if (!status) return;
      reminders.push({ id: `REM-${cycle.id}`, planId: plan.id, planName: plan.name, cycleId: cycle.id, cycleLabel: cycle.label, dueDate, target: cycle.target, actual: cycle.actual, remaining: cycle.remaining, daysUntilDue, status });
    });
  });
  const rank: Record<PmDueReminder["status"], number> = { overdue: 0, pending_approval: 1, due_soon: 2 };
  return reminders.sort((a, b) => rank[a.status] - rank[b.status] || a.daysUntilDue - b.daysUntilDue);
}

export function buildDemoMaintenanceState(): MaintenanceState {
  const sitePlans: MaintenancePlan[] = [
    ["SITE-001", "PLAN-001", "ล้างและบำรุงรักษาระบบปรับอากาศ", "Cleaning", 1200, 1],
    ["SITE-002", "PLAN-002", "PM เครื่องปรับอากาศทุก 2 เดือน", "Preventive Maintenance", 180, 2],
    ["SITE-003", "PLAN-003", "ตรวจสอบตู้แช่ยาและ Sensor", "Calibration", 120, 1],
    ["SITE-004", "PLAN-004", "PM Control Panel รายไตรมาส", "Preventive Maintenance", 80, 3],
    ["SITE-005", "PLAN-005", "บำรุงรักษาระบบ AHU", "Preventive Maintenance", 240, 1],
    ["SITE-006", "PLAN-006", "ตรวจสอบ Exhaust Fan รายไตรมาส", "Inspection", 48, 3],
  ].map(([jobsiteId, id, name, serviceType, annualTarget, cycleMonths]) => ({
    id: String(id),
    jobsiteId: String(jobsiteId),
    name: String(name),
    serviceType: String(serviceType),
    year: 2026,
    annualTarget: Number(annualTarget),
    cycleMonths: Number(cycleMonths) as 1 | 2 | 3,
    startMonth: 1,
    status: "active" as const,
    createdBy: "admin-demo",
    updatedAt: now,
  }));

  const reports: ServiceReport[] = [];
  sitePlans.forEach((plan, planIndex) => {
    const cycles = createPlanCycles(plan);
    cycles.slice(0, Math.min(7, cycles.length)).forEach((cycle, cycleIndex) => {
      const baseQuantity = Math.max(1, Math.round(cycle.target * (cycleIndex < 6 ? 0.88 : 0.42)));
      reports.push({
        id: `SR-${plan.id.slice(-3)}-${String(cycleIndex + 1).padStart(3, "0")}`,
        jobsiteId: plan.jobsiteId,
        planId: plan.id,
        cycleId: cycle.id,
        workOrderId: cycleIndex === 6 ? "WO-2607-0147" : null,
        assetId: ["AHU-OPD-01", "CR-DP-02", "FREEZER-PH-03", "CTRL-LAB-05", "AHU-ICU-04", "EXF-ER-06"][planIndex],
        assetName: plan.name,
        serviceDate: `2026-${String(Math.min(cycle.startMonth, 8)).padStart(2, "0")}-${String(8 + cycleIndex).padStart(2, "0")}`,
        quantity: baseQuantity,
        technicianName: "อนุชา วิศวกร",
        customerName: "ผู้แทนหน่วยงานลูกค้า",
        workPerformed: `ดำเนินงาน ${plan.name} ตามรายการตรวจสอบมาตรฐาน`,
        findings: cycleIndex === 6 ? "พบเสียงผิดปกติบริเวณมอเตอร์พัดลม" : "ระบบทำงานอยู่ในเกณฑ์ปกติ",
        actionTaken: cycleIndex === 6 ? "ทำความสะอาดและบันทึกเพื่อเปิดใบแจ้งซ่อม" : "ทำความสะอาด ตรวจวัด และทดสอบการทำงาน",
        result: cycleIndex === 6 ? "repair_required" : "normal",
        status: cycleIndex === 6 ? "submitted" : "approved",
        attachments: [{
          id: `ATT-${planIndex}-${cycleIndex}`,
          name: "ภาพหลังปฏิบัติงาน.svg",
          type: "image/svg+xml",
          dataUrl: svgPhoto(`${plan.id} / ${cycle.label}`, planIndex % 2 === 0 ? "#1262a3" : "#178a78"),
        }],
        createdBy: "engineer-demo",
        createdAt: now,
        updatedAt: now,
        approvedBy: cycleIndex === 6 ? null : "admin-demo",
        approvedAt: cycleIndex === 6 ? null : now,
        rejectionReason: null,
      });
    });
  });

  return {
    plans: sitePlans,
    serviceReports: reports,
    repairRequests: [{
      id: "RR-0001",
      jobsiteId: "SITE-001",
      serviceReportId: null,
      assetId: "AHU-OPD-01",
      assetName: "Air Handling Unit - OPD",
      requestedDate: "2026-08-18",
      title: "ตรวจสอบเสียงมอเตอร์พัดลมผิดปกติ",
      description: "พบเสียงสั่นขณะเดินเครื่อง ต้องตรวจ Bearing และ Alignment",
      priority: "high",
      status: "open",
      reportedBy: "อนุชา วิศวกร",
      resolution: "",
      createdBy: "engineer-demo",
      createdAt: now,
      updatedAt: now,
    }],
  };
}

export function loadMaintenanceState(): MaintenanceState {
  if (typeof window === "undefined") return buildDemoMaintenanceState();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return buildDemoMaintenanceState();
    const parsed = JSON.parse(stored) as MaintenanceState;
    if (!Array.isArray(parsed.plans) || !Array.isArray(parsed.serviceReports) || !Array.isArray(parsed.repairRequests)) {
      return buildDemoMaintenanceState();
    }
    return parsed;
  } catch {
    return buildDemoMaintenanceState();
  }
}

export function saveMaintenanceState(state: MaintenanceState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to persist maintenance demo data", error);
  }
}

export function resetMaintenanceState() {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
}

export function reportStatusLabel(status: ReportStatus) {
  return {
    draft: "ฉบับร่าง",
    submitted: "รออนุมัติ",
    approved: "อนุมัติแล้ว",
    rejected: "ส่งกลับแก้ไข",
  }[status];
}

export function repairStatusLabel(status: RepairStatus) {
  return {
    draft: "ฉบับร่าง",
    open: "รอดำเนินการ",
    in_progress: "กำลังซ่อม",
    resolved: "แก้ไขแล้ว",
    cancelled: "ยกเลิก",
  }[status];
}

export function formatThaiDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}
