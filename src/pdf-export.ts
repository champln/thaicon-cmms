type PdfSection = {
  label: string;
  value: string;
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

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    const timeout = window.setTimeout(() => resolve(null), 2500);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
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
}: {
  filename: string;
  documentTitle: string;
  documentNumber: string;
  subtitle: string;
  sections: PdfSection[];
  photos?: Array<{ name: string; dataUrl: string }>;
}) {
  const { jsPDF } = await import("jspdf");
  await document.fonts.ready;
  const pages: HTMLCanvasElement[] = [];
  let { canvas, context } = createPage();
  let y = MARGIN;

  const finishPage = () => {
    context.strokeStyle = "#dce4ec";
    context.beginPath();
    context.moveTo(MARGIN, PAGE_HEIGHT - 72);
    context.lineTo(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 72);
    context.stroke();
    context.fillStyle = "#738094";
    context.font = "20px Anuphan, Arial, sans-serif";
    context.fillText("เอกสารสร้างจากระบบ ThaiCon CMMS", MARGIN, PAGE_HEIGHT - 54);
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
  context.fillText(subtitle, MARGIN, y);
  context.font = "700 25px Anuphan, Arial, sans-serif";
  const numberWidth = context.measureText(documentNumber).width;
  context.fillText(documentNumber, PAGE_WIDTH - MARGIN - numberWidth, y);
  y += 52;
  context.fillStyle = "#1262a3";
  context.fillRect(MARGIN, y, CONTENT_WIDTH, 7);
  y += 38;

  for (const section of sections) {
    context.font = "26px Anuphan, Arial, sans-serif";
    const valueLines = wrapText(context, section.value || "-", CONTENT_WIDTH - 330);
    const sectionHeight = Math.max(58, valueLines.length * 38 + 25);
    if (y + sectionHeight > PAGE_HEIGHT - 110) nextPage();

    context.fillStyle = "#536477";
    context.font = "700 24px Anuphan, Arial, sans-serif";
    context.fillText(section.label, MARGIN, y + 13);
    context.fillStyle = "#152235";
    context.font = "26px Anuphan, Arial, sans-serif";
    valueLines.forEach((line, index) => context.fillText(line, MARGIN + 310, y + 11 + (index * 38)));
    context.strokeStyle = "#dfe6ed";
    context.beginPath();
    context.moveTo(MARGIN, y + sectionHeight);
    context.lineTo(PAGE_WIDTH - MARGIN, y + sectionHeight);
    context.stroke();
    y += sectionHeight;
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
      const image = await loadImage(photos[index].dataUrl);
      if (image) {
        const scale = Math.min((cardWidth - 20) / image.width, 260 / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        context.drawImage(image, x + ((cardWidth - drawWidth) / 2), y + 10 + ((260 - drawHeight) / 2), drawWidth, drawHeight);
      } else {
        context.fillStyle = "#eef3f7";
        context.fillRect(x + 10, y + 10, cardWidth - 20, 260);
      }
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
  pdf.save(filename);
}
