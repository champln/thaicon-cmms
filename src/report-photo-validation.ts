export function validateReportPhotoSelection(existingCount: number, files: Array<{name: string; type: string; size: number}>) {
  if (existingCount + files.length > 4) throw new Error("แนบรูปได้รวมสูงสุด 4 รูป กรุณาเลือกรูปใหม่หรือลบรูปเดิมก่อน ข้อมูลในฟอร์มยังอยู่");
  for (const file of files) {
    if (!["image/png","image/jpeg","image/webp"].includes(file.type)) throw new Error(`ไฟล์ ${file.name} ต้องเป็น PNG, JPEG หรือ WebP`);
    if (file.size < 1 || file.size > 2_000_000) throw new Error(`ไฟล์ ${file.name} ต้องมีขนาดไม่เกิน 2 MB และไม่เป็นไฟล์ว่าง`);
  }
}
