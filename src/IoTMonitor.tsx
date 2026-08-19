import { useEffect, useMemo, useState } from "react";

type Health = "healthy" | "warning" | "critical" | "offline";
type Connection = "online" | "stale" | "offline";

type Site = {
  id: string;
  name: string;
  province: string;
  type: string;
  status: Health;
  gatewayOnline: number;
  gatewayTotal: number;
  reportingDevices: number;
  totalDevices: number;
  critical: number;
  warning: number;
  lastSeen: string;
  temperature: number;
  humidity: number;
  energy: number;
};

type IotAsset = {
  id: string;
  siteId: string;
  name: string;
  type: string;
  location: string;
  status: Health;
  connection: Connection;
  lastSeen: string;
  primary: {
    label: string;
    value: number;
    unit: string;
    warning: number;
    critical: number;
  };
  secondary: { label: string; value: number; unit: string };
};

type IotAlarm = {
  id: string;
  siteId: string;
  assetId: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
  value: string;
  occurredAt: string;
  acknowledged: boolean;
  workOrderId?: string;
};

const sites: Site[] = [
  { id: "SITE-001", name: "โรงพยาบาลกลาง", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", status: "critical", gatewayOnline: 2, gatewayTotal: 2, reportingDevices: 138, totalDevices: 142, critical: 1, warning: 3, lastSeen: "8 วินาทีที่แล้ว", temperature: 24.6, humidity: 57.8, energy: 428.6 },
  { id: "SITE-002", name: "โรงพยาบาลนพรัตนราชธานี", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", status: "healthy", gatewayOnline: 2, gatewayTotal: 2, reportingDevices: 119, totalDevices: 120, critical: 0, warning: 1, lastSeen: "12 วินาทีที่แล้ว", temperature: 23.9, humidity: 55.2, energy: 386.2 },
  { id: "SITE-003", name: "โรงพยาบาลสิรินธร", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", status: "warning", gatewayOnline: 1, gatewayTotal: 1, reportingDevices: 94, totalDevices: 98, critical: 0, warning: 4, lastSeen: "18 วินาทีที่แล้ว", temperature: 25.2, humidity: 61.4, energy: 301.8 },
  { id: "SITE-004", name: "มหาวิทยาลัยธรรมศาสตร์", province: "ปทุมธานี", type: "มหาวิทยาลัย", status: "healthy", gatewayOnline: 2, gatewayTotal: 2, reportingDevices: 75, totalDevices: 76, critical: 0, warning: 0, lastSeen: "6 วินาทีที่แล้ว", temperature: 24.1, humidity: 53.6, energy: 274.5 },
  { id: "SITE-005", name: "โรงพยาบาลพญาไท 2", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", status: "warning", gatewayOnline: 1, gatewayTotal: 1, reportingDevices: 110, totalDevices: 114, critical: 0, warning: 2, lastSeen: "24 วินาทีที่แล้ว", temperature: 24.8, humidity: 59.1, energy: 352.3 },
  { id: "SITE-006", name: "โรงพยาบาลพญาไท 3", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", status: "offline", gatewayOnline: 0, gatewayTotal: 1, reportingDevices: 0, totalDevices: 88, critical: 2, warning: 2, lastSeen: "12 นาทีที่แล้ว", temperature: 0, humidity: 0, energy: 0 },
];

const assets: IotAsset[] = [
  { id: "CR-DP-02", siteId: "SITE-001", name: "Differential Pressure ห้องผ่าตัด 2", type: "Clean Room", location: "อาคารศัลยกรรม ชั้น 4", status: "critical", connection: "online", lastSeen: "8 วินาทีที่แล้ว", primary: { label: "แรงดันห้อง", value: 7.2, unit: "Pa", warning: 12, critical: 10 }, secondary: { label: "อุณหภูมิ", value: 23.8, unit: "°C" } },
  { id: "AHU-OPD-01", siteId: "SITE-001", name: "AHU อาคารผู้ป่วยนอก", type: "AHU", location: "อาคาร OPD ชั้น 5", status: "warning", connection: "online", lastSeen: "11 วินาทีที่แล้ว", primary: { label: "ลมจ่าย", value: 16.8, unit: "°C", warning: 17.5, critical: 19 }, secondary: { label: "กระแสมอเตอร์", value: 8.7, unit: "A" } },
  { id: "CHLR-01", siteId: "SITE-001", name: "Chiller Plant 1", type: "Chiller", location: "อาคารพลังงาน", status: "healthy", connection: "online", lastSeen: "9 วินาทีที่แล้ว", primary: { label: "กำลังไฟฟ้า", value: 142.6, unit: "kW", warning: 175, critical: 195 }, secondary: { label: "COP", value: 5.4, unit: "" } },
  { id: "FREEZER-PH-03", siteId: "SITE-001", name: "ตู้แช่ยา Pharmacy 03", type: "Medical Freezer", location: "ห้องเภสัชกรรม", status: "healthy", connection: "online", lastSeen: "14 วินาทีที่แล้ว", primary: { label: "อุณหภูมิ", value: 3.6, unit: "°C", warning: 6, critical: 8 }, secondary: { label: "ความชื้น", value: 47.2, unit: "%" } },
  { id: "AHU-IPD-04", siteId: "SITE-002", name: "AHU หอผู้ป่วยใน 04", type: "AHU", location: "อาคารผู้ป่วยใน ชั้น 7", status: "healthy", connection: "online", lastSeen: "12 วินาทีที่แล้ว", primary: { label: "ลมจ่าย", value: 15.9, unit: "°C", warning: 17.5, critical: 19 }, secondary: { label: "กระแสมอเตอร์", value: 7.9, unit: "A" } },
  { id: "CR-HUM-01", siteId: "SITE-003", name: "Humidity ห้องเตรียมยา", type: "Clean Room", location: "อาคารเภสัชกรรม ชั้น 2", status: "warning", connection: "stale", lastSeen: "4 นาทีที่แล้ว", primary: { label: "ความชื้นสัมพัทธ์", value: 66.4, unit: "%", warning: 65, critical: 70 }, secondary: { label: "อุณหภูมิ", value: 25.1, unit: "°C" } },
  { id: "BMS-GW-01", siteId: "SITE-004", name: "BMS Main Gateway", type: "IoT Gateway", location: "ห้อง Control กลาง", status: "healthy", connection: "online", lastSeen: "6 วินาทีที่แล้ว", primary: { label: "CPU Load", value: 31.2, unit: "%", warning: 75, critical: 90 }, secondary: { label: "อุปกรณ์เชื่อมต่อ", value: 76, unit: "" } },
  { id: "AHU-ICU-02", siteId: "SITE-005", name: "AHU ห้อง ICU 02", type: "AHU", location: "อาคารผู้ป่วยวิกฤต ชั้น 6", status: "warning", connection: "online", lastSeen: "24 วินาทีที่แล้ว", primary: { label: "Filter Differential", value: 188, unit: "Pa", warning: 180, critical: 220 }, secondary: { label: "กระแสมอเตอร์", value: 9.1, unit: "A" } },
  { id: "IOT-GW-PT3", siteId: "SITE-006", name: "IoT Gateway อาคารหลัก", type: "IoT Gateway", location: "ห้องระบบ ชั้น B1", status: "offline", connection: "offline", lastSeen: "12 นาทีที่แล้ว", primary: { label: "Network latency", value: 0, unit: "ms", warning: 500, critical: 1000 }, secondary: { label: "อุปกรณ์เชื่อมต่อ", value: 0, unit: "" } },
];

const initialAlarms: IotAlarm[] = [
  { id: "ALM-2607-084", siteId: "SITE-001", assetId: "CR-DP-02", severity: "critical", title: "แรงดันห้องผ่าตัดต่ำกว่าเกณฑ์", detail: "ตรวจพบแรงดันต่ำกว่า 10 Pa ต่อเนื่อง 6 นาที", value: "7.2 Pa", occurredAt: "วันนี้ 10:24", acknowledged: false },
  { id: "ALM-2607-083", siteId: "SITE-006", assetId: "IOT-GW-PT3", severity: "critical", title: "Gateway ขาดการเชื่อมต่อ", detail: "ไม่ได้รับ Heartbeat จาก Gateway เกิน 10 นาที", value: "12 นาที", occurredAt: "วันนี้ 10:20", acknowledged: false },
  { id: "ALM-2607-081", siteId: "SITE-003", assetId: "CR-HUM-01", severity: "warning", title: "ความชื้นห้องเตรียมยาสูง", detail: "ความชื้นสูงกว่า 65% ต่อเนื่อง 4 นาที", value: "66.4%", occurredAt: "วันนี้ 10:16", acknowledged: false },
  { id: "ALM-2607-079", siteId: "SITE-005", assetId: "AHU-ICU-02", severity: "warning", title: "Filter differential สูง", detail: "แนวโน้มความดันคร่อม Filter สูงเกินค่าเฝ้าระวัง", value: "188 Pa", occurredAt: "วันนี้ 09:48", acknowledged: true },
];

const statusLabels: Record<Health, string> = {
  healthy: "ปกติ",
  warning: "เฝ้าระวัง",
  critical: "วิกฤต",
  offline: "ขาดการเชื่อมต่อ",
};

const connectionLabels: Record<Connection, string> = {
  online: "Online",
  stale: "ข้อมูลล่าช้า",
  offline: "Offline",
};

const numberFormat = new Intl.NumberFormat("th-TH");

function TelemetryDrawer({ asset, onClose }: { asset: IotAsset; onClose: () => void }) {
  const [range, setRange] = useState<"1h" | "24h" | "7d">("24h");
  const points = useMemo(() => {
    const count = range === "1h" ? 12 : range === "24h" ? 24 : 28;
    const base = asset.primary.value || asset.primary.warning * 0.72;
    const amplitude = Math.max(Math.abs(base) * 0.075, 0.8);
    const values = Array.from({ length: count }, (_, index) =>
      index === count - 1
        ? asset.primary.value
        : base + Math.sin((index + asset.id.length) * 0.62) * amplitude,
    );
    const min = Math.min(...values, asset.primary.warning, asset.primary.critical);
    const max = Math.max(...values, asset.primary.warning, asset.primary.critical);
    const span = Math.max(max - min, 1);
    return values
      .map((value, index) => {
        const x = 14 + (index / Math.max(count - 1, 1)) * 382;
        const y = 156 - ((value - min) / span) * 142;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [asset, range]);

  return (
    <div className="iot-drawer-backdrop" onMouseDown={onClose}>
      <aside className="iot-drawer" role="dialog" aria-modal="true" aria-labelledby="iot-device-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="iot-drawer-top">
          <div>
            <span className="iot-drawer-eyebrow">CONNECTED ASSET • {asset.id}</span>
            <h2 id="iot-device-title">{asset.name}</h2>
            <p>{sites.find((site) => site.id === asset.siteId)?.name} • {asset.location}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิดรายละเอียด">×</button>
        </div>
        <div className="iot-current-reading">
          <span>{asset.primary.label}</span>
          <strong>{numberFormat.format(asset.primary.value)} {asset.primary.unit}</strong>
          <small>ข้อมูลล่าสุด {asset.lastSeen}</small>
          <em className={`iot-health-badge ${asset.status}`}>{statusLabels[asset.status]}</em>
        </div>
        <section className="iot-chart-card">
          <div className="iot-chart-head">
            <strong>Telemetry ย้อนหลัง</strong>
            <div className="iot-range-tabs" aria-label="เลือกช่วงเวลา">
              {(["1h", "24h", "7d"] as const).map((item) => (
                <button className={range === item ? "active" : ""} type="button" onClick={() => setRange(item)} key={item}>{item.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <svg className="iot-chart" viewBox="0 0 410 170" role="img" aria-label={`กราฟ ${asset.primary.label}`}>
            <polyline points={points} fill="none" stroke="#0d79c5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </section>
        <dl className="iot-detail-list">
          <div><dt>ประเภทอุปกรณ์</dt><dd>{asset.type}</dd></div>
          <div><dt>การเชื่อมต่อ</dt><dd>{connectionLabels[asset.connection]}</dd></div>
          <div><dt>ค่ารอง</dt><dd>{asset.secondary.label} {numberFormat.format(asset.secondary.value)} {asset.secondary.unit}</dd></div>
          <div><dt>Warning threshold</dt><dd>{numberFormat.format(asset.primary.warning)} {asset.primary.unit}</dd></div>
          <div><dt>Critical threshold</dt><dd>{numberFormat.format(asset.primary.critical)} {asset.primary.unit}</dd></div>
          <div><dt>Protocol</dt><dd>MQTT over TLS • Demo Gateway</dd></div>
        </dl>
        <p className="iot-demo-note">ข้อมูลจำลองสำหรับทดสอบหน้าจอและ Workflow ก่อนเชื่อม Gateway และ MQTT จริง</p>
      </aside>
    </div>
  );
}

export default function IoTMonitor({
  jobsiteId,
  searchTerm,
  onNotify,
}: {
  jobsiteId: string;
  searchTerm: string;
  onNotify: (message: string) => void;
}) {
  const [activeSiteId, setActiveSiteId] = useState(jobsiteId);
  const [siteFilter, setSiteFilter] = useState<"all" | "issue" | "offline">("all");
  const [alarms, setAlarms] = useState(initialAlarms);
  const [selectedAsset, setSelectedAsset] = useState<IotAsset | null>(null);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const query = searchTerm.trim().toLocaleLowerCase("th");
  const matches = (...values: Array<string | undefined>) =>
    !query || values.some((value) => value?.toLocaleLowerCase("th").includes(query));

  useEffect(() => setActiveSiteId(jobsiteId), [jobsiteId]);

  const scopedSites = sites.filter((site) => site.id === jobsiteId);
  const filteredSites = scopedSites.filter((site) => {
    const filterMatch =
      siteFilter === "all" ||
      (siteFilter === "issue" && ["warning", "critical"].includes(site.status)) ||
      (siteFilter === "offline" && site.status === "offline");
    return filterMatch && matches(site.id, site.name, site.province, site.type);
  });
  const activeSite = scopedSites.find((site) => site.id === activeSiteId) ?? scopedSites[0];
  const visibleAssets = assets.filter(
    (asset) =>
      asset.siteId === activeSite.id &&
      matches(asset.id, asset.name, asset.type, asset.location, activeSite.name),
  );
  const visibleAlarms = alarms.filter((alarm) =>
    alarm.siteId === activeSite.id && matches(alarm.id, alarm.assetId, alarm.title, alarm.detail),
  );

  const energyBars = Array.from({ length: 18 }, (_, index) => {
    const base = activeSite.status === "offline" ? 5 : 48;
    return Math.max(5, Math.min(92, base + Math.sin(index * 0.72) * 22 + ((index * 13) % 19)));
  });

  const acknowledge = (id: string) => {
    setAlarms((current) => current.map((alarm) => alarm.id === id ? { ...alarm, acknowledged: true } : alarm));
    onNotify(`รับทราบ Alarm ${id} แล้ว`);
  };

  const createWorkOrder = (id: string) => {
    const workOrderId = `WO-IOT-${id.slice(-3)}`;
    setAlarms((current) => current.map((alarm) => alarm.id === id ? { ...alarm, workOrderId } : alarm));
    onNotify(`สร้างใบงาน ${workOrderId} จาก Alarm แล้ว`);
  };

  return (
    <div className="iot-page">
      <div className="iot-toolbar">
        <div>
          <span>IOT OPERATIONS • DEMO DATA ADAPTER</span>
          <h2>ศูนย์ติดตามอุปกรณ์ — {activeSite.name}</h2>
          <p>แสดงข้อมูลเฉพาะ Jobsite ที่เลือกและบัญชีนี้ได้รับอนุญาต</p>
        </div>
        <div className="iot-toolbar-actions">
          <small><i /> อัปเดตล่าสุด {lastUpdated.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
          <button type="button" onClick={() => { setLastUpdated(new Date()); onNotify("อัปเดตข้อมูล IoT ล่าสุดแล้ว"); }}>อัปเดตข้อมูล</button>
        </div>
      </div>

      <section className="iot-kpi-grid" aria-label="ตัวชี้วัด IoT">
        <article className="iot-kpi green"><span>สถานะไซต์</span><strong>{statusLabels[activeSite.status]}</strong><small>{activeSite.id} • {activeSite.lastSeen}</small><em>JOBSITE SCOPE</em></article>
        <article className="iot-kpi blue"><span>อุปกรณ์กำลังส่งข้อมูล</span><strong>{activeSite.reportingDevices}</strong><small>จากทั้งหมด {activeSite.totalDevices} อุปกรณ์</small><em>{Math.round((activeSite.reportingDevices / activeSite.totalDevices) * 100)}% REPORTING</em></article>
        <article className="iot-kpi amber"><span>Gateway Online</span><strong>{activeSite.gatewayOnline}/{activeSite.gatewayTotal}</strong><small>ข้อมูลเฉพาะไซต์ที่เลือก</small><em>MQTT/TLS</em></article>
        <article className="iot-kpi red"><span>Alarm ที่ยังเปิดอยู่</span><strong>{visibleAlarms.filter((alarm) => !alarm.acknowledged).length}</strong><small>{visibleAlarms.filter((alarm) => alarm.severity === "critical" && !alarm.acknowledged).length} Critical • {visibleAlarms.filter((alarm) => alarm.severity === "warning" && !alarm.acknowledged).length} Warning</small><em>ต้องติดตาม</em></article>
      </section>

      <div className="iot-grid primary">
        <section className="iot-panel">
          <div className="iot-panel-heading">
            <div><span>SITE HEALTH</span><h3>สถานะการเชื่อมต่อไซต์ที่เลือก</h3></div>
            <div className="iot-filter-group" aria-label="กรองสถานะไซต์">
              <button className={siteFilter === "all" ? "active" : ""} type="button" onClick={() => setSiteFilter("all")}>ทั้งหมด</button>
              <button className={siteFilter === "issue" ? "active" : ""} type="button" onClick={() => setSiteFilter("issue")}>ต้องติดตาม</button>
              <button className={siteFilter === "offline" ? "active" : ""} type="button" onClick={() => setSiteFilter("offline")}>Offline</button>
            </div>
          </div>
          <div className="iot-site-list">
            <div className="iot-site-list-header"><span>ไซต์งาน</span><span>Gateway</span><span>อุปกรณ์</span><span>Alarm</span><span /></div>
            {filteredSites.length === 0 && <div className="iot-empty">ไม่พบไซต์ที่ตรงกับเงื่อนไข</div>}
            {filteredSites.map((site) => (
              <button className={`iot-site-row ${site.id === activeSite.id ? "selected" : ""}`} type="button" onClick={() => setActiveSiteId(site.id)} key={site.id}>
                <span className="iot-site-name"><i className={site.status} /><span><strong>{site.name}</strong><small>{site.id} • {site.province}</small></span></span>
                <span className="iot-site-cell"><strong>{site.gatewayOnline}/{site.gatewayTotal}</strong><small>Gateway</small></span>
                <span className="iot-site-cell"><strong>{site.reportingDevices}/{site.totalDevices}</strong><small>Reporting</small></span>
                <span className={`iot-alarm-count ${site.critical + site.warning > 0 ? "has-alarm" : ""}`}>{site.critical + site.warning} Alarm</span>
                <span className="iot-chevron">›</span>
              </button>
            ))}
          </div>
        </section>

        <section className="iot-panel iot-live-panel">
          <div className="iot-panel-heading"><div><span>LIVE SITE</span><h3>ข้อมูลไซต์แบบ Real-time</h3></div><small>{activeSite.lastSeen}</small></div>
          <div className="iot-live-content">
            <div className="iot-live-heading"><p><strong>{activeSite.name}</strong><span>{activeSite.type} • {activeSite.province}</span></p><em className={`iot-health-badge ${activeSite.status}`}>{statusLabels[activeSite.status]}</em></div>
            <div className="iot-live-metrics">
              <article><span>อุณหภูมิเฉลี่ย</span><strong>{activeSite.status === "offline" ? "—" : `${activeSite.temperature.toFixed(1)}°C`}</strong><small>{activeSite.status === "offline" ? "ไม่พบข้อมูล" : "อยู่ในเกณฑ์"}</small></article>
              <article><span>ความชื้นเฉลี่ย</span><strong>{activeSite.status === "offline" ? "—" : `${activeSite.humidity.toFixed(1)}%`}</strong><small>{activeSite.status === "offline" ? "ไม่พบข้อมูล" : "ข้อมูลล่าสุด"}</small></article>
              <article><span>Energy วันนี้</span><strong>{activeSite.status === "offline" ? "—" : activeSite.energy.toFixed(1)}</strong><small>kWh</small></article>
            </div>
            <div className="iot-signal-block"><div><span>Energy Consumption — 24 ชั่วโมง</span><small>{activeSite.status === "offline" ? "No signal" : "Live data"}</small></div><div className="iot-mini-bars">{energyBars.map((height, index) => <i style={{ height: `${height}%` }} key={index} />)}</div></div>
            <footer><span>Gateway {activeSite.gatewayOnline}/{activeSite.gatewayTotal} Online</span><span>{activeSite.reportingDevices} จาก {activeSite.totalDevices} อุปกรณ์กำลังส่งข้อมูล</span></footer>
          </div>
        </section>
      </div>

      <div className="iot-grid secondary">
        <section className="iot-panel">
          <div className="iot-panel-heading"><div><span>CONNECTED ASSETS</span><h3>อุปกรณ์ที่ติดตาม — {activeSite.name}</h3></div><small>คลิกอุปกรณ์เพื่อดู Telemetry</small></div>
          <div className="iot-assets-list">
            {visibleAssets.length === 0 && <div className="iot-empty">ยังไม่มีอุปกรณ์ตัวอย่างในไซต์นี้ หรือไม่ตรงกับคำค้นหา</div>}
            {visibleAssets.map((asset) => (
              <article className="iot-asset-row" key={asset.id}>
                <div className="iot-asset-heading"><span className={`iot-device-icon ${asset.connection}`}>IoT</span><p><strong>{asset.name}</strong><span>{asset.id} • {asset.location}</span></p></div>
                <div className="iot-asset-metric"><span>{asset.primary.label}</span><strong>{numberFormat.format(asset.primary.value)} {asset.primary.unit}</strong></div>
                <div className="iot-asset-metric"><span>{asset.secondary.label}</span><strong>{numberFormat.format(asset.secondary.value)} {asset.secondary.unit}</strong></div>
                <span className={`iot-asset-status ${asset.status}`}>{statusLabels[asset.status]}</span>
                <button className="iot-open-asset" type="button" onClick={() => setSelectedAsset(asset)} aria-label={`เปิดรายละเอียด ${asset.name}`}>›</button>
              </article>
            ))}
          </div>
        </section>

        <section className="iot-panel">
          <div className="iot-panel-heading"><div><span>ACTIVE EVENTS</span><h3>Alarm ที่ต้องติดตาม</h3></div><small>{visibleAlarms.filter((alarm) => !alarm.acknowledged).length} รายการใหม่</small></div>
          <div className="iot-alarm-list">
            {visibleAlarms.map((alarm) => (
              <article className={`iot-alarm-item ${alarm.acknowledged ? "acknowledged" : ""}`} key={alarm.id}>
                <i className={alarm.severity} />
                <div>
                  <div className="iot-alarm-heading"><span>{alarm.id} • {alarm.assetId}</span><time>{alarm.occurredAt}</time></div>
                  <h4>{alarm.title}</h4><p>{alarm.detail}</p>
                  <div className="iot-alarm-meta"><strong>{alarm.value}</strong><div>
                    {!alarm.acknowledged ? <button type="button" onClick={() => acknowledge(alarm.id)}>รับทราบ</button> : <span>รับทราบแล้ว</span>}
                    <button className="primary" type="button" onClick={() => createWorkOrder(alarm.id)}>{alarm.workOrderId ?? "สร้างใบงาน"}</button>
                  </div></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
      {selectedAsset && <TelemetryDrawer asset={selectedAsset} onClose={() => setSelectedAsset(null)} />}
    </div>
  );
}
