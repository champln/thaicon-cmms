import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import IoTMonitor from "./IoTMonitor";
import AdminWorkspace from "./AdminWorkspace";
import { roleLabels } from "./access";
import type { DemoUser, Jobsite, UserRole } from "./access";
import {
  MaintenancePlansPage,
  PerformanceReportsPage,
  PlanProgressOverview,
  PmDueReminderPanel,
  RepairRequestsPage,
  ServiceReportsPage,
} from "./MaintenanceWorkspace";
import { loadMaintenanceState, saveMaintenanceState } from "./maintenance";
import type { MaintenanceState } from "./maintenance";
import { isSupabaseConfigured } from "./supabase";
import { loadSupabaseMaintenanceState, syncSupabaseMaintenanceState } from "./maintenance-supabase";
import type { AssetHealth, ManagedAsset, MasterDataState } from "./master-data";
import { loadSupabaseOperationsState, syncSupabaseOperationsState } from "./operations-supabase";
import type { OperationsState } from "./operations-supabase";

type Page =
  | "dashboard"
  | "work-orders"
  | "pm"
  | "service-reports"
  | "repair-requests"
  | "assets"
  | "sites"
  | "alerts"
  | "reports"
  | "iot"
  | "admin";

type WorkStatus = "รอมอบหมาย" | "กำลังดำเนินการ" | "รอตรวจรับ" | "เสร็จสิ้น";
type Priority = "วิกฤต" | "สูง" | "ปกติ" | "ต่ำ";
type Asset = ManagedAsset & { site: string };

export type WorkOrder = {
  id: string;
  type: "PM" | "CM" | "EM";
  title: string;
  assetId: string;
  assetName: string;
  site: string;
  priority: Priority;
  status: WorkStatus;
  assignee: string;
  due: string;
  created: string;
  progress: number;
};

export type AlertItem = {
  id: string;
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
  assetId: string;
  site: string;
  time: string;
  value: string;
  acknowledged: boolean;
};

type PmItem = {
  id: string;
  date: string;
  day: string;
  title: string;
  site: string;
  assets: number;
  team: string;
  status: "พร้อมดำเนินการ" | "กำลังดำเนินการ" | "รอยืนยัน";
};

const initialWorkOrders: WorkOrder[] = [
  {
    id: "WO-2607-0148",
    type: "EM",
    title: "ตรวจสอบแรงดันห้องผ่าตัดต่ำกว่าเกณฑ์",
    assetId: "CR-DP-02",
    assetName: "Clean Room Differential Pressure",
    site: "โรงพยาบาลกลาง",
    priority: "วิกฤต",
    status: "กำลังดำเนินการ",
    assignee: "อนุชา ว.",
    due: "วันนี้ 11:30",
    created: "28 ก.ค. 09:12",
    progress: 55,
  },
  {
    id: "WO-2607-0147",
    type: "PM",
    title: "PM ระบบ AHU ประจำเดือน",
    assetId: "AHU-OPD-01",
    assetName: "Air Handling Unit — OPD",
    site: "โรงพยาบาลนพรัตนราชธานี",
    priority: "สูง",
    status: "รอตรวจรับ",
    assignee: "กิตติพงษ์ ส.",
    due: "วันนี้ 15:00",
    created: "27 ก.ค. 16:40",
    progress: 90,
  },
  {
    id: "WO-2607-0146",
    type: "CM",
    title: "ตรวจสอบเสียงผิดปกติที่ Control Panel",
    assetId: "CTRL-LAB-05",
    assetName: "Laboratory Control Panel",
    site: "มหาวิทยาลัยธรรมศาสตร์",
    priority: "ปกติ",
    status: "รอมอบหมาย",
    assignee: "ยังไม่มอบหมาย",
    due: "29 ก.ค. 13:00",
    created: "27 ก.ค. 14:25",
    progress: 0,
  },
  {
    id: "WO-2607-0145",
    type: "PM",
    title: "PM ตู้แช่ยาและสอบเทียบ Sensor",
    assetId: "FREEZER-PH-03",
    assetName: "ตู้แช่ยา Pharmacy 03",
    site: "โรงพยาบาลสิรินธร",
    priority: "สูง",
    status: "เสร็จสิ้น",
    assignee: "ปิยะพงษ์ น.",
    due: "27 ก.ค. 16:00",
    created: "25 ก.ค. 10:10",
    progress: 100,
  },
  {
    id: "WO-2607-0144",
    type: "PM",
    title: "ตรวจสอบ Exhaust Fan รายไตรมาส",
    assetId: "EXF-ER-06",
    assetName: "Emergency Exhaust Fan",
    site: "โรงพยาบาลพญาไท 3",
    priority: "ปกติ",
    status: "กำลังดำเนินการ",
    assignee: "วรพล จ.",
    due: "วันนี้ 17:00",
    created: "26 ก.ค. 09:00",
    progress: 35,
  },
];

const initialAlerts: AlertItem[] = [
  {
    id: "ALT-6721",
    level: "critical",
    title: "Differential Pressure ต่ำกว่าเกณฑ์",
    detail: "ค่าต่ำกว่า 8 Pa ต่อเนื่องเกิน 5 นาที",
    assetId: "CR-DP-02",
    site: "โรงพยาบาลกลาง",
    time: "8 นาทีที่แล้ว",
    value: "7.2 Pa",
    acknowledged: false,
  },
  {
    id: "ALT-6720",
    level: "warning",
    title: "อุณหภูมิขาออก AHU สูงขึ้น",
    detail: "สูงกว่าค่าเฉลี่ย 2.4°C ในช่วงเวลาเดียวกัน",
    assetId: "AHU-OPD-01",
    site: "โรงพยาบาลนพรัตนราชธานี",
    time: "32 นาทีที่แล้ว",
    value: "24.8°C",
    acknowledged: false,
  },
  {
    id: "ALT-6718",
    level: "warning",
    title: "กระแสไฟ Control Panel แกว่ง",
    detail: "ตรวจพบความผันผวน 3 ครั้งภายใน 1 ชั่วโมง",
    assetId: "CTRL-LAB-05",
    site: "มหาวิทยาลัยธรรมศาสตร์",
    time: "1 ชม. ที่แล้ว",
    value: "±12.6%",
    acknowledged: true,
  },
  {
    id: "ALT-6714",
    level: "info",
    title: "Sensor กลับมา Online",
    detail: "การเชื่อมต่อกลับสู่ภาวะปกติ",
    assetId: "FREEZER-PH-03",
    site: "โรงพยาบาลสิรินธร",
    time: "3 ชม. ที่แล้ว",
    value: "Online",
    acknowledged: true,
  },
];

const pmSchedule: PmItem[] = [
  {
    id: "PM-721",
    date: "28",
    day: "วันนี้",
    title: "PM Clean Room และตรวจวัดแรงดัน",
    site: "โรงพยาบาลกลาง",
    assets: 8,
    team: "ทีมวิศวกร 2",
    status: "กำลังดำเนินการ",
  },
  {
    id: "PM-722",
    date: "29",
    day: "พุธ",
    title: "PM ระบบปรับอากาศอาคารผู้ป่วยนอก",
    site: "โรงพยาบาลนพรัตนราชธานี",
    assets: 14,
    team: "ทีมวิศวกร 1",
    status: "พร้อมดำเนินการ",
  },
  {
    id: "PM-723",
    date: "30",
    day: "พฤหัส",
    title: "ตรวจสอบตู้แช่ยาและ Temperature Mapping",
    site: "โรงพยาบาลสิรินธร",
    assets: 6,
    team: "ทีมวิศวกร 3",
    status: "พร้อมดำเนินการ",
  },
  {
    id: "PM-724",
    date: "01",
    day: "เสาร์",
    title: "PM Control Panel ห้องปฏิบัติการ",
    site: "มหาวิทยาลัยธรรมศาสตร์",
    assets: 5,
    team: "รอยืนยันทีม",
    status: "รอยืนยัน",
  },
];

