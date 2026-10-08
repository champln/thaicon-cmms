import type { SupabaseClient } from "@supabase/supabase-js";
import type { LiveScope } from "./live-snapshot-supabase";

export async function assertMaterialLedgerAccess(client: Pick<SupabaseClient, "rpc">, scope: LiveScope,
  orders: readonly { id: string; version?: number }[], assertCurrent: () => void) {
  if (!scope.siteId || !scope.userId || !["admin", "engineer", "user"].includes(scope.role) ||
    orders.some(order => !order.id?.trim() || !Number.isSafeInteger(order.version) || order.version! < 1) ||
    new Set(orders.map(order => order.id)).size !== orders.length) throw new Error("ขอบเขตหรือเวอร์ชันใบงานยังไม่ยืนยัน กรุณาโหลดใหม่");
  assertCurrent();
  const { data, error } = await client.rpc("material_ledger_context", {
    p_site_id: scope.siteId, p_orders: orders.map(order => ({ id: order.id, version: order.version })),
  });
  assertCurrent();
  if (error) throw new Error(error.code === "42501" ? "ไม่มีสิทธิ์อ่านรายงานวัสดุ หรือระบบใบงานยังไม่เปิดใช้" :
    error.code === "40001" ? "ใบงานเปลี่ยนระหว่างโหลด กรุณาโหลดข้อมูลล่าสุดและส่งออกใหม่" :
    ["PGRST202", "42883"].includes(error.code) ? "ฐานข้อมูลยังไม่พร้อมสำหรับรายงานวัสดุ" : "ตรวจสิทธิ์รายงานวัสดุไม่สำเร็จ");
  if (!data || data.protocol !== 1 || data.site_id !== scope.siteId || data.actor_id !== scope.userId ||
    data.actor_role !== scope.role || data.enabled !== true || data.parent_count !== orders.length) {
    throw new Error("ยังยืนยันสิทธิ์และขอบเขตรายงานวัสดุไม่ได้");
  }
}
