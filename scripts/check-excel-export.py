"""Validate downloaded Demo exports using an independent XLSX reader.
Usage: python scripts/check-excel-export.py <browser-test-output-dir> <UI actual>
Requires openpyxl; reads only synthetic local browser-test output.
"""
from pathlib import Path
import sys
import openpyxl

base = Path(sys.argv[1]).resolve()
workbook = openpyxl.load_workbook(base / 'performance.xlsx', data_only=False)
assert workbook.sheetnames == ['สรุปและขอบเขต', 'ผลแยกตามรอบ', 'Service Reports', 'ข้อมูลการส่งออก']
metadata = dict(workbook['ข้อมูลการส่งออก'].iter_rows(min_row=2, values_only=True))
assert metadata['เวลาออกไฟล์ UTC'].endswith('Z')
assert metadata['แหล่งข้อมูล'].startswith('http://127.0.0.1:5181')
summary = dict(workbook.worksheets[0].iter_rows(min_row=2, values_only=True))
rows = list(workbook['Service Reports'].iter_rows(min_row=2))
assert summary['Actual'] == sum(row[10].value for row in rows) == float(sys.argv[2])
fixture = next(row for row in rows if row[0].value == 'SR-UAT-FORMULA')
assert fixture[13].value == '=HYPERLINK("https://example.invalid")'
assert fixture[13].data_type == 's' and fixture[10].value == 0
assert all(cell.data_type != 'f' for sheet in workbook for row in sheet for cell in row)
monthly = openpyxl.load_workbook(base / 'performance-january.xlsx', data_only=False)
filters = dict(monthly.worksheets[0].iter_rows(min_row=2, values_only=True))
source = list(monthly['Service Reports'].iter_rows(min_row=2, values_only=True))
assert filters['เดือน'] == '1'
assert all(row[7][5:7] == '01' for row in source)
assert filters['Actual'] == sum(row[10] for row in source)
print('PASS: Thai/numeric XLSX roundtrip, displayed Actual matches approved reports, formula-like text remains literal, January scope matches source')
