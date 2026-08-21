import { useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { DemoUser, Jobsite } from "./access";
import {
  createId,
  createUuid,
  createPlanCycles,
  formatThaiDate,
  getJobsiteSummaries,
  getPmDueReminders,
  repairStatusLabel,
  reportStatusLabel,
  summarizePlan,
} from "./maintenance";
import type {
  MaintenancePlan,
  MaintenanceState,
  PlanSummary,
  RepairRequest,
  ReportAttachment,
  RepairStatus,
  ServiceReport,
} from "./maintenance";
import { downloadMaintenancePdf } from "./pdf-export";
import "./maintenance.css";

export type MaintenanceAsset = {
  id: string;
  name: string;
};

type WorkspaceProps = {
  activeJobsite: Jobsite;
  currentUser: DemoUser;
  assets: MaintenanceAsset[];
  state: MaintenanceState;
  setState: Dispatch<SetStateAction<MaintenanceState>>;
  onToast: (message: string) => void;
  onReportApproved?: (report: ServiceReport) => void;
};

const statusTone = {
  draft: "neutral",
  submitted: "pending",
  approved: "success",
  rejected: "danger",
  open: "danger",
  in_progress: "pending",
  resolved: "success",
  cancelled: "neutral",
} as const;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="maint-progress" aria-label={`ความคืบหน้า ${value}%`}>
      <i><span style={{ width: `${Math.min(value, 100)}%` }} /></i>
      <strong>{value}%</strong>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="maint-empty"><strong>{title}</strong><span>{detail}</span></div>;
}

export function PlanProgressOverview({
  state,
  jobsiteId,
  onOpenPlans,
}: {
  state: MaintenanceState;
  jobsiteId: string;
  onOpenPlans: () => void;
}) {
  const summaries = getJobsiteSummaries(state, jobsiteId).filter((item) => item.plan.status !== "draft");
  const target = summaries.reduce((total, item) => total + item.plan.annualTarget, 0);
  const actual = summaries.reduce((total, item) => total + item.actual, 0);
  const remaining = Math.max(target - actual, 0);
  const progress = target ? Math.round((actual / target) * 1000) / 10 : 0;
  const pending = summaries.reduce((total, item) => total + item.pendingReports, 0);

  return (
    <section className="maint-overview-panel">
      <div className="maint-overview-heading">
        <div><span>PLAN VS ACTUAL</span><h3>ความคืบหน้าแผนงานปี 2569</h3></div>
        <button type="button" onClick={onOpenPlans}>ดูรายละเอียดแผน</button>
      </div>
      {summaries.length ? (
        <div className="maint-overview-body">
          <div className="maint-overview-score">
            <strong>{progress}%</strong>
            <span>ความคืบหน้ารวม</span>
            <i><span style={{ width: `${Math.min(progress, 100)}%` }} /></i>
          </div>
          <div className="maint-overview-metrics">
            <div><span>เป้าหมาย</span><strong>{target.toLocaleString("th-TH")}</strong><small>ครั้ง / ปี</small></div>
            <div><span>ทำแล้ว</span><strong>{actual.toLocaleString("th-TH")}</strong><small>จากรายงานที่อนุมัติ</small></div>
            <div><span>คงเหลือ</span><strong>{remaining.toLocaleString("th-TH")}</strong><small>ครั้ง</small></div>
            <div><span>รออนุมัติ</span><strong>{pending}</strong><small>Service Report</small></div>
          </div>
        </div>
      ) : <EmptyState title="ยังไม่มีแผนงาน" detail="ผู้ดูแลระบบสามารถสร้างแผนงานประจำปีได้จากหน้าแผน PM" />}
    </section>
  );
}

export function PmDueReminderPanel({ state, jobsiteId, onOpenReports }: { state: MaintenanceState; jobsiteId: string; onOpenReports: () => void }) {
  const reminders = getPmDueReminders(state, jobsiteId);
  if (!reminders.length) return null;
  const overdue = reminders.filter((item) => item.status === "overdue").length;
  const pending = reminders.filter((item) => item.status === "pending_approval").length;
  return <section className="maint-reminder-panel"><header><div><span>PM FOLLOW-UP</span><h3>งานที่ต้องติดตาม</h3><p>เกินกำหนด {overdue} รอบ • รออนุมัติ {pending} รอบ</p></div><button type="button" onClick={onOpenReports}>เปิด Service Report</button></header><div className="maint-reminder-list">{reminders.slice(0, 4).map((item) => <article key={item.id}><span className={`maint-reminder-tone ${item.status}`} /> <div><strong>{item.planName}</strong><small>{item.cycleLabel} • ครบกำหนด {formatThaiDate(item.dueDate)}</small></div><p><strong>{item.actual} / {item.target}</strong><small>เหลือ {item.remaining} ครั้ง</small></p><em className={item.status}>{item.status === "overdue" ? `เกิน ${Math.abs(item.daysUntilDue)} วัน` : item.status === "pending_approval" ? "รออนุมัติรายงาน" : `อีก ${item.daysUntilDue} วัน`}</em></article>)}</div></section>;
}

