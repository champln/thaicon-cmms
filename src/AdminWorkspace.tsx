import { useMemo, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { roleLabels } from "./access";
import type { DemoUser, UserRole } from "./access";
import {
  deleteSupabaseAsset,
  deleteSupabaseJobsite,
  loadSupabaseAdminMasterData,
  manageSupabaseUser,
  saveSupabaseAsset,
  saveSupabaseJobsite,
} from "./admin-supabase";
import {
  initialsFromName,
  nextMasterId,
} from "./master-data";
import type {
  AssetHealth,
  ManagedAsset,
  ManagedJobsite,
  ManagedUser,
  MasterDataState,
} from "./master-data";
import "./admin.css";

type AdminTab = "jobsites" | "users" | "assets";

type AdminProps = {
  currentUser: DemoUser;
  state: MasterDataState;
  setState: Dispatch<SetStateAction<MasterDataState>>;
  onToast: (message: string) => void;
  onlineMode: boolean;
};

function AdminModal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="admin-modal-backdrop" onMouseDown={onClose}><section className="admin-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><span>ADMIN MASTER DATA</span><h2>{title}</h2><p>{subtitle}</p></div><button type="button" aria-label="ปิด" onClick={onClose}>×</button></header>{children}</section></div>;
}

function JobsiteForm({ initial, state, onSave, onClose }: { initial: ManagedJobsite | null; state: MasterDataState; onSave: (site: ManagedJobsite) => Promise<void>; onClose: () => void }) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({
      id: String(form.get("id")).trim().toUpperCase(),
      name: String(form.get("name")).trim(),
      province: String(form.get("province")).trim(),
      type: String(form.get("type")).trim(),
      assetCount: initial?.assetCount ?? 0,
      openWorkOrders: initial?.openWorkOrders ?? 0,
      pmCompliance: Number(form.get("pmCompliance")),
      active: form.get("active") === "on",
    });
  };
  return <AdminModal title={initial ? "แก้ไขไซต์" : "เพิ่มไซต์"} subtitle="กำหนดข้อมูลไซต์และสถานะการใช้งาน" onClose={onClose}><form className="admin-form" onSubmit={handleSubmit}><label>รหัสไซต์<input name="id" required pattern="SITE-[0-9]{3,}" readOnly={Boolean(initial)} defaultValue={initial?.id ?? nextMasterId("SITE", state.jobsites.map((item) => item.id))} /></label><label>ชื่อไซต์<input name="name" required defaultValue={initial?.name} /></label><label>จังหวัด<input name="province" required defaultValue={initial?.province} /></label><label>ประเภทไซต์<input name="type" required defaultValue={initial?.type ?? "โรงพยาบาล"} /></label><label>PM Compliance (%)<input name="pmCompliance" type="number" min="0" max="100" required defaultValue={initial?.pmCompliance ?? 100} /></label><label className="admin-check"><input name="active" type="checkbox" defaultChecked={initial?.active ?? true} /> เปิดใช้งานไซต์</label><div className="admin-form-actions"><button type="button" onClick={onClose}>ยกเลิก</button><button className="primary" type="submit">บันทึกไซต์</button></div></form></AdminModal>;
}

