import { useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { createSupabaseLocation } from "./admin-supabase";
import { locationLabel, validateLocation } from "./master-data";
import type { MasterDataState } from "./master-data";

export default function AssetLocationsPanel({ state, setState, onlineMode, onToast }: { state: MasterDataState; setState: Dispatch<SetStateAction<MasterDataState>>; onlineMode: boolean; onToast: (message: string) => void }) {
  const [siteId, setSiteId] = useState(state.jobsites[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const location = { id: crypto.randomUUID(), jobsiteId: siteId, building: String(form.get("building") ?? "").trim(), floor: String(form.get("floor") ?? "").trim(), room: String(form.get("room") ?? "").trim() };
    setBusy(true); setError("");
    try {
      if (!state.jobsites.some((site) => site.id === siteId && site.active)) throw new Error("กรุณาเลือกไซต์ที่เปิดใช้งาน");
      validateLocation(location);
      if (state.locations.some((item) => item.jobsiteId === siteId && item.building === location.building && item.floor === location.floor && item.room === location.room)) throw new Error("ตำแหน่งนี้มีอยู่แล้ว");
      if (onlineMode) await createSupabaseLocation(location);
      setState((current) => ({ ...current, locations: [...current.locations, location] }));
      element.reset(); onToast("เพิ่มตำแหน่งติดตั้งแล้ว");
    } catch (err) { setError(err instanceof Error ? err.message : "เพิ่มตำแหน่งไม่สำเร็จ กรุณาตรวจว่ามีตำแหน่งซ้ำหรือไม่"); }
    finally { setBusy(false); }
  };
  return <section className="admin-panel"><header><div><h3>ทะเบียนตำแหน่งติดตั้ง</h3><p>เพิ่มอาคาร ชั้น และห้อง แล้วเลือกใช้ในฟอร์มเครื่องจักร ตำแหน่งที่บันทึกแล้วไม่สามารถแก้ไขหรือลบได้</p></div></header>
    <form className="admin-form" onSubmit={(event) => void save(event)}>
      <label className="wide">ไซต์สำหรับตำแหน่ง<select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{state.jobsites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
      {([['building', 'อาคาร'], ['floor', 'ชั้น'], ['room', 'ห้อง']] as const).map(([name, label]) => <label key={name}>{label}<input name={name} required={name === "building"} maxLength={200} /></label>)}
      {error && <p className="wide" role="alert">{error}</p>}
      <div className="wide"><button className="primary" disabled={busy || !siteId} type="submit">{busy ? "กำลังบันทึก…" : "เพิ่มตำแหน่ง"}</button></div>
    </form>
    <div className="admin-table-wrap"><table><thead><tr><th>ตำแหน่งในไซต์ที่เลือก</th><th>เครื่องจักรที่ผูกอยู่</th></tr></thead><tbody>{state.locations.filter((item) => item.jobsiteId === siteId).map((item) => <tr key={item.id}><td>{locationLabel(item)}</td><td>{state.assets.filter((asset) => asset.jobsiteId === siteId && asset.locationId === item.id).length}</td></tr>)}</tbody></table></div>
    {!state.locations.some((item) => item.jobsiteId === siteId) && <p className="asset-location-empty">ยังไม่มีตำแหน่งติดตั้งในไซต์นี้</p>}
  </section>;
}