function PlanForm({
  currentUser,
  jobsiteId,
  initialPlan,
  onClose,
  onSave,
}: {
  currentUser: DemoUser;
  jobsiteId: string;
  initialPlan: MaintenancePlan | null;
  onClose: () => void;
  onSave: (plan: MaintenancePlan) => void;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const timestamp = new Date().toISOString();
    onSave({
      id: initialPlan?.id ?? createId("PLAN"),
      jobsiteId,
      name: String(form.get("name")),
      serviceType: String(form.get("serviceType")),
      year: Number(form.get("year")),
      annualTarget: Number(form.get("annualTarget")),
      cycleMonths: Number(form.get("cycleMonths")) as 1 | 2 | 3,
      startMonth: Number(form.get("startMonth")),
      status: form.get("status") as MaintenancePlan["status"],
      createdBy: initialPlan?.createdBy ?? currentUser.id,
      updatedAt: timestamp,
    });
  };

  return (
    <div className="maint-modal-backdrop" onMouseDown={onClose}>
      <section className="maint-modal" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <div className="maint-modal-heading">
          <div><span>ANNUAL MAINTENANCE PLAN</span><h2>{initialPlan ? "แก้ไขแผนงาน" : "สร้างแผนงานประจำปี"}</h2><p>ระบบจะแบ่งเป้าหมายเป็นรอบให้อัตโนมัติ</p></div>
          <button type="button" onClick={onClose} aria-label="ปิด">×</button>
        </div>
        <form onSubmit={handleSubmit} className="maint-form">
          <label className="wide">ชื่อแผนงาน<input name="name" required defaultValue={initialPlan?.name} placeholder="เช่น ล้างและบำรุงรักษาระบบปรับอากาศ" /></label>
          <label>ประเภทบริการ<input name="serviceType" required defaultValue={initialPlan?.serviceType ?? "Preventive Maintenance"} /></label>
          <label>ปีแผนงาน<input name="year" type="number" min="2024" max="2100" required defaultValue={initialPlan?.year ?? 2026} /></label>
          <label>เป้าหมายทั้งปี (ครั้ง)<input name="annualTarget" type="number" min="1" required defaultValue={initialPlan?.annualTarget ?? 1200} /></label>
          <label>รอบส่งงาน<select name="cycleMonths" defaultValue={initialPlan?.cycleMonths ?? 1}><option value="1">ทุก 1 เดือน</option><option value="2">ทุก 2 เดือน</option><option value="3">ทุก 3 เดือน</option></select></label>
          <label>เดือนเริ่มต้น<select name="startMonth" defaultValue={initialPlan?.startMonth ?? 1}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>เดือน {index + 1}</option>)}</select></label>
          <label>สถานะ<select name="status" defaultValue={initialPlan?.status ?? "active"}><option value="draft">ฉบับร่าง</option><option value="active">ใช้งาน</option><option value="completed">ปิดแผน</option></select></label>
          <div className="maint-form-actions wide"><button className="maint-button secondary" type="button" onClick={onClose}>ยกเลิก</button><button className="maint-button primary" type="submit">บันทึกแผนงาน</button></div>
        </form>
      </section>
    </div>
  );
}