const navItems: { id: Page; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "ภาพรวม", icon: "grid" },
  { id: "work-orders", label: "ใบงาน", icon: "clipboard" },
  { id: "pm", label: "แผน PM", icon: "calendar" },
  { id: "service-reports", label: "Service Report", icon: "chart" },
  { id: "repair-requests", label: "ใบแจ้งซ่อม", icon: "warning" },
  { id: "assets", label: "เครื่องจักร", icon: "asset" },
  { id: "sites", label: "ไซต์ลูกค้า", icon: "building" },
  { id: "alerts", label: "Alarm", icon: "bell" },
  { id: "reports", label: "รายงาน", icon: "chart" },
  { id: "iot", label: "IoT Monitor", icon: "iot" },
  { id: "admin", label: "จัดการระบบ", icon: "user" },
];

const pagesByRole: Record<UserRole, Page[]> = {
  admin: navItems.map((item) => item.id),
  engineer: ["service-reports"],
  user: ["dashboard", "pm", "service-reports", "reports"],
};

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  dashboard: {
    title: "ภาพรวมการบำรุงรักษา",
    subtitle: "งาน เครื่องจักร และ Alarm ของไซต์ที่เลือก",
  },
  "work-orders": {
    title: "ใบงานทั้งหมด",
    subtitle: "งาน PM, Corrective และ Emergency",
  },
  pm: {
    title: "แผนงานบำรุงรักษา",
    subtitle: "แผนรายปี รอบส่งงาน และผล Plan เทียบ Actual",
  },
  "service-reports": {
    title: "Service Report",
    subtitle: "รายงานผลการปฏิบัติงาน หลักฐาน และการอนุมัติ",
  },
  "repair-requests": {
    title: "ใบแจ้งซ่อม",
    subtitle: "ติดตามความผิดปกติและผลการแก้ไข",
  },
  assets: {
    title: "ทะเบียนเครื่องจักร",
    subtitle: "สถานะ ประวัติ และแผน PM รายเครื่อง",
  },
  sites: {
    title: "ไซต์ลูกค้า",
    subtitle: "สัญญาบริการและเครื่องจักรแยกตามไซต์",
  },
  alerts: {
    title: "Alarm & Events",
    subtitle: "Alarm จากอุปกรณ์ IoT",
  },
  reports: {
    title: "รายงานประสิทธิภาพ",
    subtitle: "ผล PM, SLA และสถานะเครื่องจักร",
  },
  iot: {
    title: "IoT Monitoring Center",
    subtitle: "Gateway อุปกรณ์ และ Alarm ของไซต์ที่เลือก",
  },
  admin: {
    title: "จัดการข้อมูลระบบ",
    subtitle: "ไซต์ ผู้ใช้ สิทธิ์ และทะเบียนเครื่องจักร",
  },
};

type IconName =
  | "grid"
  | "clipboard"
  | "calendar"
  | "asset"
  | "building"
  | "bell"
  | "chart"
  | "search"
  | "plus"
  | "menu"
  | "arrow"
  | "check"
  | "clock"
  | "warning"
  | "user"
  | "close"
  | "filter"
  | "download"
  | "logout"
  | "iot";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 5h6" />
        <path d="M9 9h6M9 13h4" />
        <path d="M8 3H6a2 2 0 0 0-2 2v16h16V5a2 2 0 0 0-2-2h-2" />
        <rect x="8" y="2" width="8" height="4" rx="2" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
      </>
    ),
    asset: (
      <>
        <path d="M4 8h16v10H4zM7 8V5h10v3M8 13h8M8 16h5" />
        <path d="M7 21v-3M17 21v-3" />
      </>
    ),
    building: (
      <>
        <path d="M4 21V3h11v18M15 9h5v12M8 7h3M8 11h3M8 15h3M8 19h3M18 13h.01M18 17h.01M2 21h20" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    arrow: <path d="m9 18 6-6-6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    filter: <path d="M4 5h16M7 12h10M10 19h4" />,
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
      </>
    ),
    logout: (
      <>
        <path d="M10 5H4v14h6M14 8l4 4-4 4M8 12h10" />
      </>
    ),
    iot: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {paths[name]}
    </svg>
  );
}

function StatusBadge({ status }: { status: WorkStatus }) {
  const className =
    status === "เสร็จสิ้น"
      ? "done"
      : status === "กำลังดำเนินการ"
        ? "active"
        : status === "รอตรวจรับ"
          ? "review"
          : "waiting";
  return <span className={`cmms-status ${className}`}>{status}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`cmms-priority ${priority === "วิกฤต" ? "critical" : priority === "สูง" ? "high" : "normal"}`}>
      {priority}
    </span>
  );
}

function WorkTypeBadge({ type }: { type: WorkOrder["type"] }) {
  const label = type === "PM" ? "PM" : type === "CM" ? "Corrective" : "Emergency";
  return <span className={`cmms-work-type ${type.toLowerCase()}`}>{label}</span>;
}

function KpiCard({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  icon: IconName;
}) {
  return (
    <article className={`cmms-kpi ${tone}`}>
      <div className="cmms-kpi-icon">
        <Icon name={icon} size={22} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

function WorkOrderTable({
  orders,
  onSelect,
}: {
  orders: WorkOrder[];
  onSelect: (order: WorkOrder) => void;
}) {
  return (
    <div className="cmms-table-wrap">
      <table className="cmms-table">
        <thead>
          <tr>
            <th>ใบงาน</th>
            <th>เครื่องจักร / ไซต์</th>
            <th>ความสำคัญ</th>
            <th>ผู้รับผิดชอบ</th>
            <th>กำหนดเสร็จ</th>
            <th>สถานะ</th>
            <th aria-label="เปิดรายละเอียด" />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} onClick={() => onSelect(order)}>
              <td>
                <div className="cmms-order-title">
                  <WorkTypeBadge type={order.type} />
                  <div>
                    <strong>{order.title}</strong>
                    <small>{order.id}</small>
                  </div>
                </div>
              </td>
              <td>
                <strong className="cmms-cell-main">{order.assetId}</strong>
                <small className="cmms-cell-sub">{order.site}</small>
              </td>
              <td>
                <PriorityBadge priority={order.priority} />
              </td>
              <td>
                <span className="cmms-assignee">
                  <i>{order.assignee === "ยังไม่มอบหมาย" ? "—" : order.assignee.charAt(0)}</i>
                  {order.assignee}
                </span>
              </td>
              <td>
                <span className="cmms-due">{order.due}</span>
              </td>
              <td>
                <StatusBadge status={order.status} />
              </td>
              <td>
                <button className="cmms-row-open" type="button" aria-label={`เปิด ${order.id}`}>
                  <Icon name="arrow" size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && (
        <div className="cmms-empty">
          <Icon name="search" size={28} />
          <strong>ไม่พบใบงาน</strong>
          <span>ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ</span>
        </div>
      )}
    </div>
  );
}

