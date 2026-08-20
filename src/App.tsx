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
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  restoreSupabaseAccess,
  signInWithSupabase,
  signOutFromSupabase,
  SupabaseAccessError,
} from "./supabase-auth";
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

function LoginPage({
  initialError,
  onLogin,
  useSupabase,
}: {
  initialError: string;
  onLogin: (identifier: string, password: string) => Promise<void>;
  useSupabase: boolean;
}) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(identifier, password);
    } catch (loginError) {
      setError(
        loginError instanceof SupabaseAccessError
          ? loginError.userMessage
          : loginError instanceof Error
            ? loginError.message
            : "เข้าสู่ระบบไม่สำเร็จ",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const useDemoAccount = (user: DemoUser) => {
    setIdentifier(user.username);
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
          <span>ระบบบริหารงานบำรุงรักษา</span>
          <h1>จัดการงานบำรุงรักษา<br />แยกตามไซต์</h1>
          <p>ติดตามใบงาน แผน PM เครื่องจักร และ Alarm ของแต่ละไซต์</p>
        </div>
        <div className="access-security-note">
          <i />
          <span><strong>สิทธิ์การเข้าถึงตามไซต์</strong><small>แสดงเฉพาะไซต์ที่บัญชีเข้าถึงได้</small></span>
        </div>
      </section>

      <section className="access-panel">
        <div className="access-form-wrap">
          <span className="access-eyebrow">THAICON CMMS</span>
          <h2>เข้าสู่ระบบ</h2>
          <p>เข้าสู่ระบบเพื่อใช้งาน CMMS</p>

          <form onSubmit={submit}>
            <label>
              {useSupabase ? "อีเมล" : "ชื่อผู้ใช้งาน"}
              <input
                autoComplete={useSupabase ? "email" : "username"}
                autoFocus
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder={useSupabase ? "name@company.com" : "เช่น admin"}
                required
                type={useSupabase ? "email" : "text"}
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
            <button className="access-submit" disabled={submitting} type="submit">
              {submitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"} <span>→</span>
            </button>
          </form>

          {!useSupabase && (
            <div className="access-demo-accounts">
              <div><span>บัญชีทดสอบ</span><small>รหัสผ่านทุกบัญชี: demo123</small></div>
              <div className="access-demo-grid">
                {demoUsers.map((user) => (
                  <button type="button" key={user.id} onClick={() => useDemoAccount(user)}>
                    <span>{user.initials}</span>
                    <p><strong>{roleLabels[user.role]}</strong><small>{user.username}</small></p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <small className="access-footer">
          {useSupabase ? "SUPABASE AUTHENTICATION" : "ระบบทดสอบ • ข้อมูลจำลอง"}
        </small>
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
        <span className="access-eyebrow">รายการไซต์</span>
        <h1>เลือกไซต์งาน</h1>
        <p>ไซต์ที่บัญชีนี้เข้าถึงได้</p>

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
        {sites.length === 0 && (
          <div className="site-select-empty">บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าไซต์</div>
        )}
      </section>
    </main>
  );
}

export default function App() {
  const initialSession = useMemo(
    () => isSupabaseConfigured ? null : readStoredSession(),
    [],
  );
  const [user, setUser] = useState<DemoUser | null>(() =>
    initialSession ? getUserById(initialSession.userId) : null,
  );
  const [jobsiteId, setJobsiteId] = useState<string | null>(initialSession?.jobsiteId ?? null);
  const [supabaseSites, setSupabaseSites] = useState<Jobsite[]>([]);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authError, setAuthError] = useState("");

  const allowedSites = useMemo(
    () => isSupabaseConfigured
      ? supabaseSites
      : user
        ? getJobsitesForUser(user)
        : [],
    [supabaseSites, user],
  );
  const selectedSite = allowedSites.find((site) => site.id === jobsiteId) ?? null;

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let active = true;
    restoreSupabaseAccess()
      .then((access) => {
        if (!active || !access) return;
        setUser(access.user);
        setSupabaseSites(access.sites);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthError(
          error instanceof SupabaseAccessError
            ? error.userMessage
            : "ไม่สามารถตรวจสอบสถานะการเข้าสู่ระบบได้",
        );
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setUser(null);
      setSupabaseSites([]);
      setJobsiteId(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) return;
    if (!user) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: user.id, jobsiteId }));
  }, [jobsiteId, user]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [jobsiteId, user?.id]);

  const login = async (identifier: string, password: string) => {
    setAuthError("");
    if (isSupabaseConfigured) {
      const access = await signInWithSupabase(identifier, password);
      setUser(access.user);
      setSupabaseSites(access.sites);
      setJobsiteId(null);
      return;
    }

    const demoUser = authenticateDemoUser(identifier, password);
    if (!demoUser) {
      throw new Error("ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง");
    }
    setUser(demoUser);
    setJobsiteId(null);
  };

  const logout = async () => {
    if (isSupabaseConfigured) {
      try {
        await signOutFromSupabase();
      } catch (error) {
        setAuthError(
          error instanceof SupabaseAccessError
            ? error.userMessage
            : "ออกจากระบบไม่สำเร็จ",
        );
      }
    }
    setUser(null);
    setSupabaseSites([]);
    setJobsiteId(null);
  };

  if (authLoading) {
    return (
      <main className="access-loading" aria-live="polite">
        <strong>ThaiCon CMMS</strong>
        <span>กำลังตรวจสอบการเข้าสู่ระบบ...</span>
      </main>
    );
  }

  if (!user) {
    return (
      <LoginPage
        initialError={authError}
        onLogin={login}
        useSupabase={isSupabaseConfigured}
      />
    );
  }

  if (!selectedSite) {
    return (
      <JobsiteSelector
        user={user}
        sites={allowedSites}
        onSelect={(site) => setJobsiteId(site.id)}
        onLogout={() => void logout()}
      />
    );
  }

  return (
    <CMMSApp
      activeJobsite={selectedSite}
      allowedJobsites={allowedSites}
      currentUser={user}
      onChangeJobsite={() => setJobsiteId(null)}
      onLogout={() => void logout()}
    />
  );
}