export function MaintenancePlansPage(props: WorkspaceProps) {
  const { activeJobsite, currentUser, state, setState, onToast } = props;
  const plans = state.plans.filter((plan) => plan.jobsiteId === activeJobsite.id);
  const [selectedId, setSelectedId] = useState(plans[0]?.id ?? "");
  const [editing, setEditing] = useState<MaintenancePlan | "new" | null>(null);
  const selected = plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null;
  const summary = selected ? summarizePlan(selected, state.serviceReports) : null;
  const canManage = currentUser.role === "admin";

  const savePlan = (plan: MaintenancePlan) => {
    setState((current) => ({
      ...current,
      plans: current.plans.some((item) => item.id === plan.id)
        ? current.plans.map((item) => item.id === plan.id ? plan : item)
        : [plan, ...current.plans],
    }));
    setSelectedId(plan.id);
    setEditing(null);
    onToast(`บันทึกแผน ${plan.id} แล้ว`);
  };

  const deletePlan = (plan: MaintenancePlan) => {
    const hasReports = state.serviceReports.some((report) => report.planId === plan.id);
    if (hasReports) {
      onToast("ลบแผนไม่ได้ เนื่องจากมี Service Report อ้างอิงอยู่");
      return;
    }
    if (!window.confirm(`ลบแผน ${plan.name} ใช่หรือไม่`)) return;
    setState((current) => ({ ...current, plans: current.plans.filter((item) => item.id !== plan.id) }));
    setSelectedId("");
    onToast("ลบแผนงานแล้ว");
  };

  return (
    <div className="maint-page">
      <section className="maint-page-toolbar">
        <div><span>ANNUAL PLAN</span><h2>แผนงานประจำปี</h2><p>เปรียบเทียบเป้าหมายกับ Service Report ที่อนุมัติแล้ว</p></div>
        {canManage && <button className="maint-button primary" type="button" onClick={() => setEditing("new")}>+ สร้างแผนงาน</button>}
      </section>

      {plans.length ? (
        <>
          <div className="maint-plan-selector">
            {plans.map((plan) => (
              <button className={selected?.id === plan.id ? "active" : ""} key={plan.id} type="button" onClick={() => setSelectedId(plan.id)}>
                <span>{plan.id}</span><strong>{plan.name}</strong><small>{plan.year + 543} • ทุก {plan.cycleMonths} เดือน</small>
              </button>
            ))}
          </div>
          {summary && (
            <>
              <section className="maint-plan-summary">
                <div className="maint-plan-summary-title"><span className={`maint-chip ${summary.plan.status}`}>{summary.plan.status === "active" ? "ใช้งาน" : summary.plan.status === "draft" ? "ฉบับร่าง" : "ปิดแผน"}</span><h3>{summary.plan.name}</h3><p>{summary.plan.serviceType} • {activeJobsite.name}</p></div>
                <div><span>เป้าหมายทั้งปี</span><strong>{summary.plan.annualTarget.toLocaleString("th-TH")}</strong><small>ครั้ง</small></div>
                <div><span>ทำแล้ว</span><strong>{summary.actual.toLocaleString("th-TH")}</strong><small>ครั้ง</small></div>
                <div><span>คงเหลือ</span><strong>{summary.remaining.toLocaleString("th-TH")}</strong><small>ครั้ง</small></div>
                <div className="maint-plan-progress-block"><span>ความคืบหน้ารวม</span><strong>{summary.progress}%</strong><ProgressBar value={summary.progress} /></div>
                {canManage && <div className="maint-plan-actions"><button type="button" onClick={() => setEditing(summary.plan)}>แก้ไข</button><button className="danger" type="button" onClick={() => deletePlan(summary.plan)}>ลบ</button></div>}
              </section>
              <section className="maint-panel">
                <div className="maint-panel-heading"><div><span>DELIVERY CYCLES</span><h3>ผลการดำเนินงานรายรอบ</h3></div><small>Actual นับจากรายงานที่อนุมัติแล้วเท่านั้น</small></div>
                <div className="maint-table-wrap">
                  <table className="maint-table">
                    <thead><tr><th>รอบ</th><th>ช่วงเวลา</th><th>Plan</th><th>Actual</th><th>คงเหลือ</th><th>ความคืบหน้า</th></tr></thead>
                    <tbody>{summary.cycles.map((cycle) => <tr key={cycle.id}><td><strong>รอบ {cycle.sequence}</strong><small>{cycle.id}</small></td><td>{cycle.label}</td><td>{cycle.target}</td><td>{cycle.actual}</td><td>{cycle.remaining}</td><td><ProgressBar value={cycle.progress} /></td></tr>)}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      ) : <EmptyState title="ยังไม่มีแผนงานของไซต์นี้" detail={canManage ? "กด “สร้างแผนงาน” เพื่อกำหนดเป้าหมายประจำปี" : "โปรดติดต่อผู้ดูแลระบบเพื่อกำหนดแผนงาน"} />}

      {editing && <PlanForm currentUser={currentUser} jobsiteId={activeJobsite.id} initialPlan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={savePlan} />}
    </div>
  );
}

async function readAttachments(files: FileList | null): Promise<ReportAttachment[]> {
  if (!files) return [];
  const selected = Array.from(files).slice(0, 4);
  const oversized = selected.find((file) => file.size > 2_000_000);
  if (oversized) throw new Error(`ไฟล์ ${oversized.name} มีขนาดเกิน 2 MB`);
  return Promise.all(selected.map((file) => new Promise<ReportAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: createUuid(), name: file.name, type: file.type, dataUrl: String(reader.result) });
    reader.onerror = () => reject(new Error(`อ่านไฟล์ ${file.name} ไม่สำเร็จ`));
    reader.readAsDataURL(file);
  })));
}

