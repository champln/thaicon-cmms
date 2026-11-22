import { validateContractDefinition, type ContractDefinition } from './contract-definition-supabase';
import type { DemoCleaningEvidence } from './contract-demo-evidence';

export const demoEvidenceKey = (site: string) => 'thaicon-contract-evidence-demo-v1:' + site;
export function readDemoEvidence(site: string): DemoCleaningEvidence[] {
  const rows: DemoCleaningEvidence[] = JSON.parse(localStorage.getItem(demoEvidenceKey(site)) ?? '[]');
  if (!Array.isArray(rows) || rows.some(row => row?.siteId !== site || !row.id || !row.reportId || !row.source)) {
    throw new Error('อ่านหลักฐานตามสัญญาไม่ได้');
  }
  if (new Set(rows.map(row => row.reportId)).size !== rows.length) throw new Error('พบรายงานเชื่อมซ้ำ');
  return rows;
}

export type DemoContractRecord = { id: string; site: string; version: number; definition: ContractDefinition };
export const demoContractKey = (site: string) => 'thaicon-contract-demo-v1:' + site;

export function readDemoContracts(site: string): DemoContractRecord[] {
  const rows: DemoContractRecord[] = JSON.parse(localStorage.getItem(demoContractKey(site)) ?? '[]');
  if (!Array.isArray(rows)) throw new Error('อ่านสัญญาทดลองไม่ได้');
  for (const row of rows) {
    if (row.site !== site || !row.id || !Number.isSafeInteger(row.version) || row.version < 1) throw new Error('ข้อมูลสัญญาทดลองไม่ถูกต้อง');
    validateContractDefinition(row.definition);
  }
  return rows;
}
