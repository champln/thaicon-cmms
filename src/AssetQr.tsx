import { useEffect, useState } from "react";
import { buildAssetLink } from "./asset-link";
import "./asset-qr.css";

export default function AssetQr({ siteId, assetId, demo }: { siteId: string; assetId: string; demo: boolean }) {
  const link = buildAssetLink(window.location.href, { siteId, assetId });
  const [image, setImage] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setImage(""); setError(false); setMessage("");
    void import("qrcode").then(qr => qr.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: "M" }))
      .then(result => { if (!cancelled) setImage(result); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [link]);
  return <section className="asset-qr" aria-label="QR เครื่องจักร">
    <h3>QR เครื่องจักร</h3>
    <p>สแกนเพื่อเปิดรายละเอียดและประวัติ ต้องเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์ดูเครื่องจักรในไซต์นี้</p>
    {image ? <img src={image} width={240} height={240} alt={`QR เปิดเครื่องจักร ${assetId}`} /> : <p role="status">{error ? "สร้าง QR ไม่สำเร็จ ใช้ลิงก์ด้านล่างได้" : "กำลังสร้าง QR…"}</p>}
    <label>ลิงก์เครื่องจักร<input readOnly value={link} onFocus={event => event.currentTarget.select()} /></label>
    <div className="asset-qr-actions">
      <button type="button" className="cmms-secondary-button" onClick={async () => {
        try { await navigator.clipboard.writeText(link); setMessage("คัดลอกลิงก์แล้ว"); }
        catch { setMessage("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกและคัดลอกลิงก์ด้านบน"); }
      }}>คัดลอกลิงก์</button>
      {image && <a className="cmms-secondary-button" href={image} download={`asset-qr-${assetId.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`}>ดาวน์โหลด QR</a>}
    </div>
    <p role="status">{message}</p>
    {demo && <p>โหมด Demo: ข้อมูลอยู่ในเบราว์เซอร์ เครื่องอื่นจะไม่เห็นข้อมูลที่เพิ่มจากเครื่องนี้</p>}
    <p>ก่อนพิมพ์ติดเครื่องจักร ให้ใช้โดเมนถาวร ลิงก์ local หรือ tunnel อาจเปิดจากภายนอกไม่ได้หรือหมดอายุ</p>
  </section>;
}
