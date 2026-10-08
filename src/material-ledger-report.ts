import type { WorkOrder } from "./CMMSApp";
import type { ExcelSheet } from "./excel-export";
import type { OrderMaterial } from "./work-order-materials";
import { filterWorkOrders, type OrderFilters } from "./work-order-filter";
import { buildOrderReport } from "./work-order-summary-report";
import { instantMillis } from "./work-order-timing";

export type MaterialBatch = { orderId: string; materials: readonly OrderMaterial[] };
export type MaterialLedgerReport = {
  title: string; siteId: string; evaluatedAt: string; orderCount: number;
  activeCount: number; voidCount: number; sheets: ExcelSheet[];
};

// Parse the stored decimal representation, not quantity * 10000 (binary float).
// Each source value follows numeric(14,4); sums may exceed Number.MAX_SAFE_INTEGER.
function scaledQuantity(quantity: number): bigint {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999999.9999 ||
    Number(quantity.toFixed(4)) !== quantity) throw new Error("จำนวนวัสดุไม่ถูกต้อง");
  const [whole, fraction = ""] = quantity.toFixed(4).split(".");
  return BigInt(whole) * 10000n + BigInt(fraction);
}
function decimalText(quantity: bigint): string {
  const fraction = (quantity % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  return (quantity / 10000n).toString() + (fraction ? "." + fraction : "");
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Complete selected parent read + one confirmed child batch per filtered WO.
 * Never use a drawer's partially loaded materials as site-wide source evidence.
 * Quantities are literal decimal text in both exports, preserving large sums.
 */
export function buildMaterialLedgerReport(input: {
  siteId: string; siteName: string; orders: readonly WorkOrder[]; filters: OrderFilters;
  batches: readonly MaterialBatch[]; verified: boolean; mode: "demo" | "online"; evaluatedAt: string;
}): MaterialLedgerReport {
  buildOrderReport(input); // Reuse canonical parent scope/date-range validation.
  if (input.orders.some(order => !order.id?.trim())) throw new Error("เลขใบงานไม่ถูกต้อง");
  const orders = filterWorkOrders([...input.orders], input.filters);
  const expected = new Set(orders.map(order => order.id));
  if (input.batches.length !== orders.length ||
    new Set(input.batches.map(batch => batch.orderId)).size !== orders.length ||
    input.batches.some(batch => !expected.has(batch.orderId) || !Array.isArray(batch.materials))) {
    throw new Error("รายการวัสดุยังโหลดไม่ครบตามใบงานที่กรอง");
  }
  const batches = new Map(input.batches.map(batch => [batch.orderId, batch.materials]));
  const ids = new Set<string>();
  const groups = new Map<string, { name: string; unit: string; active: bigint; voided: bigint; activeCount: number; voidCount: number }>();
  const activeRows: ExcelSheet["rows"] = [], voidRows: ExcelSheet["rows"] = [];
  for (const order of orders) {
    for (const material of batches.get(order.id)!) {
      if (!material.id?.trim() || ids.has(material.id) || !material.name?.trim() ||
        material.name.trim().length > 200 || !material.unit?.trim() || material.unit.trim().length > 32 ||
        !material.recordedBy?.trim() || instantMillis(material.recordedAt) == null) {
        throw new Error("ข้อมูลหรือหลักฐานรายการวัสดุไม่สมบูรณ์");
      }
      ids.add(material.id);
      const quantity = scaledQuantity(material.quantity);
      const active = material.voidedAt === null && material.voidedBy === null && material.voidReason === null;
      if (!active && (!material.voidedBy?.trim() || !material.voidReason?.trim() ||
        material.voidReason.trim().length > 4000 || instantMillis(material.voidedAt) == null ||
        instantMillis(material.voidedAt)! < instantMillis(material.recordedAt)!)) {
        throw new Error("หลักฐานยกเลิกรายการวัสดุไม่ครบหรือเวลาไม่ถูกต้อง");
      }
      const key = JSON.stringify([material.name, material.unit]);
      const group = groups.get(key) ?? { name: material.name, unit: material.unit, active: 0n, voided: 0n, activeCount: 0, voidCount: 0 };
      if (active) { group.active += quantity; group.activeCount++; }
      else { group.voided += quantity; group.voidCount++; }
      groups.set(key, group);
      const row = [input.siteId, order.id, order.assetId, material.id, material.name,
        decimalText(quantity), material.unit, material.recordedBy, material.recordedAt];
      if (active) activeRows.push(row);
      else voidRows.push([...row, material.voidedBy!, material.voidedAt!, material.voidReason!]);
    }
  }
  const headers = ["รหัสไซต์", "เลขใบงาน", "รหัสเครื่อง", "รหัสรายการวัสดุ", "ชื่อวัสดุ", "จำนวน (ข้อความทศนิยม)", "หน่วย", "ผู้บันทึก", "เวลาบันทึก UTC"];
  const sheets: ExcelSheet[] = [
    { name: "สรุปรายการวัสดุ", headers: ["รายการ", "ค่า"], rows: [
      ["ไซต์", input.siteName], ["รหัสไซต์", input.siteId], ["ใบงานทั้งหมดในแหล่งข้อมูล", input.orders.length],
      ["ใบงานตามตัวกรอง", orders.length], ["รายการที่ยังใช้", activeRows.length], ["รายการยกเลิก", voidRows.length],
      ["ยอดจำนวน", "รวมเฉพาะชื่อวัสดุและหน่วยเดียวกัน ไม่รวมต่างหน่วยเป็นยอดเดียว"],
    ] },
    { name: "รวมตามชื่อและหน่วย", headers: ["ชื่อวัสดุ", "หน่วย", "จำนวนที่ยังใช้", "จำนวนที่ยกเลิก", "รายการที่ยังใช้", "รายการยกเลิก"],
      rows: [...groups.values()].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0)
        .map(group => [group.name, group.unit, decimalText(group.active), decimalText(group.voided), group.activeCount, group.voidCount]) },
    { name: "วัสดุที่ยังใช้", headers, rows: activeRows },
    { name: "หลักฐานรายการยกเลิก", headers: [...headers, "ผู้ยกเลิก", "เวลายกเลิก UTC", "เหตุผลยกเลิก"], rows: voidRows },
    { name: "ขอบเขตรายงานวัสดุ", headers: ["รายการ", "ค่า"], rows: [
      ["เวลาประเมิน UTC", input.evaluatedAt], ["แหล่งข้อมูล", input.mode === "demo" ? "ข้อมูลจำลองในเบราว์เซอร์" : "รายการใบงานและวัสดุที่โหลดครบตามสิทธิ์"],
      ["คำค้นใบงาน", input.filters.query], ["สถานะใบงาน", input.filters.status], ["รหัสผู้รับผิดชอบ", input.filters.assigneeId || "ทุกคน"],
      ["วันสร้างใบงานเริ่ม (ไทย)", input.filters.from || "ไม่จำกัด"], ["วันสร้างใบงานสิ้นสุด (ไทย)", input.filters.to || "ไม่จำกัด"],
      ["ขอบเขตวันที่", "กรองวันสร้างใบงาน Asia/Bangkok ไม่ใช่วันใช้วัสดุ; ไม่เดาวันจากข้อความเดิม"],
      ["การรวม", "ใช้ชื่อและหน่วยตามที่บันทึกตรงกันเท่านั้น ไม่แปลงหน่วย ไม่หักรายการยกเลิกซ้ำ"],
      ["ความแม่นยำ", "จำนวนเป็นข้อความทศนิยมไม่เกิน 4 ตำแหน่ง คำนวณด้วยจำนวนเต็ม ไม่ใช้ผลบวกทศนิยมแบบ binary"],
      ["ข้อจำกัด", "ไม่ใช่สต็อก ต้นทุน หรือ snapshot ฐานข้อมูล ณ transaction เดียว; ไม่รวมวัสดุจาก SR/เอกสารอื่น"],
    ] },
  ];
  return freeze({ title: "รายงานวัสดุในใบงาน", siteId: input.siteId, evaluatedAt: input.evaluatedAt,
    orderCount: orders.length, activeCount: activeRows.length, voidCount: voidRows.length, sheets });
}

export function materialLedgerPdfSections(report: MaterialLedgerReport) {
  return report.sheets.flatMap(sheet => sheet.rows.map((row, index) => ({
    label: sheet.headers.length === 2 ? String(row[0]) : `${sheet.name} #${index + 1}`,
    value: sheet.headers.length === 2 ? String(row[1]) : row.map((value, n) => `${sheet.headers[n]}: ${value}`).join("\n"),
  })));
}
