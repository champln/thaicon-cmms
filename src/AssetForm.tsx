import { useState } from "react";
import type { FormEvent } from "react";
import { locationLabel, resolveAssetLocation } from "./master-data";
import type { AssetHealth, ManagedAsset, MasterDataState } from "./master-data";

export default function AssetForm({ initial, state, onSave, onClose }: { initial: ManagedAsset | null; state: MasterDataState; onSave: (asset: ManagedAsset) => Promise<void>; onClose: () => void }) {
  const [siteId, setSiteId] = useState(initial?.jobsiteId ?? state.jobsites[0]?.id ?? "");
  const [locationId, setLocationId] = useState(initial?.locationId ?? "");
  const [error, setError] = useState("");
  const selectedLocation = state.locations.find((item) => item.id === locationId && item.jobsiteId === siteId);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    try {
      const asset = resolveAssetLocation({ id: text("id").toUpperCase(), name: text("name"), type: text("type"), jobsiteId: siteId, locationId: locationId || null,
        location: text("location"), building: text("building"), floor: text("floor"), room: text("room"), manufacturer: text("manufacturer"), model: text("model"), serialNumber: text("serialNumber"),
        health: form.get("health") as AssetHealth, lastPm: text("lastPm"), nextPm: text("nextPm"), sensor: text("sensor"), active: form.get("active") === "on" }, state.locations);
      if (!asset.id || !asset.name || !asset.location) throw new Error("กรุณาระบุรหัส ชื่อ และตำแหน่งติดตั้ง");
      setError("");
      void onSave(asset);
    } catch (err) { setError(err instanceof Error ? err.message : "กรุณาตรวจสอบข้อมูล"); }
  };
  return <div className="admin-modal-backdrop" onMouseDown={onClose}><section className="admin-modal" role="dialog" aria-modal="true" aria-label="ข้อมูลเครื่องจักร" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><h2>{initial ? "แก้ไขเครื่องจักร" : "เพิ่มเครื่องจักร"}</h2><p>ข้อมูลทะเบียน ตำแหน่งติดตั้ง และกำหนด PM</p></div><button type="button" aria-label="ปิด" onClick={onClose}>×</button></header>
    <form className="admin-form" onSubmit={handleSubmit}>
      {error && <p className="wide" role="alert">{error}</p>}
      <label>Asset ID<input name="id" required readOnly={Boolean(initial)} defaultValue={initial?.id} /></label>
      <label>ชื่อเครื่องจักร<input name="name" required defaultValue={initial?.name} /></label>
      <label>ประเภท<input name="type" required defaultValue={initial?.type ?? "AHU"} /></label>
      <label>ไซต์<select name="jobsiteId" value={siteId} required onChange={(event) => { setSiteId(event.target.value); setLocationId(""); }}>{state.jobsites.map((site) => <option key={site.id} value={site.id}>{site.id} - {site.name}</option>)}</select></label>
      <label className="wide">ตำแหน่งจากทะเบียน<select name="locationId" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">ระบุเอง (ไม่ผูกทะเบียนตำแหน่ง)</option>{state.locations.filter((item) => item.jobsiteId === siteId).map((item) => <option key={item.id} value={item.id}>{locationLabel(item)}</option>)}</select></label>
      <div className="asset-location-fields wide" key={`${siteId}:${locationId}`}>
        <label className="wide">ตำแหน่งติดตั้ง<input name="location" required readOnly={Boolean(selectedLocation)} defaultValue={selectedLocation ? locationLabel(selectedLocation) : siteId === initial?.jobsiteId ? initial.location : ""} /></label>
        {([['building', 'อาคาร'], ['floor', 'ชั้น'], ['room', 'ห้อง']] as const).map(([field, label]) => <label key={field}>{label}<input name={field} maxLength={200} readOnly={Boolean(selectedLocation)} defaultValue={selectedLocation?.[field] ?? (siteId === initial?.jobsiteId ? initial[field] : "")} /></label>)}
      </div>
      {([['manufacturer', 'ผู้ผลิต'], ['model', 'รุ่น'], ['serialNumber', 'Serial Number']] as const).map(([field, label]) => <label key={field}>{label}<input name={field} maxLength={200} defaultValue={initial?.[field]} /></label>)}
      <label>สถานะ<select name="health" defaultValue={initial?.health ?? "ปกติ"}><option>ปกติ</option><option>เฝ้าระวัง</option><option>วิกฤต</option></select></label>
      <label>ข้อมูล Sensor<input name="sensor" required defaultValue={initial?.sensor ?? "ยังไม่เชื่อมต่อ"} /></label>
      <label>PM ล่าสุด<input name="lastPm" type="date" defaultValue={initial?.lastPm} /></label><label>PM ครั้งถัดไป<input name="nextPm" type="date" defaultValue={initial?.nextPm} /></label>
      <label className="admin-check wide"><input name="active" type="checkbox" defaultChecked={initial?.active ?? true} /> เปิดใช้งานเครื่องจักร</label>
      <div className="admin-form-actions"><button type="button" onClick={onClose}>ยกเลิก</button><button className="primary" type="submit">บันทึกเครื่องจักร</button></div>
    </form></section></div>;
}