function DashboardPage({
  orders,
  alerts,
  schedule,
  siteAssets,
  pmCompliance,
  maintenanceState,
  jobsiteId,
  canOperate,
  onSelectOrder,
  onNavigate,
  onCreate,
}: {
  orders: WorkOrder[];
  alerts: AlertItem[];
  schedule: PmItem[];
  siteAssets: Asset[];
  pmCompliance: number;
  maintenanceState: MaintenanceState;
  jobsiteId: string;
  canOperate: boolean;
  onSelectOrder: (order: WorkOrder) => void;
  onNavigate: (page: Page) => void;
  onCreate: () => void;
}) {
  const openOrders = orders.filter((order) => order.status !== "เสร็จสิ้น");
  const criticalAlerts = alerts.filter((alert) => alert.level === "critical" && !alert.acknowledged);
  const watchedAssets = siteAssets.filter((asset) => asset.health !== "ปกติ");
  const dueToday = openOrders.filter((order) => order.due.includes("วันนี้"));

  return (
    <div className="cmms-dashboard-page">
      <section className="cmms-action-banner">
        <div>
          <span className="cmms-live-label">
            <i />
            {canOperate ? "สรุปวันนี้" : "สิทธิ์ดูข้อมูล"}
          </span>
          <h2>{canOperate ? `ต้องติดตาม ${openOrders.length + criticalAlerts.length} รายการ` : "ดูข้อมูลเท่านั้น"}</h2>
          <p>{canOperate ? `Alarm วิกฤต ${criticalAlerts.length} รายการ • ใบงานครบกำหนดวันนี้ ${dueToday.length} รายการ` : "ดูแผน PM และรายงานได้ แต่แก้ไขข้อมูลไม่ได้"}</p>
        </div>
        {canOperate && (
          <button className="cmms-primary-button" type="button" onClick={onCreate}>
            <Icon name="plus" size={18} />
            สร้างใบงาน
          </button>
        )}
      </section>

      <PlanProgressOverview
        state={maintenanceState}
        jobsiteId={jobsiteId}
        onOpenPlans={() => onNavigate("pm")}
      />

      <PmDueReminderPanel
        state={maintenanceState}
        jobsiteId={jobsiteId}
        onOpenReports={() => onNavigate("service-reports")}
      />

      <section className={`cmms-kpi-grid ${canOperate ? "" : "viewer"}`} aria-label="ตัวชี้วัดหลัก">
        {canOperate && (
          <KpiCard
            icon="clipboard"
            label="ใบงานที่เปิดอยู่"
            value={String(openOrders.length)}
            note={`${dueToday.length} งานครบกำหนดวันนี้`}
            tone="blue"
          />
        )}
        <KpiCard
          icon="calendar"
          label="PM เดือนนี้"
          value={`${pmCompliance}%`}
          note="ผล PM ตามแผนประจำเดือน"
          tone="cyan"
        />
        {canOperate && (
          <KpiCard
            icon="warning"
            label="Alarm วิกฤต"
            value={String(criticalAlerts.length)}
            note="ต้องตอบสนองภายใน SLA"
            tone="red"
          />
        )}
        <KpiCard
          icon="asset"
          label="เครื่องจักรเฝ้าระวัง"
          value={String(watchedAssets.length)}
          note={`ทั้งหมด ${siteAssets.length} เครื่อง`}
          tone="amber"
        />
      </section>

      {canOperate && (
        <section className="cmms-dashboard-grid">
          <article className="cmms-panel cmms-work-panel">
            <div className="cmms-panel-heading">
              <div>
                <span>WORK ORDERS</span>
                <h3>ใบงานที่ต้องติดตาม</h3>
              </div>
              <button type="button" onClick={() => onNavigate("work-orders")}>
                ดูทั้งหมด <Icon name="arrow" size={15} />
              </button>
            </div>
            <WorkOrderTable orders={openOrders.slice(0, 4)} onSelect={onSelectOrder} />
          </article>

          <article className="cmms-panel cmms-alert-panel">
            <div className="cmms-panel-heading">
              <div>
                <span>IOT EVENTS</span>
                <h3>เหตุการณ์ล่าสุด</h3>
              </div>
              <button type="button" onClick={() => onNavigate("alerts")}>
                ดูทั้งหมด <Icon name="arrow" size={15} />
              </button>
            </div>
            <div className="cmms-alert-list">
              {alerts.slice(0, 3).map((alert) => (
                <div className="cmms-alert-item" key={alert.id}>
                  <span className={`cmms-alert-dot ${alert.level}`} />
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.assetId} • {alert.site}</p>
                    <small>{alert.time}</small>
                  </div>
                  <b>{alert.value}</b>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      <section className="cmms-dashboard-grid bottom">
        <article className="cmms-panel">
          <div className="cmms-panel-heading">
            <div>
              <span>PM SCHEDULE</span>
              <h3>แผนงาน 4 วันข้างหน้า</h3>
            </div>
            <button type="button" onClick={() => onNavigate("pm")}>
              ดูปฏิทิน <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="cmms-mini-schedule">
            {schedule.slice(0, 3).map((item) => (
              <div key={item.id}>
                <time>
                  <strong>{item.date}</strong>
                  <span>{item.day}</span>
                </time>
                <p>
                  <strong>{item.title}</strong>
                  <span>{item.site} • {item.assets} เครื่อง</span>
                </p>
                <em className={item.status === "กำลังดำเนินการ" ? "active" : ""}>
                  {item.status}
                </em>
              </div>
            ))}
          </div>
        </article>

        <article className="cmms-panel cmms-health-panel">
          <div className="cmms-panel-heading">
            <div>
              <span>ASSET HEALTH</span>
              <h3>สถานะเครื่องจักร</h3>
            </div>
            {canOperate && (
              <button type="button" onClick={() => onNavigate("assets")}>
                ดูทะเบียน <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
          <div className="cmms-health-content">
            <div className="cmms-health-ring">
              <div>
                <strong>98.7%</strong>
                <span>Connected</span>
              </div>
            </div>
            <div className="cmms-health-legend">
              <p><i className="healthy" /><span>ปกติ</span><strong>{siteAssets.filter((asset) => asset.health === "ปกติ").length}</strong></p>
              <p><i className="watch" /><span>เฝ้าระวัง</span><strong>{siteAssets.filter((asset) => asset.health === "เฝ้าระวัง").length}</strong></p>
              <p><i className="critical" /><span>วิกฤต</span><strong>{siteAssets.filter((asset) => asset.health === "วิกฤต").length}</strong></p>
              <small>ข้อมูลของไซต์ที่เลือก</small>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function WorkOrdersPage({
  orders,
  canOperate,
  onSelect,
  onCreate,
}: {
  orders: WorkOrder[];
  canOperate: boolean;
  onSelect: (order: WorkOrder) => void;
  onCreate: () => void;
}) {
  const [status, setStatus] = useState<"ทั้งหมด" | WorkStatus>("ทั้งหมด");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = status === "ทั้งหมด" || order.status === status;
      const matchesQuery =
        !normalized ||
        `${order.id} ${order.title} ${order.assetId} ${order.site} ${order.assignee}`
          .toLowerCase()
          .includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [orders, query, status]);

  return (
    <section className="cmms-panel cmms-page-panel">
      <div className="cmms-list-toolbar">
        <div className="cmms-tabs" role="tablist" aria-label="กรองสถานะใบงาน">
          {(["ทั้งหมด", "รอมอบหมาย", "กำลังดำเนินการ", "รอตรวจรับ", "เสร็จสิ้น"] as const).map(
            (item) => (
              <button
                className={status === item ? "active" : ""}
                key={item}
                onClick={() => setStatus(item)}
                type="button"
              >
                {item}
                <span>
                  {item === "ทั้งหมด"
                    ? orders.length
                    : orders.filter((order) => order.status === item).length}
                </span>
              </button>
            ),
          )}
        </div>
        <div className="cmms-list-actions">
          <label className="cmms-inline-search">
            <Icon name="search" size={17} />
            <input
              aria-label="ค้นหาใบงาน"
              placeholder="ค้นหาใบงาน เครื่องจักร หรือไซต์"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="cmms-secondary-button" type="button">
            <Icon name="filter" size={17} />
            ตัวกรอง
          </button>
          {canOperate && (
            <button className="cmms-primary-button" type="button" onClick={onCreate}>
              <Icon name="plus" size={17} />
              สร้างใบงาน
            </button>
          )}
        </div>
      </div>
      <WorkOrderTable orders={filtered} onSelect={onSelect} />
    </section>
  );
}

function PMPage({ schedule }: { schedule: PmItem[] }) {
  return (
    <div className="cmms-pm-layout">
      <section className="cmms-panel cmms-pm-summary">
        <div className="cmms-panel-heading">
          <div>
            <span>JULY 2026</span>
            <h3>สถานะแผน PM ประจำเดือน</h3>
          </div>
          <button type="button">
            กรกฎาคม 2569 <Icon name="calendar" size={16} />
          </button>
        </div>
        <div className="cmms-pm-progress">
          <div className="cmms-progress-ring">
            <strong>94.2%</strong>
            <span>PM Compliance</span>
          </div>
          <div className="cmms-pm-metrics">
            <div><strong>86</strong><span>แผนทั้งหมด</span></div>
            <div><strong>81</strong><span>เสร็จแล้ว</span></div>
            <div><strong>4</strong><span>กำลังดำเนินการ</span></div>
            <div><strong>1</strong><span>เกินกำหนด</span></div>
          </div>
        </div>
      </section>

      <section className="cmms-panel cmms-calendar-panel">
        <div className="cmms-panel-heading">
          <div>
            <span>UPCOMING</span>
            <h3>กำหนดการถัดไป</h3>
          </div>
          <button className="cmms-secondary-button" type="button">
            <Icon name="download" size={16} /> ส่งออกแผน
          </button>
        </div>
        <div className="cmms-pm-list">
          {schedule.map((item) => (
            <article key={item.id}>
              <time>
                <strong>{item.date}</strong>
                <span>{item.day}</span>
                <small>{Number(item.date) < 5 ? "ส.ค." : "ก.ค."}</small>
              </time>
              <div className="cmms-pm-item-main">
                <span>{item.id}</span>
                <h4>{item.title}</h4>
                <p><Icon name="building" size={14} /> {item.site}</p>
              </div>
              <div className="cmms-pm-item-meta">
                <span>{item.assets} เครื่อง</span>
                <strong>{item.team}</strong>
              </div>
              <em className={item.status === "กำลังดำเนินการ" ? "active" : item.status === "รอยืนยัน" ? "pending" : ""}>
                {item.status}
              </em>
              <button type="button" aria-label={`เปิด ${item.id}`}><Icon name="arrow" size={18} /></button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AssetsPage({ siteAssets }: { siteAssets: Asset[] }) {
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState<"ทั้งหมด" | AssetHealth>("ทั้งหมด");
  const [selected, setSelected] = useState<Asset | null>(null);

  const filtered = siteAssets.filter((asset) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery =
      !normalized ||
      `${asset.id} ${asset.name} ${asset.type} ${asset.site}`.toLowerCase().includes(normalized);
    return matchesQuery && (health === "ทั้งหมด" || asset.health === health);
  });

  return (
    <>
      <section className="cmms-panel cmms-page-panel">
        <div className="cmms-list-toolbar">
          <div className="cmms-asset-stats">
            <span><i className="healthy" />ปกติ <strong>{siteAssets.filter((asset) => asset.health === "ปกติ").length}</strong></span>
            <span><i className="watch" />เฝ้าระวัง <strong>{siteAssets.filter((asset) => asset.health === "เฝ้าระวัง").length}</strong></span>
            <span><i className="critical" />วิกฤต <strong>{siteAssets.filter((asset) => asset.health === "วิกฤต").length}</strong></span>
          </div>
          <div className="cmms-list-actions">
            <label className="cmms-inline-search">
              <Icon name="search" size={17} />
              <input
                aria-label="ค้นหาเครื่องจักร"
                placeholder="ค้นหา Asset ID, ชื่อ หรือไซต์"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              className="cmms-select"
              aria-label="กรองสถานะเครื่องจักร"
              value={health}
              onChange={(event) => setHealth(event.target.value as "ทั้งหมด" | AssetHealth)}
            >
              <option>ทั้งหมด</option>
              <option>ปกติ</option>
              <option>เฝ้าระวัง</option>
              <option>วิกฤต</option>
            </select>
          </div>
        </div>
        <div className="cmms-asset-grid">
          {filtered.map((asset) => (
            <button className="cmms-asset-card" key={asset.id} type="button" onClick={() => setSelected(asset)}>
              <div className="cmms-asset-card-top">
                <span className="cmms-asset-icon"><Icon name="asset" size={21} /></span>
                <span className={`cmms-health-badge ${asset.health === "ปกติ" ? "healthy" : asset.health === "เฝ้าระวัง" ? "watch" : "critical"}`}>
                  <i />{asset.health}
                </span>
              </div>
              <span className="cmms-asset-id">{asset.id}</span>
              <h3>{asset.name}</h3>
              <p><Icon name="building" size={14} /> {asset.site}</p>
              <small>{asset.location}</small>
              <div className="cmms-asset-card-bottom">
                <span><small>Sensor</small><strong>{asset.sensor}</strong></span>
                <span><small>PM ครั้งถัดไป</small><strong>{asset.nextPm}</strong></span>
              </div>
            </button>
          ))}
        </div>
      </section>
      {selected && (
        <div className="cmms-drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="cmms-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="cmms-close-button" type="button" onClick={() => setSelected(null)} aria-label="ปิด">
              <Icon name="close" size={20} />
            </button>
            <span className="cmms-drawer-eyebrow">ASSET PROFILE</span>
            <div className="cmms-drawer-title">
              <span className="cmms-asset-icon"><Icon name="asset" size={23} /></span>
              <div><small>{selected.id}</small><h2>{selected.name}</h2></div>
            </div>
            <span className={`cmms-health-badge large ${selected.health === "ปกติ" ? "healthy" : selected.health === "เฝ้าระวัง" ? "watch" : "critical"}`}><i />{selected.health}</span>
            <dl className="cmms-detail-list">
              <div><dt>ประเภท</dt><dd>{selected.type}</dd></div>
              <div><dt>ไซต์</dt><dd>{selected.site}</dd></div>
              <div><dt>ตำแหน่ง</dt><dd>{selected.location}</dd></div>
              <div><dt>ข้อมูลล่าสุด</dt><dd>{selected.sensor}</dd></div>
              <div><dt>PM ล่าสุด</dt><dd>{selected.lastPm}</dd></div>
              <div><dt>PM ครั้งถัดไป</dt><dd>{selected.nextPm}</dd></div>
            </dl>
            <div className="cmms-drawer-section">
              <h3>ประวัติล่าสุด</h3>
              <div className="cmms-timeline">
                <p><i /><span><strong>ตรวจสอบข้อมูลจาก Sensor</strong><small>วันนี้ 10:24 • ระบบ IoT</small></span></p>
                <p><i /><span><strong>บันทึกผล PM แล้ว</strong><small>{selected.lastPm} • ทีมวิศวกร ThaiCon</small></span></p>
                <p><i /><span><strong>อัปเดตทะเบียนเครื่องจักร</strong><small>12 มิ.ย. 2569 • System Admin</small></span></p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function SitesPage({ sites }: { sites: Jobsite[] }) {
  return (
    <section className="cmms-site-grid">
      {sites.map((site) => (
        <article className="cmms-panel cmms-site-card" key={site.name}>
          <div className="cmms-site-card-top">
            <span><Icon name="building" size={22} /></span>
            <small>{site.id}</small>
          </div>
          <h3>{site.name}</h3>
          <p>{site.type} • สัญญาบริการ Active</p>
          <div className="cmms-site-metrics">
            <span><small>เครื่องจักร</small><strong>{site.assetCount}</strong></span>
            <span><small>ใบงานเปิด</small><strong>{site.openWorkOrders}</strong></span>
            <span><small>PM Compliance</small><strong>{site.pmCompliance}%</strong></span>
          </div>
          <div className="cmms-site-footer">
            <span>{site.province}</span>
            <button type="button">ดูไซต์ <Icon name="arrow" size={15} /></button>
          </div>
        </article>
      ))}
    </section>
  );
}

function AlertsPage({
  alerts,
  canOperate,
  onAcknowledge,
  onCreateOrder,
}: {
  alerts: AlertItem[];
  canOperate: boolean;
  onAcknowledge: (id: string) => void;
  onCreateOrder: (alert: AlertItem) => void;
}) {
  return (
    <section className="cmms-panel cmms-page-panel">
      <div className="cmms-alert-summary">
        <div><span className="critical" /><strong>{alerts.filter((a) => a.level === "critical").length}</strong><small>Critical</small></div>
        <div><span className="warning" /><strong>{alerts.filter((a) => a.level === "warning").length}</strong><small>Warning</small></div>
        <div><span className="info" /><strong>{alerts.filter((a) => a.level === "info").length}</strong><small>Information</small></div>
        <p><i className="cmms-live-dot" /> IoT Gateway เชื่อมต่อปกติ</p>
      </div>
      <div className="cmms-event-list">
        {alerts.map((alert) => (
          <article className={alert.acknowledged ? "acknowledged" : ""} key={alert.id}>
            <span className={`cmms-event-icon ${alert.level}`}>
              <Icon name={alert.level === "critical" || alert.level === "warning" ? "warning" : "bell"} size={20} />
            </span>
            <div className="cmms-event-main">
              <div><span>{alert.id}</span><small>{alert.time}</small></div>
              <h3>{alert.title}</h3>
              <p>{alert.detail}</p>
              <small>{alert.assetId} • {alert.site}</small>
            </div>
            <strong className="cmms-event-value">{alert.value}</strong>
            <div className="cmms-event-actions">
              {canOperate && !alert.acknowledged ? (
                <>
                  <button className="cmms-secondary-button" type="button" onClick={() => onAcknowledge(alert.id)}>
                    รับทราบ
                  </button>
                  <button className="cmms-primary-button compact" type="button" onClick={() => onCreateOrder(alert)}>
                    สร้างใบงาน
                  </button>
                </>
              ) : alert.acknowledged ? (
                <span><Icon name="check" size={15} /> รับทราบแล้ว</span>
              ) : (
                <span>สิทธิ์ดูข้อมูล</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReportsPage({ siteAssets }: { siteAssets: Asset[] }) {
  const bars = [72, 84, 78, 91, 88, 94];
  return (
    <div className="cmms-report-grid">
      <section className="cmms-panel cmms-report-wide">
        <div className="cmms-panel-heading">
          <div><span>PM PERFORMANCE</span><h3>อัตราการดำเนินงานตามแผน</h3></div>
          <button type="button">6 เดือนล่าสุด <Icon name="calendar" size={16} /></button>
        </div>
        <div className="cmms-bar-chart" aria-label="PM compliance หกเดือนล่าสุด">
          {bars.map((value, index) => (
            <div key={value}>
              <i style={{ height: `${value}%` }}>
                <span>{value}%</span>
              </i>
              <small>{["ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค."][index]}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="cmms-panel cmms-sla-panel">
        <div className="cmms-panel-heading">
          <div><span>SLA</span><h3>การตอบสนอง</h3></div>
        </div>
        <div className="cmms-sla-score"><strong>92%</strong><span>ภายใน SLA</span></div>
        <dl>
          <div><dt>เวลาตอบรับเฉลี่ย</dt><dd>18 นาที</dd></div>
          <div><dt>เวลาแก้ไขเฉลี่ย</dt><dd>3.4 ชม.</dd></div>
          <div><dt>งานเกิน SLA</dt><dd>2 งาน</dd></div>
        </dl>
      </section>
      <section className="cmms-panel cmms-report-wide">
        <div className="cmms-panel-heading">
          <div><span>ASSET RELIABILITY</span><h3>เครื่องจักรที่ควรติดตาม</h3></div>
          <button type="button"><Icon name="download" size={16} /> ส่งออกรายงาน</button>
        </div>
        <div className="cmms-risk-list">
          {siteAssets.filter((asset) => asset.health !== "ปกติ").map((asset, index) => (
            <div key={asset.id}>
              <span>{index + 1}</span>
              <p><strong>{asset.name}</strong><small>{asset.id} • {asset.site}</small></p>
              <em className={asset.health === "วิกฤต" ? "critical" : "watch"}>{asset.health}</em>
              <b>{index === 0 ? "2 Alarm / 30 วัน" : "1 Alarm / 30 วัน"}</b>
            </div>
          ))}
        </div>
      </section>
      <section className="cmms-panel cmms-report-note">
        <Icon name="chart" size={24} />
        <h3>หมายเหตุ</h3>
        <p>รายงานนี้ใช้ข้อมูลจำลอง</p>
      </section>
    </div>
  );
}

function CreateWorkOrderModal({
  siteAssets,
  onClose,
  onSubmit,
  presetAlert,
}: {
  siteAssets: Asset[];
  onClose: () => void;
  onSubmit: (order: WorkOrder) => void;
  presetAlert: AlertItem | null;
}) {
  const [assetId, setAssetId] = useState(presetAlert?.assetId ?? siteAssets[0].id);
  const selectedAsset = siteAssets.find((asset) => asset.id === assetId) ?? siteAssets[0];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextNumber = 149 + Math.floor(Math.random() * 40);
    onSubmit({
      id: `WO-2607-${String(nextNumber).padStart(4, "0")}`,
      type: form.get("type") as WorkOrder["type"],
      title: String(form.get("title")),
      assetId,
      assetName: selectedAsset.name,
      site: selectedAsset.site,
      priority: form.get("priority") as Priority,
      status: "รอมอบหมาย",
      assignee: "ยังไม่มอบหมาย",
      due: String(form.get("due")),
      created: "28 ก.ค. 10:35",
      progress: 0,
    });
  };

  return (
    <div className="cmms-modal-backdrop" onMouseDown={onClose}>
      <div className="cmms-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="cmms-modal-heading">
          <div><span>NEW WORK ORDER</span><h2>สร้างใบงานใหม่</h2><p>ระบุงาน เครื่องจักร และระดับการตอบสนอง</p></div>
          <button type="button" onClick={onClose} aria-label="ปิด"><Icon name="close" size={20} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            ชื่องาน
            <input
              name="title"
              required
              defaultValue={presetAlert ? `ตรวจสอบ: ${presetAlert.title}` : ""}
              placeholder="เช่น PM ระบบ AHU ประจำเดือน"
            />
          </label>
          <div className="cmms-form-row">
            <label>
              ประเภทงาน
              <select name="type" defaultValue={presetAlert ? "EM" : "PM"}>
                <option value="PM">PM — Preventive Maintenance</option>
                <option value="CM">CM — Corrective Maintenance</option>
                <option value="EM">EM — Emergency Maintenance</option>
              </select>
            </label>
            <label>
              ระดับความสำคัญ
              <select name="priority" defaultValue={presetAlert?.level === "critical" ? "วิกฤต" : "ปกติ"}>
                <option>วิกฤต</option>
                <option>สูง</option>
                <option>ปกติ</option>
                <option>ต่ำ</option>
              </select>
            </label>
          </div>
          <label>
            เครื่องจักร
            <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
              {siteAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.id} — {asset.name}</option>
              ))}
            </select>
          </label>
          <div className="cmms-selected-asset">
            <Icon name="building" size={17} />
            <p><strong>{selectedAsset.site}</strong><span>{selectedAsset.location}</span></p>
            <em>{selectedAsset.health}</em>
          </div>
          <div className="cmms-form-row">
            <label>
              กำหนดเสร็จ
              <input name="due" defaultValue="29 ก.ค. 16:00" required />
            </label>
            <label>
              มอบหมายทีม
              <select name="team" defaultValue="">
                <option value="">ยังไม่มอบหมาย</option>
                <option>ทีมวิศวกร 1</option>
                <option>ทีมวิศวกร 2</option>
                <option>ทีมวิศวกร 3</option>
              </select>
            </label>
          </div>
          <label>
            รายละเอียด
            <textarea name="detail" rows={4} defaultValue={presetAlert?.detail ?? ""} placeholder="ระบุอาการ ขอบเขตงาน หรือข้อควรระวัง" />
          </label>
          <div className="cmms-modal-actions">
            <button className="cmms-secondary-button" type="button" onClick={onClose}>ยกเลิก</button>
            <button className="cmms-primary-button" type="submit"><Icon name="plus" size={17} />สร้างใบงาน</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkOrderDrawer({
  order,
  siteAssets,
  canOperate,
  onClose,
  onUpdateStatus,
}: {
  order: WorkOrder;
  siteAssets: Asset[];
  canOperate: boolean;
  onClose: () => void;
  onUpdateStatus: (id: string, status: WorkStatus) => void;
}) {
  const asset = siteAssets.find((item) => item.id === order.assetId);
  const nextAction =
    order.status === "รอมอบหมาย"
      ? { label: "เริ่มดำเนินการ", status: "กำลังดำเนินการ" as WorkStatus }
      : order.status === "กำลังดำเนินการ"
        ? { label: "ส่งตรวจรับ", status: "รอตรวจรับ" as WorkStatus }
        : order.status === "รอตรวจรับ"
          ? { label: "ปิดใบงาน", status: "เสร็จสิ้น" as WorkStatus }
          : null;

  return (
    <div className="cmms-drawer-backdrop" onMouseDown={onClose}>
      <aside className="cmms-drawer order" onMouseDown={(event) => event.stopPropagation()}>
        <button className="cmms-close-button" type="button" onClick={onClose} aria-label="ปิด">
          <Icon name="close" size={20} />
        </button>
        <span className="cmms-drawer-eyebrow">WORK ORDER</span>
        <div className="cmms-order-drawer-id">
          <WorkTypeBadge type={order.type} />
          <strong>{order.id}</strong>
        </div>
        <h2>{order.title}</h2>
        <div className="cmms-order-drawer-badges">
          <StatusBadge status={order.status} />
          <PriorityBadge priority={order.priority} />
        </div>
        <div className="cmms-progress-block">
          <div><span>ความคืบหน้า</span><strong>{order.progress}%</strong></div>
          <i><span style={{ width: `${order.progress}%` }} /></i>
        </div>
        <dl className="cmms-detail-list">
          <div><dt>เครื่องจักร</dt><dd>{order.assetId}<small>{order.assetName}</small></dd></div>
          <div><dt>ไซต์</dt><dd>{order.site}</dd></div>
          <div><dt>ผู้รับผิดชอบ</dt><dd>{order.assignee}</dd></div>
          <div><dt>กำหนดเสร็จ</dt><dd>{order.due}</dd></div>
          <div><dt>สร้างเมื่อ</dt><dd>{order.created}</dd></div>
          {asset && <div><dt>ข้อมูล Sensor</dt><dd>{asset.sensor}</dd></div>}
        </dl>
        <div className="cmms-drawer-section">
          <h3>กิจกรรม</h3>
          <div className="cmms-timeline">
            <p><i /><span><strong>สร้างใบงาน</strong><small>{order.created} • System</small></span></p>
            {order.status !== "รอมอบหมาย" && <p><i /><span><strong>มอบหมายให้ {order.assignee}</strong><small>28 ก.ค. 09:18 • Service Manager</small></span></p>}
            {order.progress > 0 && <p><i /><span><strong>อัปเดตผลการดำเนินงาน {order.progress}%</strong><small>วันนี้ 10:12 • {order.assignee}</small></span></p>}
          </div>
        </div>
        {canOperate && (
          <div className="cmms-drawer-actions">
            <button className="cmms-secondary-button" type="button">เพิ่มบันทึก</button>
            {nextAction && (
              <button className="cmms-primary-button" type="button" onClick={() => onUpdateStatus(order.id, nextAction.status)}>
                <Icon name="check" size={17} />{nextAction.label}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function UserProfileModal({
  user,
  activeJobsite,
  allowedJobsiteCount,
  onClose,
  onLogout,
}: {
  user: DemoUser;
  activeJobsite: Jobsite;
  allowedJobsiteCount: number;
  onClose: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="cmms-modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="cmms-user-profile-title"
        aria-modal="true"
        className="cmms-user-profile-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="cmms-user-profile-heading">
          <div className="cmms-user-profile-avatar">{user.initials}</div>
          <div>
            <span>USER PROFILE</span>
            <h2 id="cmms-user-profile-title">{user.displayName}</h2>
            <p>{user.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิดข้อมูลผู้ใช้งาน">
            <Icon name="close" size={20} />
          </button>
        </div>
        <dl className="cmms-user-profile-details">
          <div><dt>ชื่อเข้าสู่ระบบ</dt><dd>{user.username}</dd></div>
          <div><dt>บทบาท</dt><dd>{roleLabels[user.role]}</dd></div>
          <div><dt>สิทธิ์การใช้งาน</dt><dd>{user.title}</dd></div>
          <div><dt>ไซต์ปัจจุบัน</dt><dd>{activeJobsite.name}</dd></div>
          <div><dt>พื้นที่ที่เข้าถึงได้</dt><dd>{allowedJobsiteCount} Jobsite</dd></div>
          <div><dt>สถานะบัญชี</dt><dd><span><i />ใช้งานอยู่</span></dd></div>
        </dl>
        <div className="cmms-user-profile-actions">
          <button className="cmms-secondary-button" type="button" onClick={onClose}>ปิด</button>
          <button className="cmms-user-profile-logout" type="button" onClick={onLogout}>
            <Icon name="logout" size={18} />ออกจากระบบ
          </button>
        </div>
      </section>
    </div>
  );
}

export default function CMMSApp({
  currentUser,
  activeJobsite,
  allowedJobsites,
  masterData,
  onMasterDataChange,
  onChangeJobsite,
  onLogout,
}: {
  currentUser: DemoUser;
  activeJobsite: Jobsite;
  allowedJobsites: Jobsite[];
  masterData: MasterDataState;
  onMasterDataChange: Dispatch<SetStateAction<MasterDataState>>;
  onChangeJobsite: () => void;
  onLogout: () => void;
}) {
  const [activePage, setActivePage] = useState<Page>(() => currentUser.role === "engineer" ? "service-reports" : "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workOrders, setWorkOrders] = useState(initialWorkOrders);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [maintenanceState, setMaintenanceState] = useState<MaintenanceState>(() => loadMaintenanceState());
  const [maintenanceRemoteLoading, setMaintenanceRemoteLoading] = useState(isSupabaseConfigured);
  const remoteMaintenanceBaseline = useRef<MaintenanceState | null>(null);
  const maintenanceSyncTimer = useRef<number | null>(null);
  const maintenanceSyncQueue = useRef(Promise.resolve());
  const [operationsRemoteLoading, setOperationsRemoteLoading] = useState(isSupabaseConfigured);
  const remoteOperationsBaseline = useRef<OperationsState | null>(null);
  const operationsSyncTimer = useRef<number | null>(null);
  const operationsSyncQueue = useRef(Promise.resolve());
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [presetAlert, setPresetAlert] = useState<AlertItem | null>(null);
  const [toast, setToast] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "ThaiCon CMMS — Maintenance Operations";
    document.documentElement.lang = "th";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!isSupabaseConfigured) saveMaintenanceState(maintenanceState);
  }, [maintenanceState]);

  const allowedJobsiteKey = allowedJobsites.map((site) => site.id).sort().join(",");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    setMaintenanceRemoteLoading(true);
    loadSupabaseMaintenanceState(allowedJobsiteKey.split(",").filter(Boolean))
      .then((remoteState) => {
        if (cancelled) return;
        remoteMaintenanceBaseline.current = structuredClone(remoteState);
        setMaintenanceState(remoteState);
        setMaintenanceRemoteLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to load maintenance workflow", error);
        remoteMaintenanceBaseline.current = null;
        setMaintenanceRemoteLoading(false);
        setToast("โหลดข้อมูลงานจาก Supabase ไม่สำเร็จ ระบบยังไม่บันทึกการแก้ไข");
      });
    return () => {
      cancelled = true;
    };
  }, [allowedJobsiteKey, currentUser.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || maintenanceRemoteLoading || !remoteMaintenanceBaseline.current) return;
    if (maintenanceSyncTimer.current) window.clearTimeout(maintenanceSyncTimer.current);
    const snapshot = structuredClone(maintenanceState);
    maintenanceSyncTimer.current = window.setTimeout(() => {
      maintenanceSyncQueue.current = maintenanceSyncQueue.current
        .then(async () => {
          const previous = remoteMaintenanceBaseline.current;
          if (!previous) return;
          await syncSupabaseMaintenanceState(previous, snapshot, currentUser.id);
          remoteMaintenanceBaseline.current = structuredClone(snapshot);
        })
        .catch((error) => {
          console.error("Unable to sync maintenance workflow", error);
          setToast("บันทึกข้อมูลไปยัง Supabase ไม่สำเร็จ กรุณาลองใหม่");
        });
    }, 450);
    return () => {
      if (maintenanceSyncTimer.current) window.clearTimeout(maintenanceSyncTimer.current);
    };
  }, [currentUser.id, maintenanceRemoteLoading, maintenanceState]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    setOperationsRemoteLoading(true);
    loadSupabaseOperationsState(allowedJobsiteKey.split(",").filter(Boolean), masterData.jobsites, masterData.assets)
      .then((remoteState) => {
        if (cancelled) return;
        remoteOperationsBaseline.current = structuredClone(remoteState);
        setWorkOrders(remoteState.workOrders);
        setAlerts(remoteState.alerts);
        setOperationsRemoteLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to load operations workflow", error);
        remoteOperationsBaseline.current = null;
        setOperationsRemoteLoading(false);
        setToast("โหลด Work Order และ Alarm จาก Supabase ไม่สำเร็จ");
      });
    return () => { cancelled = true; };
  }, [allowedJobsiteKey, currentUser.id, masterData.assets, masterData.jobsites]);

  useEffect(() => {
    if (!isSupabaseConfigured || operationsRemoteLoading || !remoteOperationsBaseline.current) return;
    if (operationsSyncTimer.current) window.clearTimeout(operationsSyncTimer.current);
    const snapshot: OperationsState = structuredClone({ workOrders, alerts });
    operationsSyncTimer.current = window.setTimeout(() => {
      operationsSyncQueue.current = operationsSyncQueue.current
        .then(async () => {
          const previous = remoteOperationsBaseline.current;
          if (!previous) return;
          await syncSupabaseOperationsState(previous, snapshot, currentUser.id, masterData.jobsites);
          remoteOperationsBaseline.current = structuredClone(snapshot);
        })
        .catch((error) => {
          console.error("Unable to sync operations workflow", error);
          setToast("บันทึก Work Order หรือ Alarm ไปยัง Supabase ไม่สำเร็จ");
        });
    }, 450);
    return () => {
      if (operationsSyncTimer.current) window.clearTimeout(operationsSyncTimer.current);
    };
  }, [alerts, currentUser.id, masterData.jobsites, operationsRemoteLoading, workOrders]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const logout = () => {
    setProfileMenuOpen(false);
    setProfileModalOpen(false);
    onLogout();
  };

  const navigate = (page: Page) => {
    if (!pagesByRole[currentUser.role].includes(page)) {
      setToast("บัญชีนี้ไม่มีสิทธิ์เปิดเมนูดังกล่าว");
      return;
    }
    setActivePage(page);
    setSidebarOpen(false);
    setGlobalSearch("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const returnToJobsiteSelection = () => {
    setSidebarOpen(false);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    onChangeJobsite();
  };

  const createOrder = (order: WorkOrder) => {
    setWorkOrders((current) => [order, ...current]);
    setCreateOpen(false);
    setPresetAlert(null);
    setToast(`สร้างใบงาน ${order.id} แล้ว`);
    setActivePage("work-orders");
  };

  const updateOrderStatus = (id: string, status: WorkStatus) => {
    setWorkOrders((current) =>
      current.map((order) =>
        order.id === id
          ? {
              ...order,
              status,
              progress:
                status === "กำลังดำเนินการ"
                  ? Math.max(order.progress, 15)
                  : status === "รอตรวจรับ"
                    ? 90
                    : status === "เสร็จสิ้น"
                      ? 100
                      : order.progress,
            }
          : order,
      ),
    );
    setSelectedOrder((current) =>
      current?.id === id
        ? {
            ...current,
            status,
            progress:
              status === "กำลังดำเนินการ"
                ? Math.max(current.progress, 15)
                : status === "รอตรวจรับ"
                  ? 90
                  : status === "เสร็จสิ้น"
                    ? 100
                    : current.progress,
          }
        : current,
    );
    if (status === "รอตรวจรับ") {
      setSelectedOrder(null);
      setActivePage("service-reports");
      setToast(`อัปเดต ${id} แล้ว กรุณาสร้าง Service Report เพื่อส่งอนุมัติ`);
    } else {
      setToast(`อัปเดต ${id} เป็น “${status}” แล้ว`);
    }
  };

  const openOrderFromAlert = (alert: AlertItem) => {
    setPresetAlert(alert);
    setCreateOpen(true);
  };

  const allowedPages = pagesByRole[currentUser.role];
  const visibleNavItems = navItems.filter((item) => allowedPages.includes(item.id));
  const canOperate = currentUser.role !== "user";
  const scopedWorkOrders = workOrders.filter((order) => order.site === activeJobsite.name);
  const scopedAlerts = alerts.filter((alert) => alert.site === activeJobsite.name);
  const scopedAssets: Asset[] = masterData.assets
    .filter((asset) => asset.active && asset.jobsiteId === activeJobsite.id)
    .map((asset) => ({ ...asset, site: activeJobsite.name }));
  const scopedSchedule = pmSchedule.filter((item) => item.site === activeJobsite.name);
  const pageMeta = pageTitles[activePage];
  const currentPage = {
    ...pageMeta,
    subtitle: `${pageMeta.subtitle} • ${activeJobsite.name}`,
  };

  return (
    <main className="cmms-shell">
      <aside className={`cmms-sidebar ${sidebarOpen ? "open" : ""}`}>
        <a className="cmms-brand" href="#/cmms" aria-label="ThaiCon CMMS">
          <img src={`${import.meta.env.BASE_URL}brand/thaicon-logo.jpg`} alt="" />
          <span><strong>ThaiCon</strong><small>MAINTENANCE CLOUD</small></span>
        </a>
        <div className="cmms-sidebar-caption">OPERATIONS</div>
        <nav>
          {visibleNavItems.map((item) => (
            <button
              className={activePage === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === "alerts" && scopedAlerts.filter((alert) => !alert.acknowledged).length > 0 && (
                <em>{scopedAlerts.filter((alert) => !alert.acknowledged).length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="cmms-sidebar-bottom">
          <button className="cmms-active-jobsite" type="button" onClick={returnToJobsiteSelection}>
            <span><i />JOBSITE ปัจจุบัน</span>
            <strong>{activeJobsite.name}</strong>
            <small>{activeJobsite.id} • เปลี่ยนไซต์</small>
          </button>
          <button className="cmms-back-to-sites" type="button" onClick={returnToJobsiteSelection}>
            <Icon name="logout" size={18} /><span>กลับสู่หน้าเลือกไซต์</span>
          </button>
        </div>
      </aside>
      {sidebarOpen && <button className="cmms-mobile-overlay" aria-label="ปิดเมนู" type="button" onClick={() => setSidebarOpen(false)} />}

      <div className="cmms-main">
        <header className="cmms-topbar">
          <div className="cmms-topbar-title">
            <button className="cmms-mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="เปิดเมนู">
              <Icon name="menu" size={21} />
            </button>
            <div><h1>{currentPage.title}</h1><p>{currentPage.subtitle}</p></div>
          </div>
          <div className="cmms-topbar-actions">
            <label className="cmms-global-search">
              <Icon name="search" size={18} />
              <input
                aria-label="ค้นหาในระบบ"
                placeholder={activePage === "iot" ? "ค้นหาไซต์, Device, Alarm..." : "ค้นหาใบงาน, Asset, ไซต์..."}
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            {canOperate && (
              <button className="cmms-notification" type="button" aria-label="การแจ้งเตือน">
                <Icon name="bell" size={20} />
                <i>{scopedAlerts.filter((alert) => !alert.acknowledged).length}</i>
              </button>
            )}
            <div className="cmms-user-menu-wrap" ref={profileMenuRef}>
              <button
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                aria-label="เปิดเมนูผู้ใช้งาน"
                className={`cmms-profile ${profileMenuOpen ? "open" : ""}`}
                type="button"
                onClick={() => setProfileMenuOpen((current) => !current)}
              >
                <span>{currentUser.initials}</span>
                <p><strong>{currentUser.displayName}</strong><small>{roleLabels[currentUser.role]}</small></p>
                <Icon name="arrow" size={14} />
              </button>
              {profileMenuOpen && (
                <div className="cmms-user-menu" role="menu">
                  <div className="cmms-user-menu-summary">
                    <span>{currentUser.initials}</span>
                    <p><strong>{currentUser.displayName}</strong><small>{currentUser.username} • {currentUser.title}</small></p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setProfileModalOpen(true);
                    }}
                  >
                    <Icon name="user" size={18} />
                    <span><strong>ข้อมูลผู้ใช้งาน</strong><small>ดูชื่อ บทบาท และสิทธิ์</small></span>
                  </button>
                  <button className="danger" type="button" role="menuitem" onClick={logout}>
                    <Icon name="logout" size={18} />
                    <span><strong>ออกจากระบบ</strong><small>กลับไปยังหน้าเข้าสู่ระบบ</small></span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="cmms-mobile-page-title">
          <h1>{currentPage.title}</h1>
          <p>{currentPage.subtitle}</p>
        </div>

        <div className="cmms-demo-note">
          <span>{isSupabaseConfigured ? "ระบบออนไลน์" : "ระบบทดสอบ"}</span>
          {isSupabaseConfigured ? (maintenanceRemoteLoading || operationsRemoteLoading ? "กำลังโหลดข้อมูล" : "Supabase") : "ข้อมูลจำลอง"}
        </div>

        <div className="cmms-content">
          {activePage === "dashboard" && (
            <DashboardPage
              alerts={scopedAlerts}
              orders={scopedWorkOrders}
              schedule={scopedSchedule}
              siteAssets={scopedAssets}
              pmCompliance={activeJobsite.pmCompliance}
              maintenanceState={maintenanceState}
              jobsiteId={activeJobsite.id}
              canOperate={canOperate}
              onCreate={() => setCreateOpen(true)}
              onNavigate={navigate}
              onSelectOrder={setSelectedOrder}
            />
          )}
          {activePage === "work-orders" && (
            <WorkOrdersPage orders={scopedWorkOrders} canOperate={canOperate} onSelect={setSelectedOrder} onCreate={() => setCreateOpen(true)} />
          )}
          {activePage === "pm" && (
            <MaintenancePlansPage
              activeJobsite={activeJobsite}
              currentUser={currentUser}
              assets={scopedAssets}
              state={maintenanceState}
              setState={setMaintenanceState}
              onToast={setToast}
            />
          )}
          {activePage === "service-reports" && (
            <ServiceReportsPage
              activeJobsite={activeJobsite}
              currentUser={currentUser}
              assets={scopedAssets}
              state={maintenanceState}
              setState={setMaintenanceState}
              onToast={setToast}
              onReportApproved={(report) => {
                if (!report.workOrderId) return;
                setWorkOrders((current) => current.map((order) => order.id === report.workOrderId ? { ...order, status: "เสร็จสิ้น", progress: 100 } : order));
              }}
            />
          )}
          {activePage === "repair-requests" && (
            <RepairRequestsPage
              activeJobsite={activeJobsite}
              currentUser={currentUser}
              assets={scopedAssets}
              state={maintenanceState}
              setState={setMaintenanceState}
              onToast={setToast}
            />
          )}
          {activePage === "assets" && <AssetsPage siteAssets={scopedAssets} />}
          {activePage === "sites" && <SitesPage sites={allowedJobsites} />}
          {activePage === "alerts" && (
            <AlertsPage
              alerts={scopedAlerts}
              canOperate={canOperate}
              onAcknowledge={(id) => {
                setAlerts((current) => current.map((alert) => alert.id === id ? { ...alert, acknowledged: true } : alert));
                setToast(`รับทราบ Alarm ${id} แล้ว`);
              }}
              onCreateOrder={openOrderFromAlert}
            />
          )}
          {activePage === "reports" && <PerformanceReportsPage activeJobsite={activeJobsite} state={maintenanceState} />}
          {activePage === "iot" && <IoTMonitor jobsiteId={activeJobsite.id} searchTerm={globalSearch} onNotify={setToast} />}
          {activePage === "admin" && (
            <AdminWorkspace
              currentUser={currentUser}
              state={masterData}
              setState={onMasterDataChange}
              onToast={setToast}
              onlineMode={isSupabaseConfigured}
            />
          )}
        </div>
      </div>

      {createOpen && canOperate && scopedAssets.length > 0 && (
        <CreateWorkOrderModal
          siteAssets={scopedAssets}
          onClose={() => {
            setCreateOpen(false);
            setPresetAlert(null);
          }}
          onSubmit={createOrder}
          presetAlert={presetAlert}
        />
      )}
      {selectedOrder && (
        <WorkOrderDrawer
          order={selectedOrder}
          siteAssets={scopedAssets}
          canOperate={canOperate}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={updateOrderStatus}
        />
      )}
      {profileModalOpen && (
        <UserProfileModal
          user={currentUser}
          activeJobsite={activeJobsite}
          allowedJobsiteCount={allowedJobsites.length}
          onClose={() => setProfileModalOpen(false)}
          onLogout={logout}
        />
      )}
      {toast && <div className="cmms-toast"><Icon name="check" size={18} />{toast}</div>}
    </main>
  );
}
