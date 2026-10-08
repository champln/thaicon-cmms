import {describe,it,expect} from "vitest";
import {validateReportPhotoSelection} from "./report-photo-validation";
const file={name:"proof.png",type:"image/png",size:100};
describe("photo selection never silently drops evidence",()=>{
  it("rejects five new files and existing three plus two",()=>{expect(()=>validateReportPhotoSelection(0,Array(5).fill(file))).toThrow("4 รูป");expect(()=>validateReportPhotoSelection(3,[file,file])).toThrow("4 รูป");});
  it("accepts four and existing three plus one",()=>{expect(()=>validateReportPhotoSelection(0,Array(4).fill(file))).not.toThrow();expect(()=>validateReportPhotoSelection(3,[file])).not.toThrow();});
  it("rejects unsupported/empty/oversized with actionable message",()=>{expect(()=>validateReportPhotoSelection(0,[{...file,type:"image/gif"}])).toThrow("PNG, JPEG หรือ WebP");expect(()=>validateReportPhotoSelection(0,[{...file,size:2_000_001}])).toThrow("2 MB");expect(()=>validateReportPhotoSelection(0,[{...file,size:0}])).toThrow();});
});
