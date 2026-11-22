const equipmentLabels = ['ทะเบียนเครื่องจักร', 'ใบงาน', 'ใบแจ้งซ่อม'];

export async function openGroupedSection(page, name) {
  const root = equipmentLabels.includes(name) ? 'เครื่องจักร' : 'ภาพรวม';
  const section = page.getByRole('navigation', { name: `มุมมอง${root}` });
  if (!(await section.isVisible())) {
    await page.getByRole('navigation', { name: 'เมนูหลัก' }).getByRole('button', { name: root, exact: true }).click();
  }
  await section.getByRole('button', { name, exact: true }).click();
}
