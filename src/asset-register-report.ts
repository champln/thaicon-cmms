import type { ManagedAsset, AssetHealth } from "./master-data";
import type { ExcelSheet } from "./excel-export";
import { instantMillis } from "./work-order-timing";

export type AssetFilters = { query: string; health: "ทั้งหมด" | AssetHealth };
export function filterRegisteredAssets<T extends ManagedAsset>(assets: readonly T[], filters: AssetFilters, siteName = ""): T[] {
  const query = filters.query.trim().toLowerCase();
  return assets.filter(a => (!query || [a.id, a.name, a.type, siteName, a.location, a.building, a.floor, a.room, a.manufacturer, a.model, a.serialNumber].join(" ").toLowerCase().includes(query)) &&
    (filters.health === "ทั้งหมด" || a.health === filters.health));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function buildAssetRegisterReport(input: {
  assets: readonly ManagedAsset[]; filters: AssetFilters; siteId: string; siteName: string;
  verified: boolean; evaluatedAt: string; mode: "online" | "demo";
}) {
  if (!input.verified || !input.siteId || instantMillis(input.evaluatedAt) == null) throw new Error("ยังยืนยันทะเบียนเครื่องจักรไม่ได้");
  if (!["ทั้งหมด", "ปกติ", "เฝ้าระวัง", "วิกฤต"].includes(input.filters.health)) throw new Error("ตัวกรองสถานะไม่ถูกต้อง");
  if (input.assets.some(a => a.jobsiteId !== input.siteId || !a.id || a.active !== true) || new Set(input.assets.map(a => a.id)).size !== input.assets.length) throw new Error("ทะเบียนเครื่องจักรผิดขอบเขตหรือรหัสซ้ำ");
  const assets = filterRegisteredAssets(input.assets, input.filters, input.siteName);
  const text = (v: string | null | undefined) => v?.trim() ? v : "ยังไม่ระบุ";
  const sheets: ExcelSheet[] = [
    { name: "สรุปทะเบียน", headers: ["รายการ", "ค่า"], rows: [
      ["รหัสไซต์", input.siteId], ["ไซต์", input.siteName], ["เครื่องจักรใช้งานในชุดที่โหลดครบ", input.assets.length],
      ["เครื่องจักรตามตัวกรอง", assets.length],
      ...(["ปกติ", "เฝ้าระวัง", "วิกฤต"] as const).map(health => [health, assets.filter(a => a.health === health).length]),
      ["ไม่ทราบสถานะ", assets.filter(a => !["ปกติ", "เฝ้าระวัง", "วิกฤต"].includes(a.health)).length],
      ["ยังไม่ระบุผู้ผลิต", assets.filter(a => !a.manufacturer?.trim()).length],
      ["ยังไม่ระบุรุ่น", assets.filter(a => !a.model?.trim()).length],
      ["ยังไม่ระบุ Serial Number", assets.filter(a => !a.serialNumber?.trim()).length],
    ] },
    { name: "ทะเบียนเครื่องจักร", headers: ["รหัสไซต์", "รหัสเครื่อง", "ชื่อเครื่อง", "ประเภท", "ตำแหน่งเดิม", "รหัสตำแหน่ง", "อาคาร", "ชั้น", "ห้อง", "ผู้ผลิต", "รุ่น", "Serial Number", "สถานะในทะเบียน", "การใช้งาน"], rows: assets.map(a => [
      input.siteId, a.id, text(a.name), text(a.type), text(a.location), text(a.locationId), text(a.building), text(a.floor), text(a.room),
      text(a.manufacturer), text(a.model), text(a.serialNumber), text(a.health), "ใช้งาน",
    ]) },
    { name: "ขอบเขตรายงาน", headers: ["รายการ", "ค่า"], rows: [
      ["เวลาประเมิน UTC", input.evaluatedAt], ["แหล่งข้อมูล", input.mode === "demo" ? "ข้อมูลจำลอง" : "ทะเบียนออนไลน์ที่โหลดสำเร็จครบตามสิทธิ์"],
      ["คำค้น", input.filters.query], ["ตัวกรองสถานะ", input.filters.health], ["การใช้งาน", "เฉพาะเครื่องจักรที่ยังใช้งานในไซต์ที่เลือก ไม่รวมเครื่องปิดใช้งาน"],
      ["สถานะ", "สถานะที่บันทึกในทะเบียน ไม่ใช่ผลรับรอง Sensor หรือ IoT แบบ Real-time"],
      ["ข้อมูลที่ยังไม่ระบุ", "แสดงตามข้อมูลต้นทาง ไม่เดาผู้ผลิต รุ่น Serial หรือตำแหน่งจากชื่อเครื่อง"],
      ["ข้อจำกัด", "ภาพข้อมูลที่โหลดครบในหน้าจอ ไม่ใช่ snapshot ฐานข้อมูลใน transaction เดียว ไม่รวมประวัติซ่อม/PM/วัสดุ ไม่ใช่หลักฐานรับรอง UAT"],
    ] },
  ];
  return freeze({ siteId: input.siteId, title: "รายงานทะเบียนเครื่องจักร", evaluatedAt: input.evaluatedAt, sheets, count: assets.length });
}
export function assetRegisterPdfSections(report: ReturnType<typeof buildAssetRegisterReport>) {
  return report.sheets.flatMap(sheet => sheet.rows.map((row, i) => ({
    label: sheet.headers.length === 2 ? String(row[0]) : `${sheet.name} #${i + 1}`,
    value: sheet.headers.length === 2 ? String(row[1]) : row.map((value, n) => `${sheet.headers[n]}: ${value}`).join("\n"),
  })));
}