function UserForm({ initial, state, onlineMode, onSave, onClose }: { initial: ManagedUser | null; state: MasterDataState; onlineMode: boolean; onSave: (user: ManagedUser, password: string) => Promise<void>; onClose: () => void }) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName")).trim();
    const password = String(form.get("password"));
    void onSave({
      id: initial?.id ?? nextMasterId("USR"),
      username: String(form.get("username")).trim().toLocaleLowerCase("en"),
      password: password || initial?.password || (onlineMode ? "" : "demo123"),
      email: onlineMode ? String(form.get("email")).trim().toLocaleLowerCase("en") : undefined,
      displayName,
      initials: initialsFromName(displayName),
      role: form.get("role") as UserRole,
      title: String(form.get("title")).trim(),
      jobsiteIds: state.jobsites.filter((site) => form.get(`site:${site.id}`) === "on").map((site) => site.id),
      active: form.get("active") === "on",
    }, password);
  };
  return <AdminModal title={initial ? "แก้ไขผู้ใช้และสิทธิ์" : "เพิ่มผู้ใช้"} subtitle={onlineMode ? "บัญชีจริงผ่าน Supabase Auth และสิทธิ์ตามไซต์" : "บัญชีทดสอบและสิทธิ์ตามไซต์"} onClose={onClose}><form className="admin-form" onSubmit={handleSubmit}>{onlineMode && <label className="wide">อีเมลเข้าสู่ระบบ<input name="email" type="email" required defaultValue={initial?.email} placeholder="name@company.com" /></label>}<label>ชื่อผู้ใช้<input name="username" required pattern="[a-zA-Z0-9._-]{3,50}" defaultValue={initial?.username} /></label><label>ชื่อที่แสดง<input name="displayName" required defaultValue={initial?.displayName} /></label><label>รหัสผ่าน<input name="password" type="password" minLength={6} required={!initial} placeholder={initial ? "เว้นว่างเพื่อใช้รหัสเดิม" : "อย่างน้อย 6 ตัวอักษร"} /></label><label>บทบาท<select name="role" defaultValue={initial?.role ?? "user"}><option value="admin">ผู้ดูแลระบบ</option><option value="engineer">วิศวกร</option><option value="user">ผู้ใช้งาน</option></select></label><label className="wide">ตำแหน่ง / หน้าที่<input name="title" required defaultValue={initial?.title ?? "Customer Viewer"} /></label><fieldset className="wide"><legend>ไซต์ที่เข้าถึงได้</legend><div className="admin-site-checks">{state.jobsites.map((site) => <label key={site.id}><input name={`site:${site.id}`} type="checkbox" defaultChecked={initial?.jobsiteIds.includes(site.id) ?? false} /><span><strong>{site.name}</strong><small>{site.id}</small></span></label>)}</div></fieldset><label className="admin-check wide"><input name="active" type="checkbox" defaultChecked={initial?.active ?? true} /> เปิดใช้งานบัญชี</label><div className="admin-form-actions"><button type="button" onClick={onClose}>ยกเลิก</button><button className="primary" type="submit">บันทึกผู้ใช้</button></div></form></AdminModal>;
}

function AssetForm({ initial, state, onSave, onClose }: { initial: ManagedAsset | null; state: MasterDataState; onSave: (asset: ManagedAsset) => Promise<void>; onClose: () => void }) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onSave({ id: String(form.get("id")).trim().toUpperCase(), name: String(form.get("name")).trim(), type: String(form.get("type")).trim(), jobsiteId: String(form.get("jobsiteId")), location: String(form.get("location")).trim(), health: form.get("health") as AssetHealth, lastPm: String(form.get("lastPm")), nextPm: String(form.get("nextPm")), sensor: String(form.get("sensor")).trim(), active: form.get("active") === "on" });
  };
  return <AdminModal title={initial ? "แก้ไขเครื่องจักร" : "เพิ่มเครื่องจักร"} subtitle="ข้อมูลทะเบียน สถานะ และกำหนด PM" onClose={onClose}><form className="admin-form" onSubmit={handleSubmit}><label>Asset ID<input name="id" required readOnly={Boolean(initial)} defaultValue={initial?.id} /></label><label>ชื่อเครื่องจักร<input name="name" required defaultValue={initial?.name} /></label><label>ประเภท<input name="type" required defaultValue={initial?.type ?? "AHU"} /></label><label>ไซต์<select name="jobsiteId" required defaultValue={initial?.jobsiteId ?? state.jobsites[0]?.id}>{state.jobsites.map((site) => <option key={site.id} value={site.id}>{site.id} - {site.name}</option>)}</select></label><label className="wide">ตำแหน่งติดตั้ง<input name="location" required defaultValue={initial?.location} /></label><label>สถานะ<select name="health" defaultValue={initial?.health ?? "ปกติ"}><option>ปกติ</option><option>เฝ้าระวัง</option><option>วิกฤต</option></select></label><label>ข้อมูล Sensor<input name="sensor" required defaultValue={initial?.sensor ?? "ยังไม่เชื่อมต่อ"} /></label><label>PM ล่าสุด<input name="lastPm" type="date" defaultValue={initial?.lastPm} /></label><label>PM ครั้งถัดไป<input name="nextPm" type="date" defaultValue={initial?.nextPm} /></label><label className="admin-check wide"><input name="active" type="checkbox" defaultChecked={initial?.active ?? true} /> เปิดใช้งานเครื่องจักร</label><div className="admin-form-actions"><button type="button" onClick={onClose}>ยกเลิก</button><button className="primary" type="submit">บันทึกเครื่องจักร</button></div></form></AdminModal>;
}

