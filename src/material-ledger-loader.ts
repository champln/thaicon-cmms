import type { OrderMaterial } from "./work-order-materials";
import type { MaterialBatch } from "./material-ledger-report";

/** Serial/bounded complete reads. The adapter MUST read all pages per parent.
 * assertAuthorized must check actual user/role/site/gate, not merely empty RLS
 * results. It runs again after reads (also for an empty selection).
 * This returns no partial result and is NOT an atomic DB snapshot.
 */
export async function loadMaterialLedger(input: {
  orderIds: readonly string[];
  readMaterials: (orderId: string) => Promise<readonly OrderMaterial[]>;
  assertCurrent: () => void;
  assertAuthorized: () => Promise<void>;
}): Promise<MaterialBatch[]> {
  const orderIds = [...input.orderIds];
  if (orderIds.some(id => !id?.trim()) || new Set(orderIds).size !== orderIds.length) throw new Error("ขอบเขตใบงานไม่ถูกต้อง");
  input.assertCurrent();
  await input.assertAuthorized();
  input.assertCurrent();
  const batches: MaterialBatch[] = [];
  for (const orderId of orderIds) {
    input.assertCurrent();
    const materials = await input.readMaterials(orderId);
    input.assertCurrent();
    if (!Array.isArray(materials)) throw new Error("รายการวัสดุไม่สมบูรณ์");
    // Copy rows before the next async read; do not retain mutable drawer state.
    batches.push({ orderId, materials: materials.map(material => ({ ...material })) });
  }
  await input.assertAuthorized();
  input.assertCurrent();
  return batches;
}