function ServiceReportForm({
  props,
  report,
  onClose,
}: {
  props: WorkspaceProps;
  report: ServiceReport | null;
  onClose: () => void;
}) {
  const { activeJobsite, assets, currentUser, state, setState, onToast } = props;
  const plans = state.plans.filter((plan) => plan.jobsiteId === activeJobsite.id && plan.status !== "completed");
  const [planId, setPlanId] = useState(report?.planId ?? plans[0]?.id ?? "");
  const [attachments, setAttachments] = useState<ReportAttachment[]>(report?.attachments ?? []);
  const [fileError, setFileError] = useState("");
  const selectedPlan = plans.find((plan) => plan.id === planId) ?? plans[0];
  const cycles = selectedPlan ? createPlanCycles(selectedPlan) : [];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = submitter?.value === "submit" ? "submitted" : "draft";
    let nextAttachments = attachments;
    try {
      const added = await readAttachments((form.get("photos") as File).size ? (event.currentTarget.elements.namedItem("photos") as HTMLInputElement).files : null);
      nextAttachments = [...attachments, ...added].slice(0, 4);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "แนบไฟล์ไม่สำเร็จ");
      return;
    }
    if (intent === "submitted" && nextAttachments.length === 0) {
      setFileError("ต้องแนบรูปภาพอย่างน้อย 1 รูปก่อนส่งอนุมัติ");
      return;
    }
    const assetId = String(form.get("assetId"));
    const asset = assets.find((item) => item.id === assetId);
    const timestamp = new Date().toISOString();
    const next: ServiceReport = {
      id: report?.id ?? createId("SR"),
      jobsiteId: activeJobsite.id,
      planId,
      cycleId: String(form.get("cycleId")),
      workOrderId: String(form.get("workOrderId") || "") || null,
      assetId,
      assetName: asset?.name ?? assetId,
      serviceDate: String(form.get("serviceDate")),
      quantity: Number(form.get("quantity")),
      technicianName: String(form.get("technicianName")),
      customerName: String(form.get("customerName")),
      workPerformed: String(form.get("workPerformed")),
      findings: String(form.get("findings")),
      actionTaken: String(form.get("actionTaken")),
      result: form.get("result") as ServiceReport["result"],
      status: intent,
      attachments: nextAttachments,
      createdBy: report?.createdBy ?? currentUser.id,
      createdAt: report?.createdAt ?? timestamp,
      updatedAt: timestamp,
      approvedBy: null,
      approvedAt: null,
      rejectionReason: null,
    };
    setState((current) => {
      const serviceReports = current.serviceReports.some((item) => item.id === next.id)
        ? current.serviceReports.map((item) => item.id === next.id ? next : item)
        : [next, ...current.serviceReports];
      const needsRepair = next.result === "repair_required" && next.status === "submitted" && !current.repairRequests.some((item) => item.serviceReportId === next.id);
      const repairRequests = needsRepair ? [{
        id: createId("RR"), jobsiteId: next.jobsiteId, serviceReportId: next.id, assetId: next.assetId, assetName: next.assetName,
        requestedDate: next.serviceDate, title: `ตรวจสอบความผิดปกติ: ${next.assetName}`, description: next.findings,
        priority: "high" as const, status: "draft" as const, reportedBy: next.technicianName, resolution: "", createdBy: currentUser.id,
        createdAt: timestamp, updatedAt: timestamp,
      }, ...current.repairRequests] : current.repairRequests;
      return { ...current, serviceReports, repairRequests };
    });
    onToast(intent === "submitted" ? `ส่ง ${next.id} เพื่ออนุมัติแล้ว` : `บันทึก ${next.id} เป็นฉบับร่างแล้ว`);
    onClose();
  };

  if (!selectedPlan || assets.length === 0) return <div className="maint-modal-backdrop"><section className="maint-modal compact"><EmptyState title="ยังสร้างรายงานไม่ได้" detail="ไซต์นี้ต้องมีแผนงานและเครื่องจักรก่อน" /><button className="maint-button secondary" type="button" onClick={onClose}>ปิด</button></section></div>;

  return (
    <div className="maint-modal-backdrop" onMouseDown={onClose}>
      <section className="maint-modal large" onMouseDown={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
        <div className="maint-modal-heading"><div><span>SERVICE REPORT</span><h2>{report ? `แก้ไข ${report.id}` : "บันทึกผลการปฏิบัติงาน"}</h2><p>รายงานจะเพิ่มยอด Actual หลังผู้ดูแลระบบอนุมัติ</p></div><button type="button" onClick={onClose} aria-label="ปิด">×</button></div>
        <form className="maint-form" onSubmit={handleSubmit}>
          <label>แผนงาน<select name="planId" value={planId} onChange={(event) => setPlanId(event.target.value)}>{plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}</select></label>
          <label>รอบงาน<select name="cycleId" defaultValue={report?.cycleId ?? cycles[0]?.id}>{cycles.map((cycle) => <option value={cycle.id} key={cycle.id}>รอบ {cycle.sequence}: {cycle.label} (Plan {cycle.target})</option>)}</select></label>
          <label>วันที่ให้บริการ<input name="serviceDate" type="date" required defaultValue={report?.serviceDate ?? today()} /></label>
          <label>จำนวนงานที่เสร็จ<input name="quantity" type="number" min="1" required defaultValue={report?.quantity ?? 1} /></label>
          <label>เครื่องจักร<select name="assetId" defaultValue={report?.assetId ?? assets[0].id}>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.id} - {asset.name}</option>)}</select></label>
          <label>เลขที่ใบงาน (ถ้ามี)<input name="workOrderId" defaultValue={report?.workOrderId ?? ""} placeholder="WO-..." /></label>
          <label>ช่างผู้ปฏิบัติงาน<input name="technicianName" required defaultValue={report?.technicianName ?? currentUser.displayName} /></label>
          <label>ผู้รับมอบงานลูกค้า<input name="customerName" required defaultValue={report?.customerName ?? ""} placeholder="ชื่อผู้ตรวจรับงาน" /></label>
          <label className="wide">รายละเอียดงานที่ทำ<textarea name="workPerformed" required rows={3} defaultValue={report?.workPerformed} /></label>
          <label className="wide">ผลการตรวจสอบ<textarea name="findings" required rows={3} defaultValue={report?.findings} /></label>
          <label className="wide">การแก้ไข / การดำเนินการ<textarea name="actionTaken" required rows={3} defaultValue={report?.actionTaken} /></label>
          <label>ผลการปฏิบัติงาน<select name="result" defaultValue={report?.result ?? "normal"}><option value="normal">ปกติ / ส่งมอบงานได้</option><option value="repair_required">พบความผิดปกติ / ต้องแจ้งซ่อม</option></select></label>
          <label>แนบรูปภาพ (สูงสุด 4 รูป)<input name="photos" type="file" accept="image/*" multiple /></label>
          {attachments.length > 0 && <div className="maint-photo-strip wide">{attachments.map((attachment) => <figure key={attachment.id}><img src={attachment.dataUrl} alt={attachment.name} /><figcaption>{attachment.name}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}>ลบ</button></figcaption></figure>)}</div>}
          {fileError && <p className="maint-form-error wide">{fileError}</p>}
          <div className="maint-form-actions wide"><button className="maint-button secondary" type="button" onClick={onClose}>ยกเลิก</button><button className="maint-button secondary" name="intent" value="draft" type="submit">บันทึกฉบับร่าง</button><button className="maint-button primary" name="intent" value="submit" type="submit">ส่งอนุมัติ</button></div>
        </form>
      </section>
    </div>
  );
}

