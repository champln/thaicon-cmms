import { downloadExcel, type ExcelSheet } from './excel-export';
import { downloadMaintenancePdf, loadReportImage } from './pdf-export';
import { repairRequestSheet, serviceReportSheet } from './maintenance-excel';
import type { DeliveryIssue } from './demo-contract-delivery';

const missing = (value: number | null) => value ?? '—';
const kindLabel = (kind: string) => kind === 'major' ? 'ล้างใหญ่' : kind === 'minor' ? 'ล้างย่อย' : 'ทุกประเภท';
const typeLabel = (type: string) => type === 'SPT' ? 'Split Type' : type;
const photoRows = (issue: DeliveryIssue) => issue.sources.flatMap(({report})=>
  report.attachments.map(photo=>({id:report.id,name:photo.name,dataUrl:photo.dataUrl})));

export function deliverySheets(issue: DeliveryIssue): ExcelSheet[] {
  const {filters} = issue;
  const sources=issue.sources.map(({report})=>report);
  const sourceSheet=serviceReportSheet(sources);
  sourceSheet.headers.push('ประเภทตรวจรับ','ผู้ตรวจรับ','เวลาตรวจรับ UTC');
  sourceSheet.rows.forEach((row,index)=>{
    const source=issue.sources[index];
    row.push(source.receiptType==='customer' ? 'ลูกค้า' : 'จำลอง',source.acceptedBy,source.acceptedAt);
  });
  return [
    {name:'ข้อมูลฉบับส่งมอบ',headers:['รายการ','ค่า'],rows:[
      ['โหมด',issue.online ? 'UAT' : 'Demo'],['เลขอ้างอิง',issue.id],['ฉบับที่',issue.revision],['งวด',issue.period],
      ['สัญญา',issue.contractName],['รุ่นสัญญา',issue.contractVersion],['ไซต์',issue.siteName],['รหัสไซต์',issue.site],
      ['ช่วงสัญญา',issue.startDate+' ถึง '+issue.endDate],['เวลาออกฉบับ UTC',issue.issuedAt],
      ['เดือน',filters.month||'ทุกเดือน'],['อาคาร',filters.building||'ทุกอาคาร'],
      ['ประเภทเครื่อง',typeLabel(filters.type)||'ทุกประเภท'],['ประเภทล้าง',kindLabel(filters.kind)],
      ['รายการเว้นจากยอด',issue.excluded],['หมายเหตุ','ยอดสะสมเริ่มจากเดือนแรกตามตัวกรองอาคารและประเภท ช่อง — หมายถึงยังไม่มีเป้าหมายหรือคำนวณไม่ได้'],
    ]},
    {name:'สรุปรายเดือน',headers:['เดือน','เป้าหมาย','ตรวจรับแล้ว','เทียบเป้า (%)','เป้าสะสม','ตรวจรับสะสม'],
      rows:issue.monthly.map(row=>[row.month,missing(row.target),row.actual,missing(row.progress),missing(row.cumulativeTarget),row.cumulativeActual])},
    {name:'รายละเอียดตามกลุ่ม',headers:['เดือน','อาคาร','ประเภทเครื่อง','ประเภทล้าง','เป้าหมาย','ตรวจรับแล้ว','ผลต่าง','Service Report'],
      rows:issue.detail.map(row=>[row.month,row.building,typeLabel(row.assetType),kindLabel(row.kind),missing(row.target),row.actual,missing(row.difference),row.reportIds.join(', ')])},
    {name:'สิ่งที่พบและการแก้ไข',headers:['Service Report','เครื่อง','วันที่','สิ่งที่พบ','การดำเนินการ'],
      rows:sources.filter(row=>row.findings.trim()||row.actionTaken.trim()).map(row=>[row.id,row.assetId,row.serviceDate,row.findings,row.actionTaken])},
    repairRequestSheet(issue.repairs),
    sourceSheet,
  ];
}

async function excelPhotos(issue: DeliveryIssue): Promise<ExcelSheet> {
  const photos=photoRows(issue);
  const images: NonNullable<ExcelSheet['images']> = [];
  for(const [index,photo] of photos.entries()){
    const image=await loadReportImage(photo.dataUrl);
    const scale=Math.min(1,220/image.naturalWidth,120/image.naturalHeight);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');
    if(!context) throw new Error('เตรียมรูปสำหรับ Excel ไม่สำเร็จ');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const content=await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(blob=>blob ? resolve(blob) : reject(new Error('เตรียมรูปสำหรับ Excel ไม่สำเร็จ')),'image/png');
    });
    images.push({content,contentType:'image/png',width:canvas.width,height:canvas.height,dpi:96,
      anchor:{row:index+2,column:3},offsetX:4,offsetY:4,title:photo.name,description:photo.id});
  }
  return {name:'รูปประกอบ',headers:['Service Report','ชื่อรูป','รูป'],rows:photos.map(photo=>[photo.id,photo.name,'']),images,rowHeight:100};
}

export async function downloadDelivery(issue: DeliveryIssue, format: 'pdf'|'xlsx', assertCurrent:()=>void | Promise<void>, capture?: (blob:Blob)=>void) {
  const filename=`ThaiCon-${issue.online ? 'UAT' : 'Demo'}-${issue.id}-R${issue.revision}`;
  const sheets=deliverySheets(issue);
  if (format==='xlsx') {
    const photos=await excelPhotos(issue);
    await downloadExcel(filename+'.xlsx',[...sheets,photos],assertCurrent,issue.issuedAt,capture);
    return;
  }
  const sections=sheets.flatMap((sheet,index)=>[
    ...(index>0 ? [{label:sheet.name,value:sheet.rows.length ? '' : 'ไม่มีรายการ',pageBreakBefore:index===1}] : []),
    ...sheet.rows.map(row=>({label:String(row[0]),value:index===0 ? String(row[1]) :
      row.slice(1).map((value,i)=>`${sheet.headers[i+1]}  ${value || (value===0 ? '0' : '—')}`).join('\n')})),
    ...(index===0 ? [{label:'สารบัญ',value:[
      'สรุปรายเดือน · รายละเอียดตามกลุ่ม',
      'สิ่งที่พบและการแก้ไข · ใบแจ้งซ่อม',
      'Service Reports · รูปประกอบการปฏิบัติงาน',
    ].join('\n')}] : []),
  ]);
  await downloadMaintenancePdf({
    filename:filename+'.pdf',documentTitle:issue.online ? 'รายงานส่งมอบ (UAT)' : 'รายงานส่งมอบ (Demo)',documentNumber:`ฉบับที่ ${issue.revision}`,
    subtitle:`${issue.siteName} · ${issue.period} · ${issue.contractName}`,sections,archivedAt:issue.issuedAt,assertCurrent,capture,
    photos:photoRows(issue).map(photo=>({name:`${photo.id} · ${photo.name}`,dataUrl:photo.dataUrl})),
  });
}
