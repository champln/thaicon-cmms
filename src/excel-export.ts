import type { Image } from 'write-excel-file/browser';

export type ExcelSheet = { name: string; headers: string[]; rows: Array<Array<string | number>>; images?: Image[]; rowHeight?: number };

/** Only literal text/number cells are accepted. User strings are never formulas,
 * hyperlinks, macros, or executable content (including strings beginning '=').
 */
export async function downloadExcel(filename: string, sheets: ExcelSheet[], assertCurrent?: () => void | Promise<void>, archivedAt?: string, capture?: (blob: Blob) => void) {
  await assertCurrent?.();
  if (!sheets.length || sheets.some(s => !s.headers.length || s.rows.some(row => row.length !== s.headers.length))) throw new Error("ข้อมูลรายงานไม่ครบ");
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const metadata: ExcelSheet = { name: "ข้อมูลการส่งออก", headers: ["รายการ", "ค่า"], rows: [
    ["เวลาออกไฟล์ UTC", archivedAt ?? new Date().toISOString()],
    ["แหล่งข้อมูล", archivedAt ? "ชุดข้อมูลฉบับส่งมอบ" : window.location.origin + window.location.pathname],
    ["ขอบเขต", archivedAt ? "ข้อมูลและรูปตามฉบับที่ออก" : "เฉพาะรายการที่เลือก/กรองและโหลดสำเร็จในหน้าจอ ไม่ใช่ snapshot ฐานข้อมูล"],
    ["ชุดข้อมูล", sheets.map(sheet => sheet.name).join(", ")],
  ] };
  const output = [...sheets, metadata].map(sheet => ({
    sheet: sheet.name,
    stickyRowsCount: 1,
    images: sheet.images,
    columns: sheet.headers.map((_, i) => ({ width: i === 0 ? 28 : 36 })),
    data: [
      sheet.headers.map(value => ({ value, type: String, fontWeight: "bold" as const, backgroundColor: "#123C66", textColor: "#FFFFFF", height: 28, wrap: true })),
      ...sheet.rows.map(row => row.map(value => typeof value === "number"
        ? { value, type: Number, format: "#,##0.####", wrap: true, height: sheet.rowHeight }
        : { value, type: String, wrap: true, height: sheet.rowHeight })),
    ],
  }));
  const file = writeExcelFile(output, { fontFamily: "Tahoma", fontSize: 12 });
  if (!assertCurrent && !capture) { await file.toFile(filename); return; }
  const blob = await file.toBlob();
  await assertCurrent?.();
  if (capture) { capture(blob); return; }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