async function exportServiceReport(report: ServiceReport, plan: MaintenancePlan | undefined, site: Jobsite) {
  await downloadMaintenancePdf({
    filename: `${report.id}.pdf`, documentTitle: "ใบรายงานการบริการ", documentNumber: report.id,
    subtitle: `${site.name} • ${formatThaiDate(report.serviceDate)}`,
    sections: [
      { label: "แผนงาน", value: plan?.name ?? report.planId }, { label: "เครื่องจักร", value: `${report.assetId} - ${report.assetName}` },
      { label: "จำนวนงาน", value: `${report.quantity} ครั้ง` }, { label: "ช่างผู้ปฏิบัติงาน", value: report.technicianName },
      { label: "ผู้รับมอบงาน", value: report.customerName }, { label: "รายละเอียดงาน", value: report.workPerformed },
      { label: "ผลการตรวจสอบ", value: report.findings }, { label: "การดำเนินการ", value: report.actionTaken },
      { label: "ผลลัพธ์", value: report.result === "normal" ? "ปกติ / ส่งมอบงานได้" : "พบความผิดปกติ / ต้องแจ้งซ่อม" },
      { label: "สถานะ", value: reportStatusLabel(report.status) },
    ], photos: report.attachments,
  });
}

export function ServiceReportsPage(props: WorkspaceProps) {
  const { activeJobsite, currentUser, state, setState, onToast, onReportApproved } = props;
  const reports = state.serviceReports.filter((report) => report.jobsiteId === activeJobsite.id).sort((a, b) => b.serviceDate.localeCompare(a.serviceDate));
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<ServiceReport | "new" | null>(null);
  const [selected, setSelected] = useState<ServiceReport | null>(null);
  const filtered = reports.filter((report) => status === "all" || report.status === status);
  const canEdit = currentUser.role !== "user";

  const updateStatus = (report: ServiceReport, nextStatus: ServiceReport["status"]) => {
    const timestamp = new Date().toISOString();
    setState((current) => ({ ...current, serviceReports: current.serviceReports.map((item) => item.id === report.id ? {
      ...item, status: nextStatus, updatedAt: timestamp,
      approvedBy: nextStatus === "approved" ? currentUser.id : null,
      approvedAt: nextStatus === "approved" ? timestamp : null,
      rejectionReason: nextStatus === "rejected" ? "กรุณาตรวจสอบข้อมูลและส่งใหม่" : null,
    } : item) }));
    setSelected(null);
    if (nextStatus === "approved") onReportApproved?.(report);
    onToast(`${report.id}: ${reportStatusLabel(nextStatus)}`);
  };

  const removeReport = (report: ServiceReport) => {
    if (!window.confirm(`ลบ ${report.id} ใช่หรือไม่`)) return;
    setState((current) => ({
      ...current,
      serviceReports: current.serviceReports.filter((item) => item.id !== report.id),
      repairRequests: current.repairRequests.map((item) => item.serviceReportId === report.id ? { ...item, serviceReportId: null } : item),
    }));
    setSelected(null);
    onToast(`ลบ ${report.id} แล้ว`);
  };

  return (
    <div className="maint-page">
      <section className="maint-page-toolbar"><div><span>SERVICE REPORTS</span><h2>รายงานผลการปฏิบัติงาน</h2><p>แนบหลักฐาน ส่งอนุมัติ และดาวน์โหลด PDF</p></div>{canEdit && <button className="maint-button primary" type="button" onClick={() => setEditing("new")}>+ สร้าง Service Report</button>}</section>
      <section className="maint-panel">
        <div className="maint-filter-row"><div className="maint-filter-tabs">{[["all", "ทั้งหมด"], ["draft", "ฉบับร่าง"], ["submitted", "รออนุมัติ"], ["approved", "อนุมัติแล้ว"], ["rejected", "ส่งกลับ"]].map(([value, label]) => <button className={status === value ? "active" : ""} type="button" key={value} onClick={() => setStatus(value)}>{label}<span>{value === "all" ? reports.length : reports.filter((report) => report.status === value).length}</span></button>)}</div></div>
        {filtered.length ? <div className="maint-table-wrap"><table className="maint-table"><thead><tr><th>เลขที่ / วันที่</th><th>แผนงาน</th><th>เครื่องจักร</th><th>จำนวน</th><th>ช่าง</th><th>หลักฐาน</th><th>สถานะ</th><th /></tr></thead><tbody>{filtered.map((report) => { const plan = state.plans.find((item) => item.id === report.planId); return <tr key={report.id}><td><strong>{report.id}</strong><small>{formatThaiDate(report.serviceDate)}</small></td><td>{plan?.name ?? report.planId}</td><td><strong>{report.assetId}</strong><small>{report.assetName}</small></td><td>{report.quantity}</td><td>{report.technicianName}</td><td>{report.attachments.length} รูป</td><td><span className={`maint-status ${statusTone[report.status]}`}>{reportStatusLabel(report.status)}</span></td><td><button className="maint-link-button" type="button" onClick={() => setSelected(report)}>เปิด</button></td></tr>; })}</tbody></table></div> : <EmptyState title="ไม่พบ Service Report" detail="ยังไม่มีรายงานในสถานะที่เลือก" />}
      </section>
      {editing && <ServiceReportForm props={props} report={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {selected && <div className="maint-modal-backdrop" onMouseDown={() => setSelected(null)}><section className="maint-detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className="maint-modal-heading"><div><span>SERVICE REPORT</span><h2>{selected.id}</h2><p>{formatThaiDate(selected.serviceDate)} • {activeJobsite.name}</p></div><button type="button" onClick={() => setSelected(null)}>×</button></div><div className="maint-detail-grid"><div><span>เครื่องจักร</span><strong>{selected.assetId}</strong><small>{selected.assetName}</small></div><div><span>จำนวนงาน</span><strong>{selected.quantity} ครั้ง</strong></div><div><span>ช่าง</span><strong>{selected.technicianName}</strong></div><div><span>ผู้รับมอบงาน</span><strong>{selected.customerName}</strong></div></div><div className="maint-detail-copy"><h3>รายละเอียดงาน</h3><p>{selected.workPerformed}</p><h3>ผลการตรวจสอบ</h3><p>{selected.findings}</p><h3>การดำเนินการ</h3><p>{selected.actionTaken}</p></div>{selected.attachments.length > 0 && <div className="maint-photo-strip">{selected.attachments.map((attachment) => <figure key={attachment.id}><img src={attachment.dataUrl} alt={attachment.name} /><figcaption>{attachment.name}</figcaption></figure>)}</div>}<div className="maint-detail-actions"><button className="maint-button secondary" type="button" onClick={() => exportServiceReport(selected, state.plans.find((item) => item.id === selected.planId), activeJobsite).then(() => onToast(`ดาวน์โหลด ${selected.id}.pdf แล้ว`)).catch(() => onToast("สร้าง PDF ไม่สำเร็จ"))}>ดาวน์โหลด PDF</button>{canEdit && (selected.status === "draft" || selected.status === "rejected") && <button className="maint-button secondary" type="button" onClick={() => { setEditing(selected); setSelected(null); }}>แก้ไข</button>}{canEdit && (currentUser.role === "admin" || selected.createdBy === currentUser.id) && <button className="maint-button danger" type="button" onClick={() => removeReport(selected)}>ลบ</button>}{currentUser.role === "admin" && selected.status === "submitted" && <><button className="maint-button danger" type="button" onClick={() => updateStatus(selected, "rejected")}>ส่งกลับแก้ไข</button><button className="maint-button primary" type="button" onClick={() => updateStatus(selected, "approved")}>อนุมัติรายงาน</button></>}</div></section></div>}
    </div>
  );
}

function RepairForm({ props, request, onClose }: { props: WorkspaceProps; request: RepairRequest | null; onClose: () => void }) {
  const { activeJobsite, assets, currentUser, setState, onToast } = props;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assetId = String(form.get("assetId"));
    const asset = assets.find((item) => item.id === assetId);
    const timestamp = new Date().toISOString();
    const next: RepairRequest = {
      id: request?.id ?? createId("RR"), jobsiteId: activeJobsite.id, serviceReportId: request?.serviceReportId ?? null,
      assetId, assetName: asset?.name ?? assetId, requestedDate: String(form.get("requestedDate")), title: String(form.get("title")),
      description: String(form.get("description")), priority: form.get("priority") as RepairRequest["priority"], status: form.get("status") as RepairStatus,
      reportedBy: String(form.get("reportedBy")), resolution: String(form.get("resolution")), createdBy: request?.createdBy ?? currentUser.id,
      createdAt: request?.createdAt ?? timestamp, updatedAt: timestamp,
    };
    setState((current) => ({ ...current, repairRequests: current.repairRequests.some((item) => item.id === next.id) ? current.repairRequests.map((item) => item.id === next.id ? next : item) : [next, ...current.repairRequests] }));
    onToast(`บันทึกใบแจ้งซ่อม ${next.id} แล้ว`);
    onClose();
  };
  return <div className="maint-modal-backdrop" onMouseDown={onClose}><section className="maint-modal" onMouseDown={(event) => event.stopPropagation()}><div className="maint-modal-heading"><div><span>REPAIR REQUEST</span><h2>{request ? `แก้ไข ${request.id}` : "สร้างใบแจ้งซ่อม"}</h2><p>บันทึกสิ่งผิดปกติและติดตามผลการแก้ไข</p></div><button type="button" onClick={onClose}>×</button></div><form className="maint-form" onSubmit={handleSubmit}><label className="wide">หัวข้อ<input name="title" required defaultValue={request?.title} /></label><label>เครื่องจักร<select name="assetId" defaultValue={request?.assetId ?? assets[0]?.id}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.id} - {asset.name}</option>)}</select></label><label>วันที่แจ้ง<input name="requestedDate" type="date" required defaultValue={request?.requestedDate ?? today()} /></label><label>ความสำคัญ<select name="priority" defaultValue={request?.priority ?? "normal"}><option value="low">ต่ำ</option><option value="normal">ปกติ</option><option value="high">สูง</option><option value="critical">วิกฤต</option></select></label><label>สถานะ<select name="status" defaultValue={request?.status ?? "open"}><option value="draft">ฉบับร่าง</option><option value="open">รอดำเนินการ</option><option value="in_progress">กำลังซ่อม</option><option value="resolved">แก้ไขแล้ว</option><option value="cancelled">ยกเลิก</option></select></label><label>ผู้แจ้ง<input name="reportedBy" required defaultValue={request?.reportedBy ?? currentUser.displayName} /></label><label className="wide">รายละเอียดความผิดปกติ<textarea name="description" required rows={4} defaultValue={request?.description} /></label><label className="wide">ผลการแก้ไข<textarea name="resolution" rows={3} defaultValue={request?.resolution} /></label><div className="maint-form-actions wide"><button className="maint-button secondary" type="button" onClick={onClose}>ยกเลิก</button><button className="maint-button primary" type="submit">บันทึกใบแจ้งซ่อม</button></div></form></section></div>;
}

