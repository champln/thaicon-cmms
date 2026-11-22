type PdfSection = {
  label: string;
  value: string;
  pageBreakBefore?: boolean;
};

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 80;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);

function wrapText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const paragraphs = (value || "-").split("\n");
  const lines: string[] = [];
  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      lines.push("");
      return;
    }
    let line = "";
    Array.from(paragraph).forEach((character) => {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line.trimEnd());
  });
  return lines;
}

export function loadReportImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    // Signed Storage URLs authorize in the URL, not browser cookies. Setting
    // CORS before src keeps remote proof images from tainting the PDF canvas.
    image.crossOrigin = "anonymous";
    const fail = () => reject(new Error("โหลดภาพหลักฐานไม่สำเร็จ กรุณาโหลดรายงานใหม่เพื่อต่ออายุลิงก์ภาพ แล้วลองส่งออก PDF อีกครั้ง"));
    const timeout = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      fail();
    }, 10000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      fail();
    };
    image.src = src;
  });
}

function createPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Browser does not support Canvas PDF generation");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.textBaseline = "top";
  return { canvas, context };
}

export async function downloadMaintenancePdf({
  filename,
  documentTitle,
  documentNumber,
  subtitle,
  sections,
  photos = [],
  assertCurrent,
  archivedAt,
  capture,
}: {
  filename: string;
  documentTitle: string;
  documentNumber: string;
  subtitle: string;
  sections: PdfSection[];
  photos?: Array<{ name: string; dataUrl: string }>;
  assertCurrent?: () => void | Promise<void>;
  archivedAt?: string;
  capture?: (blob: Blob) => void;
}) {
  await assertCurrent?.();
  const { jsPDF } = await import("jspdf");
  await document.fonts.ready;
  const pages: HTMLCanvasElement[] = [];
  let { canvas, context } = createPage();
  let y = MARGIN;
  const exportedAt = archivedAt ?? new Date().toISOString();

  const finishPage = () => {
    context.strokeStyle = "#dce4ec";
    context.beginPath();
    context.moveTo(MARGIN, PAGE_HEIGHT - 72);
    context.lineTo(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 72);
    context.stroke();
    context.fillStyle = "#738094";
    context.font = "18px Anuphan, Arial, sans-serif";
    context.fillText(`ThaiCon CMMS | เวลาออกไฟล์ UTC ${exportedAt} | หน้า ${pages.length + 1}`, MARGIN, PAGE_HEIGHT - 54);
    pages.push(canvas);
  };

  const nextPage = () => {
    finishPage();
    ({ canvas, context } = createPage());
    y = MARGIN;
    context.fillStyle = "#1262a3";
    context.font = "700 23px Anuphan, Arial, sans-serif";
    context.fillText(`${documentTitle} • ${documentNumber} (ต่อ)`, MARGIN, y);
    y += 58;
  };

  context.fillStyle = "#1262a3";
  context.font = "700 22px Anuphan, Arial, sans-serif";
  context.fillText("THAICON MAINTENANCE CLOUD", MARGIN, y);
  y += 48;
  context.fillStyle = "#152235";
  context.font = "700 48px Anuphan, Arial, sans-serif";
  context.fillText(documentTitle, MARGIN, y);
  y += 68;
  context.fillStyle = "#5f6f82";
  context.font = "25px Anuphan, Arial, sans-serif";
  const subtitleLines = wrapText(context, subtitle, CONTENT_WIDTH);
  subtitleLines.forEach((line,index) => context.fillText(line,MARGIN,y + index*36));
  y += subtitleLines.length*36;
  context.font = "700 25px Anuphan, Arial, sans-serif";
  context.fillText(documentNumber, MARGIN, y);
  y += 52;
  context.fillStyle = "#1262a3";
  context.fillRect(MARGIN, y, CONTENT_WIDTH, 7);
  y += 38;

  for (const section of sections) {
    if (section.pageBreakBefore) nextPage();
    context.font = "26px Anuphan, Arial, sans-serif";
    const valueLines = wrapText(context, section.value || "-", CONTENT_WIDTH - 330);
    let offset = 0;
    while (offset < valueLines.length) {
      if (y + 63 > PAGE_HEIGHT - 110) nextPage();
      const available = Math.max(1, Math.floor((PAGE_HEIGHT - 110 - y - 25) / 38));
      const segment = valueLines.slice(offset, offset + available);
      const sectionHeight = Math.max(58, segment.length * 38 + 25);
      context.fillStyle = "#536477";
      context.font = "700 24px Anuphan, Arial, sans-serif";
      context.fillText(section.label + (offset ? " (ต่อ)" : ""), MARGIN, y + 13, 280);
      context.fillStyle = "#152235";
      context.font = "26px Anuphan, Arial, sans-serif";
      segment.forEach((line, index) => context.fillText(line, MARGIN + 310, y + 11 + (index * 38)));
      context.strokeStyle = "#dfe6ed";
      context.beginPath();
      context.moveTo(MARGIN, y + sectionHeight);
      context.lineTo(PAGE_WIDTH - MARGIN, y + sectionHeight);
      context.stroke();
      y += sectionHeight;
      offset += segment.length;
      if (offset < valueLines.length) nextPage();
    }
  }

  if (photos.length) {
    if (y + 360 > PAGE_HEIGHT - 110) nextPage();
    y += 35;
    context.fillStyle = "#20364d";
    context.font = "700 30px Anuphan, Arial, sans-serif";
    context.fillText("ภาพประกอบการปฏิบัติงาน", MARGIN, y);
    y += 55;

    const cardWidth = (CONTENT_WIDTH - 24) / 2;
    const cardHeight = 330;
    for (let index = 0; index < photos.length; index += 1) {
      if (index > 0 && index % 2 === 0) y += cardHeight + 20;
      if (y + cardHeight > PAGE_HEIGHT - 110) nextPage();
      const x = MARGIN + ((index % 2) * (cardWidth + 24));
      context.strokeStyle = "#dfe6ed";
      context.strokeRect(x, y, cardWidth, cardHeight);
      const image = await loadReportImage(photos[index].dataUrl);
      const scale = Math.min((cardWidth - 20) / image.width, 260 / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.drawImage(image, x + ((cardWidth - drawWidth) / 2), y + 10 + ((260 - drawHeight) / 2), drawWidth, drawHeight);
      context.fillStyle = "#66768a";
      context.font = "20px Anuphan, Arial, sans-serif";
      context.fillText(photos[index].name, x + 12, y + 286, cardWidth - 24);
    }
    y += cardHeight;
  }

  finishPage();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage();
    pdf.addImage(page.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 210, 297);
  });
  await assertCurrent?.();
  if (capture) capture(pdf.output('blob'));
  else pdf.save(filename);
}
