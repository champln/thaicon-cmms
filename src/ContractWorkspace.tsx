import { useEffect, useMemo, useRef, useState } from 'react';
import { contractMonths } from './contract-report';
import { ContractDefinitionError, createContractDefinitionOperation, createContractDefinitionRepository, validateContractDefinition } from './contract-definition-supabase';
import type { ContractDefinition, ContractSummary } from './contract-definition-supabase';
import { supabase } from './supabase';
import ContractGroupAssets, { type ContractAssetOption } from './ContractGroupAssets';
import './contract-workspace.css';
import { demoContractKey as demoKey, readDemoContracts as demoRecords, type DemoContractRecord as Record } from './contract-demo-store';

type Group = ContractDefinition['groups'][number];
type Kind = ContractDefinition['targets'][number]['cleaning_kind'];
const kinds = [['major', 'ล้างใหญ่'], ['minor', 'ล้างย่อย']] as const;
const message = (error: unknown) => error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ';

const summary = ({id, definition}: Record): ContractSummary => ({
  id, name: definition.name, starts_on: definition.starts_on, ends_on: definition.ends_on,
});

export default function ContractWorkspace({site, assets, online, canEdit, assertScope, onPendingChange}: {
  site: string; assets: ContractAssetOption[]; online: boolean; canEdit: boolean;
  assertScope: () => void; onPendingChange: (pending: boolean) => void;
}) {
  const repo = useMemo(() => online && supabase ? createContractDefinitionRepository(supabase) : null, [online]);
  const mounted = useRef(false);
  const pendingCallback = useRef(onPendingChange);
  const savedDefinition = useRef<ContractDefinition | null>(null);
  const operation = useRef<ReturnType<typeof createContractDefinitionOperation> | null>(null);
  const [list, setList] = useState<ContractSummary[]>([]);
  const [availability, setAvailability] = useState<'loading'|'ready'|'disabled'|'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Record | null>(null);
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingCallback.current(false); };
  }, []);
  useEffect(() => {
    let current = true;
    setAvailability('loading');
    async function load() {
      try {
        if (online && (!repo || !await repo.ready())) {
          if (current) setAvailability('disabled');
          return;
        }
        const rows = repo ? await repo.list(site) : demoRecords(site).map(summary);
        if (current) { setList(rows); setAvailability('ready'); }
      } catch {
        if (current) setAvailability('error');
      }
    }
    void load();
    return () => { current = false; };
  }, [repo, site, attempt, online]);

  async function open(id: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const row = repo ? await repo.read(id, site) : demoRecords(site).find(item => item.id === id);
      if (!row) throw new Error('ไม่พบสัญญาที่เลือก');
      if (online) assertScope();
      if (!mounted.current) return;
      savedDefinition.current = row.definition;
      setDraft(row);
      setGroupId(row.definition.groups[0]?.id ?? '');
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function start() {
    savedDefinition.current = null;
    setDraft({id:crypto.randomUUID(), site, version:0, definition:{name:'',starts_on:'',ends_on:'',groups:[],targets:[],members:[]}});
    setGroupId('');
    setNotice('');
    setError('');
  }
  function update(change: Partial<ContractDefinition>) {
    setDraft(row => row && {...row, definition:{...row.definition,...change}});
  }
  function addGroup() {
    if (!draft) return;
    const group: Group = {id:crypto.randomUUID(),name:'',building:'',asset_type:'AHU',major_frequency:0,minor_frequency:0};
    update({groups:[...draft.definition.groups,group]});
    setGroupId(group.id);
  }

  async function save() {
    if (!draft || !canEdit || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      validateContractDefinition(draft.definition);
      let confirmed: Record;
      if (repo) {
        const assertCurrent = () => {
          if (!mounted.current) throw new Error('เปลี่ยนหน้าหรือไซต์แล้ว');
          assertScope();
        };
        operation.current ??= createContractDefinitionOperation(repo,draft.id,site,draft.version,draft.definition,assertCurrent);
        onPendingChange(true);
        confirmed = await operation.current.run();
      } else {
        if (online) throw new Error('ยังเชื่อมต่อข้อมูลสัญญาไม่ได้');
        const rows = demoRecords(site);
        if ((rows.find(row => row.id === draft.id)?.version ?? 0) !== draft.version) throw new ContractDefinitionError('conflict');
        confirmed = {...draft,version:draft.version+1};
        localStorage.setItem(demoKey(site), JSON.stringify([...rows.filter(row => row.id !== draft.id),confirmed]));
      }
      operation.current = null;
      if (!mounted.current) return;
      onPendingChange(false);
      setUncertain(false);
      savedDefinition.current = confirmed.definition;
      setDraft(confirmed);
      setGroupId(current => confirmed.definition.groups.some(item => item.id === current) ? current : confirmed.definition.groups[0]?.id ?? '');
      setList(rows => [...rows.filter(row => row.id !== confirmed.id),summary(confirmed)]);
      setNotice(online ? 'บันทึกสัญญาแล้ว' : 'บันทึกสัญญาทดลองในเบราว์เซอร์แล้ว');
    } catch (error) {
      if (!mounted.current) return;
      const pending = !!operation.current && !(error instanceof ContractDefinitionError && error.kind !== 'unavailable');
      if (!pending) operation.current = null;
      setUncertain(pending);
      onPendingChange(pending);
      setError(pending ? 'ยังยืนยันผลบันทึกไม่ได้ กดตรวจผลอีกครั้งด้วยคำขอเดิม' : message(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const definition = draft?.definition;
  const canDiscard = () => !canEdit || !draft || draft.definition === savedDefinition.current ||
    window.confirm('ทิ้งการแก้ไขที่ยังไม่ได้บันทึกหรือไม่?');
  const group = definition?.groups.find(item => item.id === groupId);
  let dates: string[] = [];
  if (draft && definition) {
    try { dates = contractMonths({id:draft.id,siteId:site,name:definition.name,startDate:definition.starts_on,endDate:definition.ends_on}); }
    catch { /* Partial input is normal while entering dates. */ }
  }
  const groupTargets = definition?.targets.filter(item => item.group_id === groupId) ?? [];
  const months = [...new Set([...dates,...groupTargets.map(item => item.month_start.slice(0,7))])].sort();
  const setGroup = (change: Partial<Group>) => definition && update({
    groups: definition.groups.map(item => item.id === groupId ? {...item,...change} : item),
  });
  function setTarget(month: string, kind: Kind, value: string) {
    if (!definition || !group) return;
    const month_start = month + '-01';
    const targets = definition.targets.filter(t => t.group_id !== group.id || t.month_start !== month_start || t.cleaning_kind !== kind);
    if (value !== '') targets.push({group_id:group.id,month_start,cleaning_kind:kind,target:Number(value)});
    update({targets});
  }

  return <section className="maint-panel contract-workspace" aria-label="สัญญาบำรุงรักษา">
    <div className="maint-panel-heading"><h3>สัญญาบำรุงรักษา</h3></div>
    <form className="maint-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {!online && <p className="wide">โหมดทดลอง · บันทึกเฉพาะเบราว์เซอร์นี้</p>}
      {availability === 'loading' && <p className="wide" role="status">กำลังโหลดสัญญา…</p>}
      {availability === 'disabled' && <p className="wide">ยังไม่เปิดใช้สัญญาบำรุงรักษา</p>}
      {availability === 'error' && <div className="wide" role="alert">โหลดรายการสัญญาไม่สำเร็จ <button type="button" className="maint-button secondary" onClick={() => setAttempt(n => n+1)}>โหลดอีกครั้ง</button></div>}
      {availability === 'ready' && <>
        <label>สัญญาที่บันทึกแล้ว<select disabled={busy || uncertain} value={draft?.version ? draft.id : ''} onChange={event => {
          const id = event.target.value;
          if (!canDiscard()) return;
          if (id) void open(id); else setDraft(null);
        }}>
          <option value="">{list.length ? 'เลือกสัญญา' : 'ยังไม่มีสัญญา'}</option>
          {list.map(row => <option value={row.id} key={row.id}>{row.name} · {row.starts_on} ถึง {row.ends_on}</option>)}
        </select></label>
        {canEdit && <button className="maint-button secondary contract-start" type="button" disabled={busy || uncertain} onClick={() => {
          if (canDiscard()) start();
        }}>สร้างสัญญา</button>}
      </>}
      {error && <p className="maint-form-error wide" role="alert">{error}</p>}
      {notice && <p className="wide" role="status">{notice}</p>}
      {busy && <p className="wide" role="status">กำลังยืนยันข้อมูลสัญญา…</p>}
      {draft && definition && <fieldset className="wide contract-fields" disabled={busy || uncertain}>
        <legend>{draft.version ? `สัญญาฉบับที่ ${draft.version}` : 'สัญญาใหม่'}</legend>
        <div className="contract-grid">
          <label>ชื่อสัญญา<input readOnly={!canEdit} value={definition.name} maxLength={200} required onChange={e=>update({name:e.target.value})} /></label>
          <label>วันเริ่มสัญญา<input readOnly={!canEdit} type="date" value={definition.starts_on} required onChange={e=>update({starts_on:e.target.value})} /></label>
          <label>วันสิ้นสุดสัญญา<input readOnly={!canEdit} type="date" value={definition.ends_on} required onChange={e=>update({ends_on:e.target.value})} /></label>
          <label>กลุ่มเครื่อง<select value={groupId} onChange={e=>setGroupId(e.target.value)}>
            <option value="">เลือกกลุ่มเครื่อง</option>
            {definition.groups.map(item => <option value={item.id} key={item.id}>{item.name || 'กลุ่มใหม่'} · {item.building || 'ยังไม่ระบุอาคาร'}</option>)}
          </select></label>
          {canEdit && <button className="maint-button secondary contract-start" type="button" onClick={addGroup}>เพิ่มกลุ่มเครื่อง</button>}
        </div>
        {group && <>
          <div className="contract-grid">
            <label>ชื่อกลุ่ม<input readOnly={!canEdit} maxLength={200} required value={group.name} onChange={e=>setGroup({name:e.target.value})} /></label>
            <label>อาคาร<input readOnly={!canEdit} maxLength={100} required value={group.building} onChange={e=>setGroup({building:e.target.value})} /></label>
            <label>ประเภทเครื่อง<select disabled={!canEdit} value={group.asset_type} onChange={e=>setGroup({asset_type:e.target.value as Group['asset_type']})}>
              <option>AHU</option><option>FCU</option><option value="SPT">Split Type</option>
            </select></label>
            {kinds.map(([kind,label]) => <label key={kind}>ความถี่{label} (ครั้ง/ปี)<input type="number" min="0" step="1" readOnly={!canEdit} value={group[kind === 'major' ? 'major_frequency' : 'minor_frequency']} onChange={e=>setGroup({[kind === 'major' ? 'major_frequency' : 'minor_frequency']:Number(e.target.value)})} /></label>)}
            {canEdit && <button type="button" className="maint-button secondary contract-start" disabled={definition.members?.some(member => member.group_id === group.id)} onClick={() => {
              if (!window.confirm('นำกลุ่มนี้และเป้าหมายของกลุ่มออกจากสัญญาหรือไม่?')) return;
              update({groups:definition.groups.filter(g=>g.id!==group.id), targets:definition.targets.filter(t=>t.group_id!==group.id)});
              setGroupId('');
            }}>นำกลุ่มออก</button>}
          </div>
          <ContractGroupAssets key={group.id} groupId={group.id} groups={definition.groups}
            members={definition.members ?? []} assets={assets} canEdit={canEdit}
            onChange={members => update({members})} />
          {canEdit && definition.members?.some(member => member.group_id === group.id) && <p>ย้ายหรือนำเครื่องออกก่อนนำกลุ่มออก</p>}
          <h4>เป้าหมายรายเดือน</h4>
          {!dates.length && <p>ระบุวันเริ่มและวันสิ้นสุดสัญญาเพื่อแสดงเดือน</p>}
          {!!months.length && <div className="maint-table-wrap"><table className="contract-targets">
            <thead><tr><th scope="col">เดือน</th>{kinds.map(([kind,label])=><th key={kind} scope="col">{label} (ครั้ง)</th>)}</tr></thead>
            <tbody>{months.map(month => <tr key={month}><th scope="row">{month}{!dates.includes(month) && ' · นอกสัญญา'}</th>
              {kinds.map(([kind,label]) => {
                const value = groupTargets.find(t=>t.month_start===month+'-01' && t.cleaning_kind===kind)?.target;
                return <td key={kind}>{canEdit ? <input aria-label={`${label} ${month}`} type="number" min="0" max="2147483647" step="1" value={value ?? ''} onChange={e=>setTarget(month,kind,e.target.value)} /> : value ?? '—'}</td>;
              })}</tr>)}</tbody>
            <tfoot><tr><th scope="row">รวม</th>{kinds.map(([kind])=><td key={kind}>{groupTargets.filter(t=>t.cleaning_kind===kind).reduce((total,t)=>total+t.target,0).toLocaleString('th-TH')}</td>)}</tr></tfoot>
          </table></div>}
        </>}
      </fieldset>}
      {draft && canEdit && <div className="maint-form-actions wide">
        {!!draft.version && <button className="maint-button secondary" type="button" disabled={busy || uncertain} onClick={() => { if (canDiscard()) void open(draft.id); }}>โหลดฉบับล่าสุด</button>}
        <button className="maint-button primary" type="submit" disabled={busy}>{uncertain ? 'ตรวจผลอีกครั้ง' : 'บันทึกสัญญา'}</button>
      </div>}
    </form>
  </section>;
}
