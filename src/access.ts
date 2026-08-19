export type UserRole = "admin" | "engineer" | "user";

export type Jobsite = {
  id: string;
  name: string;
  province: string;
  type: string;
  assetCount: number;
  openWorkOrders: number;
  pmCompliance: number;
};

export type DemoUser = {
  id: string;
  username: string;
  password: string;
  displayName: string;
  initials: string;
  role: UserRole;
  title: string;
  jobsiteIds: string[];
};

export const roleLabels: Record<UserRole, string> = {
  admin: "ผู้ดูแลระบบ",
  engineer: "วิศวกร",
  user: "ผู้ใช้งาน",
};

export const jobsites: Jobsite[] = [
  { id: "SITE-001", name: "โรงพยาบาลกลาง", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", assetCount: 142, openWorkOrders: 3, pmCompliance: 92 },
  { id: "SITE-002", name: "โรงพยาบาลนพรัตนราชธานี", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", assetCount: 186, openWorkOrders: 4, pmCompliance: 96 },
  { id: "SITE-003", name: "โรงพยาบาลสิรินธร", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", assetCount: 98, openWorkOrders: 1, pmCompliance: 98 },
  { id: "SITE-004", name: "มหาวิทยาลัยธรรมศาสตร์", province: "ปทุมธานี", type: "มหาวิทยาลัย", assetCount: 76, openWorkOrders: 2, pmCompliance: 95 },
  { id: "SITE-005", name: "โรงพยาบาลพญาไท 2", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", assetCount: 114, openWorkOrders: 1, pmCompliance: 97 },
  { id: "SITE-006", name: "โรงพยาบาลพญาไท 3", province: "กรุงเทพมหานคร", type: "โรงพยาบาล", assetCount: 88, openWorkOrders: 2, pmCompliance: 94 },
];

export const demoUsers: DemoUser[] = [
  {
    id: "USR-ADMIN-001",
    username: "admin",
    password: "demo123",
    displayName: "สิทธา สายสวรรค์",
    initials: "สส",
    role: "admin",
    title: "System Administrator",
    jobsiteIds: jobsites.map((site) => site.id),
  },
  {
    id: "USR-ENG-001",
    username: "engineer",
    password: "demo123",
    displayName: "อนุชา วิศวกร",
    initials: "อว",
    role: "engineer",
    title: "Service Engineer",
    jobsiteIds: ["SITE-001", "SITE-002"],
  },
  {
    id: "USR-USER-001",
    username: "user",
    password: "demo123",
    displayName: "กานดา ฝ่ายอาคาร",
    initials: "กฝ",
    role: "user",
    title: "Customer Viewer",
    jobsiteIds: ["SITE-001"],
  },
];

export function authenticateDemoUser(username: string, password: string) {
  const normalized = username.trim().toLocaleLowerCase("en");
  return demoUsers.find(
    (user) => user.username === normalized && user.password === password,
  ) ?? null;
}

export function getUserById(userId: string) {
  return demoUsers.find((user) => user.id === userId) ?? null;
}

export function getJobsitesForUser(user: DemoUser) {
  const allowed = new Set(user.jobsiteIds);
  return jobsites.filter((site) => allowed.has(site.id));
}