export default function AdminWorkspace({ currentUser, state, setState, onToast, onlineMode }: AdminProps) {
  const [tab, setTab] = useState<AdminTab>("jobsites");
  const [editingSite, setEditingSite] = useState<ManagedJobsite | "new" | null>(null);
  const [editingUser, setEditingUser] = useState<ManagedUser | "new" | null>(null);
  const [editingAsset, setEditingAsset] = useState<ManagedAsset | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("th");
  const sitesById = useMemo(() => new Map(state.jobsites.map((site) => [site.id, site])), [state.jobsites]);
  const editingSiteId = editingSite && editingSite !== "new" ? editingSite.id : null;
  const editingAssetId = editingAsset && editingAsset !== "new" ? editingAsset.id : null;

  const refreshOnlineState = async () => setState(await loadSupabaseAdminMasterData());
  const reportError = (error: unknown) => onToast(error instanceof Error ? error.message : "บันทึกข้อมูลไม่สำเร็จ");

  const saveSite = async (site: ManagedJobsite) => {
    if (state.jobsites.some((item) => item.id === site.id && item.id !== editingSiteId)) return onToast(`รหัสไซต์ ${site.id} ถูกใช้แล้ว`);
    if (busy) return;
    setBusy(true);
    try {
      if (onlineMode) await saveSupabaseJobsite(site);
      setState((current) => ({ ...current, jobsites: current.jobsites.some((item) => item.id === site.id) ? current.jobsites.map((item) => item.id === site.id ? { ...site, assetCount: current.assets.filter((asset) => asset.jobsiteId === site.id && asset.active).length } : item) : [...current.jobsites, site] }));
      setEditingSite(null); onToast(`บันทึกไซต์ ${site.id} แล้ว`);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };
  const saveUser = async (user: ManagedUser, password: string) => {
    if (state.users.some((item) => item.username === user.username && item.id !== user.id)) return onToast(`ชื่อผู้ใช้ ${user.username} ถูกใช้แล้ว`);
    if (user.id === currentUser.id && !user.active) return onToast("ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่");
    const previousUser = state.users.find((item) => item.id === user.id);
    if (previousUser?.role === "admin" && (user.role !== "admin" || !user.active) && state.users.filter((item) => item.role === "admin" && item.active).length <= 1) return onToast("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี");
    if (busy) return;
    setBusy(true);
    try {
      if (onlineMode) {
        const isExisting = editingUser !== "new" && editingUser !== null;
        await manageSupabaseUser({ action: isExisting ? "update" : "create", userId: isExisting ? user.id : undefined, email: user.email, password: password || undefined, username: user.username, displayName: user.displayName, role: user.role, title: user.title, active: user.active, jobsiteIds: user.jobsiteIds });
        await refreshOnlineState();
      } else {
        setState((current) => ({ ...current, users: current.users.some((item) => item.id === user.id) ? current.users.map((item) => item.id === user.id ? user : item) : [...current.users, user] }));
      }
      setEditingUser(null); onToast(`บันทึกผู้ใช้ ${user.username} แล้ว`);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };
  const saveAsset = async (asset: ManagedAsset) => {
    if (state.assets.some((item) => item.id === asset.id && item.id !== editingAssetId)) return onToast(`Asset ID ${asset.id} ถูกใช้แล้ว`);
    if (busy) return;
    setBusy(true);
    try {
      if (onlineMode) await saveSupabaseAsset(asset);
      setState((current) => ({ ...current, assets: current.assets.some((item) => item.id === asset.id) ? current.assets.map((item) => item.id === asset.id ? asset : item) : [...current.assets, asset] }));
      setEditingAsset(null); onToast(`บันทึกเครื่องจักร ${asset.id} แล้ว`);
    } catch (error) { reportError(error); } finally { setBusy(false); }
  };
  const removeSite = async (site: ManagedJobsite) => {
    if (state.assets.some((asset) => asset.jobsiteId === site.id) || state.users.some((user) => user.jobsiteIds.includes(site.id))) return onToast("ลบไซต์ไม่ได้ เพราะมีผู้ใช้หรือเครื่องจักรอ้างอิงอยู่ ให้ปิดใช้งานแทน");
    if (!window.confirm(`ลบไซต์ ${site.name} ใช่หรือไม่`)) return;
    setBusy(true);
    try { if (onlineMode) await deleteSupabaseJobsite(site.id); setState((current) => ({ ...current, jobsites: current.jobsites.filter((item) => item.id !== site.id) })); onToast(`ลบไซต์ ${site.id} แล้ว`); } catch (error) { reportError(error); } finally { setBusy(false); }
  };
  const removeUser = async (user: ManagedUser) => {
    if (user.id === currentUser.id) return onToast("ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่");
    if (user.role === "admin" && state.users.filter((item) => item.role === "admin" && item.active).length <= 1) return onToast("ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี");
    if (!window.confirm(`ลบผู้ใช้ ${user.displayName} ใช่หรือไม่`)) return;
    setBusy(true);
    try { if (onlineMode) await manageSupabaseUser({ action: "delete", userId: user.id }); setState((current) => ({ ...current, users: current.users.filter((item) => item.id !== user.id) })); onToast(`ลบผู้ใช้ ${user.username} แล้ว`); } catch (error) { reportError(error); } finally { setBusy(false); }
  };
  const removeAsset = async (asset: ManagedAsset) => {
    if (!window.confirm(`ลบเครื่องจักร ${asset.id} ใช่หรือไม่`)) return;
    setBusy(true);
    try { if (onlineMode) await deleteSupabaseAsset(asset.id); setState((current) => ({ ...current, assets: current.assets.filter((item) => item.id !== asset.id) })); onToast(`ลบเครื่องจักร ${asset.id} แล้ว`); } catch (error) { reportError(error); } finally { setBusy(false); }
  };

  return <div className="admin-page" aria-busy={busy}><section className="admin-toolbar"><div><span>ADMIN CENTER</span><h2>จัดการข้อมูลระบบ</h2><p>{onlineMode ? "ข้อมูลจริงจาก Supabase • ไซต์ ผู้ใช้ สิทธิ์ และทะเบียนเครื่องจักร" : "ข้อมูลทดสอบใน Browser • ไซต์ ผู้ใช้ สิทธิ์ และทะเบียนเครื่องจักร"}</p></div><label><span>ค้นหา</span><input aria-label="ค้นหาข้อมูลระบบ" placeholder="ชื่อ รหัส หรือประเภท" value={query} onChange={(event) => setQuery(event.target.value)} /></label></section><nav className="admin-tabs">{([['jobsites','ไซต์ลูกค้า',state.jobsites.length],['users','ผู้ใช้และสิทธิ์',state.users.length],['assets','เครื่องจักร',state.assets.length]] as const).map(([id,label,count]) => <button className={tab === id ? "active" : ""} type="button" key={id} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}</nav>
    {tab === "jobsites" && <section className="admin-panel"><header><div><h3>ไซต์ลูกค้า</h3><p>เพิ่ม แก้ไข ปิดใช้งาน และตรวจจำนวนเครื่องจักร</p></div><button className="primary" type="button" onClick={() => setEditingSite("new")}>+ เพิ่มไซต์</button></header><div className="admin-table-wrap"><table><thead><tr><th>ไซต์</th><th>ประเภท / จังหวัด</th><th>เครื่องจักร</th><th>PM</th><th>สถานะ</th><th /></tr></thead><tbody>{state.jobsites.filter((site) => !normalizedQuery || `${site.id} ${site.name} ${site.type} ${site.province}`.toLocaleLowerCase("th").includes(normalizedQuery)).map((site) => <tr key={site.id}><td><strong>{site.name}</strong><small>{site.id}</small></td><td>{site.type}<small>{site.province}</small></td><td>{state.assets.filter((asset) => asset.jobsiteId === site.id && asset.active).length} เครื่อง</td><td>{site.pmCompliance}%</td><td><span className={site.active ? "admin-status active" : "admin-status"}>{site.active ? "ใช้งาน" : "ปิดใช้งาน"}</span></td><td><div className="admin-actions"><button type="button" onClick={() => setEditingSite(site)}>แก้ไข</button><button className="danger" type="button" onClick={() => removeSite(site)}>ลบ</button></div></td></tr>)}</tbody></table></div></section>}
    {tab === "users" && <section className="admin-panel"><header><div><h3>ผู้ใช้และสิทธิ์</h3><p>กำหนดบทบาทและไซต์ที่แต่ละบัญชีเข้าถึงได้</p></div><button className="primary" type="button" onClick={() => setEditingUser("new")}>+ เพิ่มผู้ใช้</button></header><div className="admin-table-wrap"><table><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>ไซต์ที่เข้าถึง</th><th>สถานะ</th><th /></tr></thead><tbody>{state.users.filter((user) => !normalizedQuery || `${user.username} ${user.displayName} ${user.title}`.toLocaleLowerCase("th").includes(normalizedQuery)).map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.username} • {user.title}</small></td><td>{roleLabels[user.role]}</td><td>{user.role === "admin" ? "ทุกไซต์" : user.jobsiteIds.map((id) => sitesById.get(id)?.name ?? id).join(", ") || "ยังไม่กำหนด"}</td><td><span className={user.active ? "admin-status active" : "admin-status"}>{user.active ? "ใช้งาน" : "ปิดใช้งาน"}</span></td><td><div className="admin-actions"><button type="button" onClick={() => setEditingUser(user)}>แก้ไข</button><button className="danger" type="button" onClick={() => removeUser(user)}>ลบ</button></div></td></tr>)}</tbody></table></div></section>}
    {tab === "assets" && <section className="admin-panel"><header><div><h3>ทะเบียนเครื่องจักร</h3><p>ผูกเครื่องจักรกับไซต์ สถานะ และกำหนด PM</p></div><button className="primary" type="button" onClick={() => setEditingAsset("new")}>+ เพิ่มเครื่องจักร</button></header><div className="admin-table-wrap"><table><thead><tr><th>เครื่องจักร</th><th>ไซต์ / ตำแหน่ง</th><th>สถานะ</th><th>PM ครั้งถัดไป</th><th>ใช้งาน</th><th /></tr></thead><tbody>{state.assets.filter((asset) => !normalizedQuery || `${asset.id} ${asset.name} ${asset.type} ${asset.location}`.toLocaleLowerCase("th").includes(normalizedQuery)).map((asset) => <tr key={asset.id}><td><strong>{asset.name}</strong><small>{asset.id} • {asset.type}</small></td><td>{sitesById.get(asset.jobsiteId)?.name ?? asset.jobsiteId}<small>{asset.location}</small></td><td><span className={`admin-health ${asset.health === "ปกติ" ? "healthy" : asset.health === "เฝ้าระวัง" ? "watch" : "critical"}`}>{asset.health}</span></td><td>{asset.nextPm || "ยังไม่กำหนด"}</td><td><span className={asset.active ? "admin-status active" : "admin-status"}>{asset.active ? "ใช้งาน" : "ปิดใช้งาน"}</span></td><td><div className="admin-actions"><button type="button" onClick={() => setEditingAsset(asset)}>แก้ไข</button><button className="danger" type="button" onClick={() => removeAsset(asset)}>ลบ</button></div></td></tr>)}</tbody></table></div></section>}
    {editingSite && <JobsiteForm initial={editingSite === "new" ? null : editingSite} state={state} onSave={saveSite} onClose={() => setEditingSite(null)} />}{editingUser && <UserForm initial={editingUser === "new" ? null : editingUser} state={state} onlineMode={onlineMode} onSave={saveUser} onClose={() => setEditingUser(null)} />}{editingAsset && <AssetForm initial={editingAsset === "new" ? null : editingAsset} state={state} onSave={saveAsset} onClose={() => setEditingAsset(null)} />}
  </div>;
}