async function exportRepairRequest(request: RepairRequest, site: Jobsite) {
  await downloadMaintenancePdf({ filename: `${request.id}.pdf`, documentTitle: "ใบแจ้งซ่อม", documentNumber: request.id, subtitle: `${site.name} • ${formatThaiDate(request.requestedDate)}`, sections: [
    { label: "เครื่องจักร", value: `${request.assetId} - ${request.assetName}` }, { label: "หัวข้อ", value: request.title },
    { label: "ความสำคัญ", value: request.priority }, { label: "ผู้แจ้ง", value: request.reportedBy },
    { label: "รายละเอียด", value: request.description }, { label: "ผลการแก้ไข", value: request.resolution || "ยังไม่มีผลการแก้ไข" },
    { label: "สถานะ", value: repairStatusLabel(request.status) }, { label: "Service Report อ้างอิง", value: request.serviceReportId ?? "-" },
  ] });
}

export function RepairRequestsPage(props: WorkspaceProps) {
  const { activeJobsite, currentUser, state, setState, onToast } = props;
  const requests = state.repairRequests.filter((request) => request.jobsiteId === activeJobsite.id).sort((a, b) => b.requestedDate.localeCompare(a.requestedDate));
  const [editing, setEditing] = useState<RepairRequest | "new" | null>(null);
  const canEdit = currentUser.role !== "user";
  const remove = (request: RepairRequest) => { if (!window.confirm(`ลบ ${request.id} ใช่หรือไม่`)) return; setState((current) => ({ ...current, repairRequests: current.repairRequests.filter((item) => item.id !== request.id) })); onToast(`ลบ ${request.id} แล้ว`); };
  return <div className="maint-page"><section className="maint-page-toolbar"><div><span>REPAIR REQUESTS</span><h2>ใบแจ้งซ่อม</h2><p>รายการความผิดปกติจากการตรวจสอบและ Service Report</p></div>{canEdit && <button className="maint-button primary" type="button" onClick={() => setEditing("new")}>+ สร้างใบแจ้งซ่อม</button>}</section><section className="maint-panel">{requests.length ? <div className="maint-table-wrap"><table className="maint-table"><thead><tr><th>เลขที่ / วันที่</th><th>หัวข้อ</th><th>เครื่องจักร</th><th>ผู้แจ้ง</th><th>ความสำคัญ</th><th>สถานะ</th><th /></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td><strong>{request.id}</strong><small>{formatThaiDate(request.requestedDate)}</small></td><td>{request.title}{request.serviceReportId && <small>อ้างอิง {request.serviceReportId}</small>}</td><td><strong>{request.assetId}</strong><small>{request.assetName}</small></td><td>{request.reportedBy}</td><td><span className={`maint-priority ${request.priority}`}>{request.priority}</span></td><td><span className={`maint-status ${statusTone[request.status]}`}>{repairStatusLabel(request.status)}</span></td><td><div className="maint-row-actions"><button type="button" onClick={() => exportRepairRequest(request, activeJobsite).then(() => onToast(`ดาวน์โหลด ${request.id}.pdf แล้ว`)).catch(() => onToast("สร้าง PDF ไม่สำเร็จ"))}>PDF</button>{canEdit && <button type="button" onClick={() => setEditing(request)}>แก้ไข</button>}{canEdit && (currentUser.role === "admin" || request.createdBy === currentUser.id) && <button className="danger" type="button" onClick={() => remove(request)}>ลบ</button>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="ยังไม่มีใบแจ้งซ่อม" detail="เมื่อ Service Report ระบุว่าพบความผิดปกติ ระบบจะสร้างฉบับร่างให้อัตโนมัติ" />}</section>{editing && <RepairForm props={props} request={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}</div>;
}

export function PerformanceReportsPage({ activeJobsite, state }: Pick<WorkspaceProps, "activeJobsite" | "state">) {
  const sitePlans = state.plans.filter((plan) => plan.jobsiteId === activeJobsite.id);
  const years = [...new Set(sitePlans.map((plan) => plan.year))].sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState(years[0] ?? new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [selectedPlanId, setSelectedPlanId] = useState("all");
  const [selectedCycleId, setSelectedCycleId] = useState("all");
  const plans = sitePlans.filter((plan) => plan.year === selectedYear && (selectedPlanId === "all" || plan.id === selectedPlanId));
  const cycleOptions = plans.flatMap((plan) => createPlanCycles(plan).map((cycle) => ({ ...cycle, planName: plan.name })));
  const cyclesInScope = cycleOptions.filter((cycle) => {
    if (selectedCycleId !== "all") return cycle.id === selectedCycleId;
    if (selectedMonth === "all") return true;
    const month = Number(selectedMonth);
    if (cycle.startMonth <= cycle.endMonth) return month >= cycle.startMonth && month <= cycle.endMonth;
    return month >= cycle.startMonth || month <= cycle.endMonth;
  });
  const planIds = new Set(plans.map((plan) => plan.id));
  const cycleIds = new Set(cyclesInScope.map((cycle) => cycle.id));
  const reportsInScope = state.serviceReports.filter((report) => report.jobsiteId === activeJobsite.id && planIds.has(report.planId) && cycleIds.has(report.cycleId) && (selectedMonth === "all" || Number(report.serviceDate.slice(5, 7)) === Number(selectedMonth)));
  const approved = reportsInScope.filter((report) => report.status === "approved");
  const pending = reportsInScope.filter((report) => report.status === "submitted");
  const target = cyclesInScope.reduce((total, cycle) => total + cycle.target, 0);
  const actual = approved.reduce((total, report) => total + report.quantity, 0);
  const progress = target ? Math.round((actual / target) * 1000) / 10 : 0;
  const chartReports = state.serviceReports.filter((report) => report.jobsiteId === activeJobsite.id && report.status === "approved" && planIds.has(report.planId) && report.serviceDate.startsWith(`${selectedYear}-`));
  const monthly = useMemo(() => Array.from({ length: 12 }, (_, index) => chartReports.filter((report) => Number(report.serviceDate.slice(5, 7)) === index + 1).reduce((total, report) => total + report.quantity, 0)), [chartReports]);
  const maxMonth = Math.max(...monthly, 1);
  const cycleRows = cyclesInScope.map((cycle) => {
    const cycleActual = approved.filter((report) => report.cycleId === cycle.id).reduce((total, report) => total + report.quantity, 0);
    return { ...cycle, actual: cycleActual, remaining: Math.max(cycle.target - cycleActual, 0), progress: cycle.target ? Math.round((cycleActual / cycle.target) * 1000) / 10 : 0 };
  });
  const exportSummary = () => downloadMaintenancePdf({ filename: `PM-Performance-${activeJobsite.id}-${selectedYear}.pdf`, documentTitle: "รายงานสรุป Plan เทียบ Actual", documentNumber: `${activeJobsite.id}-${selectedYear}`, subtitle: `${activeJobsite.name} • ปี ${selectedYear + 543}`, sections: [{ label: "ขอบเขต", value: `${selectedPlanId === "all" ? "ทุกแผน" : plans[0]?.name ?? selectedPlanId} • ${selectedMonth === "all" ? "ทั้งปี" : `เดือน ${selectedMonth}`}` }, { label: "เป้าหมาย", value: `${target.toLocaleString("th-TH")} ครั้ง` }, { label: "Actual", value: `${actual.toLocaleString("th-TH")} ครั้ง` }, { label: "ความคืบหน้า", value: `${progress}%` }, { label: "รออนุมัติ", value: `${pending.length} รายงาน` }, ...cycleRows.map((cycle) => ({ label: cycle.label, value: `${cycle.actual} / ${cycle.target} ครั้ง • คงเหลือ ${cycle.remaining}` }))] });
  return <div className="maint-page"><section className="maint-page-toolbar"><div><span>PERFORMANCE REPORT</span><h2>สรุป Plan เทียบ Actual</h2><p>เลือกปี เดือน แผน หรือรอบส่งงานได้</p></div><button className="maint-button secondary" type="button" onClick={() => void exportSummary()}>ดาวน์โหลด PDF</button></section><section className="maint-report-filters"><label>ปี<select value={selectedYear} onChange={(event) => { setSelectedYear(Number(event.target.value)); setSelectedPlanId("all"); setSelectedCycleId("all"); }}>{years.map((year) => <option key={year} value={year}>{year + 543}</option>)}</select></label><label>เดือน<select value={selectedMonth} onChange={(event) => { setSelectedMonth(event.target.value); setSelectedCycleId("all"); }}><option value="all">ทั้งปี</option>{["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"].map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label><label>แผนงาน<select value={selectedPlanId} onChange={(event) => { setSelectedPlanId(event.target.value); setSelectedCycleId("all"); }}><option value="all">ทุกแผน</option>{sitePlans.filter((plan) => plan.year === selectedYear).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label><label>รอบส่งงาน<select value={selectedCycleId} onChange={(event) => setSelectedCycleId(event.target.value)}><option value="all">ทุกรอบ</option>{cycleOptions.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.planName} • {cycle.label}</option>)}</select></label></section><section className="maint-report-kpis"><div><span>เป้าหมายตามตัวกรอง</span><strong>{target.toLocaleString("th-TH")}</strong><small>ครั้ง</small></div><div><span>Actual</span><strong>{actual.toLocaleString("th-TH")}</strong><small>จากรายงานที่อนุมัติ</small></div><div><span>ความคืบหน้า</span><strong>{progress}%</strong><small>ของเป้าหมาย</small></div><div><span>รออนุมัติ</span><strong>{pending.length}</strong><small>รายงาน</small></div></section><section className="maint-report-layout"><article className="maint-panel"><div className="maint-panel-heading"><div><span>MONTHLY ACTUAL</span><h3>ผลการปฏิบัติงานรายเดือน ปี {selectedYear + 543}</h3></div></div><div className="maint-month-chart">{monthly.map((value, index) => <div className={selectedMonth === String(index + 1) ? "active" : ""} key={index}><i style={{ height: `${Math.max((value / maxMonth) * 100, value ? 8 : 1)}%` }}><span>{value}</span></i><small>{["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][index]}</small></div>)}</div></article><article className="maint-panel"><div className="maint-panel-heading"><div><span>BY CYCLE</span><h3>สถานะแยกตามรอบ</h3></div></div>{cycleRows.length ? <div className="maint-summary-list">{cycleRows.slice(0, 8).map((cycle) => <div key={cycle.id}><p><strong>{cycle.label}</strong><span>{cycle.actual} / {cycle.target} ครั้ง</span></p><ProgressBar value={cycle.progress} /></div>)}</div> : <EmptyState title="ยังไม่มีข้อมูล" detail="ไม่พบรอบงานตามตัวกรองที่เลือก" />}</article></section></div>;
}
