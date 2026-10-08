import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ toFile: vi.fn(), toBlob: vi.fn(), write: vi.fn() }));
vi.mock("write-excel-file/browser", () => ({ default: mock.write }));
import { downloadExcel } from "./excel-export";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("Excel final emission scope guard", () => {
  it("checks again after async blob generation and emits nothing if scope changed", async () => {
    vi.stubGlobal("window", { location: { origin: "http://test.invalid", pathname: "/" } });
    mock.write.mockReturnValue({ toFile: mock.toFile, toBlob: mock.toBlob });
    let current = true;
    mock.toBlob.mockImplementation(async () => { current = false; return new Blob(["test"]); });
    await expect(downloadExcel("report.xlsx", [{ name: "test", headers: ["value"], rows: [["literal"]] }], () => { if (!current) throw new Error("scope changed"); })).rejects.toThrow("scope changed");
    expect(mock.toBlob).toHaveBeenCalledOnce();
    expect(mock.toFile).not.toHaveBeenCalled();
  });
  it("keeps existing unguarded callers compatible", async () => {
    vi.stubGlobal("window", { location: { origin: "http://test.invalid", pathname: "/" } });
    mock.write.mockReturnValue({ toFile: mock.toFile, toBlob: mock.toBlob });
    mock.toFile.mockResolvedValue(undefined);
    await downloadExcel("report.xlsx", [{ name: "test", headers: ["value"], rows: [["literal"]] }]);
    expect(mock.toFile).toHaveBeenCalledWith("report.xlsx");
    expect(mock.toBlob).not.toHaveBeenCalled();
  });
});
