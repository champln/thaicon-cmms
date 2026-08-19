import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import CMMSApp from "./CMMSApp";
import {
  authenticateDemoUser,
  demoUsers,
  getJobsitesForUser,
  getUserById,
  roleLabels,
} from "./access";
import type { DemoUser, Jobsite } from "./access";
import "./access.css";

const STORAGE_KEY = "thaicon-cmms-demo-session-v1";

type StoredSession = {
  userId: string;
  jobsiteId: string | null;
};

function readStoredSession(): StoredSession | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    if (typeof parsed.userId !== "string") return null;
    return {
      userId: parsed.userId,
      jobsiteId: typeof parsed.jobsiteId === "string" ? parsed.jobsiteId : null,
    };
  } catch {
    return null;
  }
}

function LoginPage({ onLogin }: { onLogin: (user: DemoUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = authenticateDemoUser(username, password);
    if (!user) {
      setError("ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง");
      return;
    }
    setError("");
    onLogin(user);
  };

  const useDemoAccount = (user: DemoUser) => {
    setUsername(user.username);
    setPassword(user.password);
    setError("");
  };

  return (
    <main className="access-shell">
      <section className="access-visual" aria-label="ThaiCon Maintenance Cloud">
        <div className="access-brand">
          <img src={`${import.meta.env.BASE_URL}brand/thaicon-logo.jpg`} alt="ThaiCon" />
          <span><strong>ThaiCon</strong><small>MAINTENANCE CLOUD</small></span>
        </div>
        <div className="access-visual-copy">
          <span>CMMS • PM • SERVICE OPERATIONS</span>
          <h1>ติดตามงานบำรุงรักษา<br />แยกตามไซต์อย่างปลอดภัย</h1>
          <p>ต้นแบบระบบ Login และสิทธิ์เข้าถึง Jobsite สำหรับตรวจสอบกับลูกค้าก่อนเชื่อมต่อฐานข้อมูลจริง</p>
        </div>
        <div className="access-security-note">
          <i />
          <span><strong>Jobsite scoped access</strong><small>ผู้ใช้จะเห็นเฉพาะไซต์ที่ได้รับอนุญาต</small></span>
        </div>
      </section>

      <section className="access-panel">
        <div className="access-form-wrap">
          <span className="access-eyebrow">WELCOME BACK</span>
          <h2>เข้าสู่ระบบ</h2>
          <p>กรอกบัญชีผู้ใช้งานเพื่อเข้าสู่ ThaiCon CMMS</p>

          <form onSubmit={submit}>
            <label>
              ชื่อผู้ใช้งาน
              <input
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="เช่น admin"
                required
              />
            </label>
            <label>
              รหัสผ่าน
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="กรอกรหัสผ่าน"
                required
              />
            </label>
            {error && <div className="access-error" role="alert">{error}</div>}
            <button className="access-submit" type="submit">เข้าสู่ระบบ <span>→</span></button>
          </form>

          <div className="access-demo-accounts">
            <div><span>บัญชีสำหรับทดสอบ</span><small>รหัสผ่านทุกบัญชี: demo123</small></div>
            <div className="access-demo-grid">
              {demoUsers.map((user) => (
                <button type="button" key={user.id} onClick={() => useDemoAccount(user)}>
                  <span>{user.initials}</span>
                  <p><strong>{roleLabels[user.role]}</strong><small>{user.username}</small></p>
                </button>
              ))}
            </div>
          </div>
        </div>
        <small className="access-footer">DEMO AUTHENTICATION • ยังไม่ใช่ระบบ Production</small>
      </section>
    </main>
  );
}

function JobsiteSelector({
  user,
  sites,
  onSelect,
  onLogout,
}: {
  user: DemoUser;
  sites: Jobsite[];
  onSelect: (site: Jobsite) => void;
  onLogout: () => void;
}) {
  return (
    <main className="site-select-shell">
      <header className="site-select-header">
        <div className="access-brand dark">
          <img src={`${import.meta.env.BASE_URL}brand/thaicon-logo.jpg`} alt="ThaiCon" />
          <span><strong>ThaiCon</strong><small>MAINTENANCE CLOUD</small></span>
        </div>
        <div className="site-select-user">
          <span>{user.initials}</span>
          <p><strong>{user.displayName}</strong><small>{roleLabels[user.role]} • {user.title}</small></p>
          <button type="button" onClick={onLogout}>ออกจากระบบ</button>
        </div>
      </header>

      <section className="site-select-content">
        <span className="access-eyebrow">AUTHORIZED JOBSITES</span>
        <h1>เลือกไซต์ที่ต้องการเข้าถึง</h1>
        <p>ระบบแสดงเฉพาะ Jobsite ที่บัญชีของคุณได้รับอนุญาต</p>

        <div className="site-select-grid">
          {sites.map((site) => (
            <button type="button" className="site-option" key={site.id} onClick={() => onSelect(site)}>
              <div className="site-option-top">
                <span>TC</span>
                <small>{site.id}</small>
              </div>
              <h2>{site.name}</h2>
              <p>{site.type} • {site.province}</p>
              <dl>
                <div><dt>เครื่องจักร</dt><dd>{site.assetCount}</dd></div>
                <div><dt>ใบงานเปิด</dt><dd>{site.openWorkOrders}</dd></div>
                <div><dt>PM</dt><dd>{site.pmCompliance}%</dd></div>
              </dl>
              <span className="site-option-action">เข้าสู่ไซต์ <b>→</b></span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const initialSession = useMemo(readStoredSession, []);
  const [user, setUser] = useState<DemoUser | null>(() =>
    initialSession ? getUserById(initialSession.userId) : null,
  );
  const [jobsiteId, setJobsiteId] = useState<string | null>(initialSession?.jobsiteId ?? null);

  const allowedSites = useMemo(() => user ? getJobsitesForUser(user) : [], [user]);
  const selectedSite = allowedSites.find((site) => site.id === jobsiteId) ?? null;

  useEffect(() => {
    if (!user) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: user.id, jobsiteId }));
  }, [jobsiteId, user]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [jobsiteId, user?.id]);

  const logout = () => {
    setUser(null);
    setJobsiteId(null);
  };

  if (!user) {
    return <LoginPage onLogin={(nextUser) => { setUser(nextUser); setJobsiteId(null); }} />;
  }

  if (!selectedSite) {
    return <JobsiteSelector user={user} sites={allowedSites} onSelect={(site) => setJobsiteId(site.id)} onLogout={logout} />;
  }

  return (
    <CMMSApp
      activeJobsite={selectedSite}
      allowedJobsites={allowedSites}
      currentUser={user}
      onChangeJobsite={() => setJobsiteId(null)}
      onLogout={logout}
    />
  );
}
