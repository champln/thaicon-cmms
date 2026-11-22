import { useMemo, useState } from 'react';
import type { ContractDefinition } from './contract-definition-supabase';

export type ContractAssetOption = { id: string; name: string; type: string; location: string };
type Memberships = NonNullable<ContractDefinition['members']>;

export default function ContractGroupAssets({ groupId, groups, members, assets, canEdit, onChange }: {
  groupId: string;
  groups: ContractDefinition['groups'];
  members: Memberships;
  assets: ContractAssetOption[];
  canEdit: boolean;
  onChange: (members: Memberships) => void;
}) {
  const [search, setSearch] = useState('');
  const [assetId, setAssetId] = useState('');
  const catalog = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const assignments = new Map(members.map(member => [member.asset_id, member.group_id]));
  const groupNames = new Map(groups.map(group => [group.id, group.name || 'กลุ่มใหม่']));
  const assigned = members.filter(member => member.group_id === groupId);
  const query = search.trim().toLocaleLowerCase('th');
  const options = assets.filter(asset => assignments.get(asset.id) !== groupId &&
    [asset.id, asset.name, asset.type, asset.location].some(value => value.toLocaleLowerCase('th').includes(query)));
  const selected = options.find(asset => asset.id === assetId);
  const previous = selected && assignments.get(selected.id);

  return <section className="contract-assets" aria-label="เครื่องในกลุ่ม">
    <h4>เครื่องในกลุ่ม ({assigned.length.toLocaleString('th-TH')})</h4>
    {canEdit && <div className="contract-grid">
      <label>ค้นหาเครื่อง<input type="search" value={search} onChange={event => { setSearch(event.target.value); setAssetId(''); }} /></label>
      <label>เครื่องจากทะเบียนไซต์<select value={selected?.id ?? ''} onChange={event => setAssetId(event.target.value)} disabled={!options.length}>
        <option value="">{options.length ? 'เลือกเครื่อง' : 'ไม่พบเครื่องที่เพิ่มได้'}</option>
        {options.map(asset => <option key={asset.id} value={asset.id}>
          {asset.id} · {asset.name} · {asset.type}{assignments.has(asset.id) ? ` · อยู่ใน ${groupNames.get(assignments.get(asset.id)!)}` : ''}
        </option>)}
      </select></label>
      <button className="maint-button secondary contract-start" type="button" disabled={!selected} onClick={() => {
        if (!selected) return;
        onChange([...members.filter(member => member.asset_id !== selected.id), {group_id:groupId,asset_id:selected.id}]);
        setAssetId('');
      }}>{previous ? 'ย้ายเข้ากลุ่มนี้' : 'เพิ่มเข้ากลุ่ม'}</button>
    </div>}
    {previous && <p>เครื่องนี้อยู่ในกลุ่ม {groupNames.get(previous)} การย้ายจะนำเครื่องออกจากกลุ่มเดิม</p>}
    {assigned.length === 0 ? <p>ยังไม่มีเครื่องในกลุ่ม</p> : <ul className="contract-asset-list">
      {assigned.map(({asset_id}) => {
        const asset = catalog.get(asset_id);
        return <li key={asset_id}>
          <div><strong>{asset_id}</strong><br />{asset ? `${asset.name} · ${asset.location}` : 'ไม่อยู่ในรายการเครื่องที่ใช้งาน'}</div>
          {canEdit && <button className="maint-button secondary" type="button" aria-label={`นำ ${asset_id} ออกจากกลุ่ม`}
            onClick={() => onChange(members.filter(member => member.asset_id !== asset_id))}>นำออก</button>}
        </li>;
      })}
    </ul>}
  </section>;
}
