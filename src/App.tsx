import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import CMMSApp from "./CMMSApp";
import { parseAssetLink } from "./asset-link";
import WebServerStatus from "./WebServerStatus";
import DatabaseStatus from "./DatabaseStatus";
import {
  authenticateDemoUser,
  demoUsers,
  roleLabels,
} from "./access";
import type { DemoUser, Jobsite } from "./access";
import {
  authenticateManagedUser,
  initialsFromName,
  jobsitesForManagedUser,
  loadMasterData,
  saveMasterData,
} from "./master-data";
import { loadSupabaseAdminMasterData, loadSupabaseAssets, loadSupabaseLocations } from "./admin-supabase";
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  restoreSupabaseAccess,
  signInWithSupabase,
  signOutFromSupabase,
  SupabaseAccessError,
} from "./supabase-auth";
import type { SupabaseAccess } from "./supabase-auth";
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
  demoAccounts,
  initialError,
  onLogin,
  useSupabase,
}: {
  demoAccounts: DemoUser[];
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
          <h1>ระบบติดตามงานซ่อมบำรุง</h1>
          <p>ติดตามใบงาน แผน PM เครื่องจักร และ Alarm ของแต่ละไซต์</p>
        </div>
        <div className="access-service-statuses"><WebServerStatus /><DatabaseStatus /></div>
      </section>

      <section className="access-panel">
        <div className="access-form-wrap">
          <span className="access-eyebrow">THAICON CMMS</span>
          <h2>เข้าสู่ระบบ</h2>
          <p>ใช้บัญชีที่ผู้ดูแลกำหนด หรือเลือกบัญชี Demo</p>

          <form onSubmit={submit}>
            <label>
              ชื่อผู้ใช้งาน
              <input
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="เช่น admin"
                required
                type="text"
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

          <div className="access-demo-accounts">
            <div><span>บัญชีทดสอบ • ข้อมูลจำลอง</span><small>รหัสผ่านทุกบัญชี: demo123</small></div>
            <div className="access-demo-grid">
              {demoAccounts.map((user) => (
                <button type="button" key={user.id} onClick={() => useDemoAccount(user)}>
                  <span>{user.initials}</span>
                  <p><strong>{roleLabels[user.role]}</strong><small>{user.username}</small></p>
                </button>
              ))}
            </div>
          </div>
        </div>
        <small className="access-footer">
          {useSupabase ? "บัญชีออนไลน์ / บัญชี Demo" : "ระบบทดสอบ • ข้อมูลจำลอง"}
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
                <div><dt>เครื่องจักร</dt><dd>{site.assetCount ?? "—"}</dd></div>
                <div><dt>ใบงานเปิด</dt><dd>{site.openWorkOrders ?? "—"}</dd></div>
                <div><dt>PM (ค่าที่กำหนด)</dt><dd>{site.pmCompliance == null ? "—" : `${site.pmCompliance}%`}</dd></div>
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
  const [masterData, setMasterData] = useState(() => loadMasterData());
  const initialSession = useMemo(() => readStoredSession(), []);
  const initialDemoUser = initialSession
    ? masterData.users.find((item) => item.id === initialSession.userId && item.active) ?? null
    : null;
  const [user, setUser] = useState<DemoUser | null>(() =>
    initialDemoUser,
  );
  const [sessionMode, setSessionMode] = useState<"supabase" | "demo">(
    initialDemoUser ? "demo" : isSupabaseConfigured ? "supabase" : "demo",
  );
  const [jobsiteId, setJobsiteId] = useState<string | null>(initialSession?.jobsiteId ?? null);
  const [supabaseSites, setSupabaseSites] = useState<Jobsite[]>([]);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authError, setAuthError] = useState("");
  const [masterLoad, setMasterLoad] = useState<"loading" | "ready" | "error">("ready");
  const masterAttempt = useRef(0);
  const onlineMode = isSupabaseConfigured && sessionMode === "supabase";

  const allowedSites = useMemo(
    () => onlineMode
      ? user?.role === "admin"
        ? masterData.jobsites.filter((site) => site.active)
        : supabaseSites
      : user
        ? jobsitesForManagedUser(masterData, user)
        : [],
    [masterData, onlineMode, supabaseSites, user],
  );
  const [assetTarget, setAssetTarget] = useState(() => parseAssetLink(window.location.hash));
  const dismissAssetTarget = () => {
    setAssetTarget(null);
    if (window.location.hash.startsWith("#asset?")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const selectedSite = allowedSites.find((site) => site.id === (assetTarget?.siteId ?? jobsiteId)) ?? null;

  const hydrateSupabaseMasterData = async (access: SupabaseAccess) => {
    const attempt = ++masterAttempt.current;
    setMasterLoad("loading");
    setAuthError("");
    setSessionMode("supabase");
    setUser(access.user);
    setSupabaseSites(access.sites);
    try {
      if (access.user.role === "admin") {
        const remoteMasterData = await loadSupabaseAdminMasterData();
        if (attempt !== masterAttempt.current) return;
        setMasterData(remoteMasterData);
        setSupabaseSites(remoteMasterData.jobsites.filter((site) => site.active));
        setMasterLoad("ready");
        return;
      }
      const [assets, locations] = await Promise.all([loadSupabaseAssets(access.sites.map((site) => site.id)), loadSupabaseLocations(access.sites.map((site) => site.id))]);
      if (attempt !== masterAttempt.current) return;
      const confirmedSites = access.sites.map((site) => ({ ...site, assetCount: assets.filter((asset) => asset.active && asset.jobsiteId === site.id).length, active: true }));
      setMasterData({
        jobsites: confirmedSites,
        users: [{ ...access.user, initials: initialsFromName(access.user.displayName), active: true }],
        assets,
        locations,
      });
      setSupabaseSites(confirmedSites);
      setMasterLoad("ready");
    } catch (error) {
      if (attempt !== masterAttempt.current) return;
      console.error("Unable to load Supabase master data", error);
      setAuthError("โหลดข้อมูลไซต์หรือเครื่องจักรไม่ครบ กรุณาลองใหม่ หากยังไม่สำเร็จให้ติดต่อผู้ดูแลระบบ");
      setMasterLoad("error");
    }
  };

  const retryMasterData = async () => {
    const attempt = ++masterAttempt.current;
    setMasterLoad("loading");
    try {
      // Refresh actual permissions before retrying; never reuse cached assignments.
      const access = await restoreSupabaseAccess();
      if (attempt !== masterAttempt.current) return;
      if (!access) {
        setUser(null);
        setSupabaseSites([]);
        setJobsiteId(null);
        return;
      }
      await hydrateSupabaseMasterData(access);
    } catch (error) {
      if (attempt !== masterAttempt.current) return;
      setAuthError(error instanceof SupabaseAccessError ? error.userMessage : "โหลดข้อมูลไซต์และเครื่องจักรไม่สำเร็จ ลองใหม่อีกครั้ง");
      setMasterLoad("error");
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let active = true;
    restoreSupabaseAccess()
      .then(async (access) => {
        if (!active || !access) return;
        await hydrateSupabaseMasterData(access);
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
      masterAttempt.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      masterAttempt.current += 1;
      setUser(null);
      setSupabaseSites([]);
      setJobsiteId(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (onlineMode) return;
    if (!user) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId: user.id, jobsiteId }));
  }, [jobsiteId, onlineMode, user]);

  useEffect(() => {
    if (onlineMode) {
      if (masterLoad !== "ready" || !user || user.role !== "admin") return;
      const updatedUser = masterData.users.find((item) => item.id === user.id && item.active);
      if (updatedUser && updatedUser !== user) setUser(updatedUser);
      return;
    }
    saveMasterData(masterData);
    if (!user) return;
    const updatedUser = masterData.users.find((item) => item.id === user.id && item.active) ?? null;
    if (!updatedUser) {
      setUser(null);
      setJobsiteId(null);
    } else if (updatedUser !== user) {
      setUser(updatedUser);
    }
  }, [masterData, masterLoad, onlineMode, user]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [jobsiteId, user?.id]);

  const login = async (identifier: string, password: string) => {
    setAuthError("");
    const demoUser = authenticateDemoUser(identifier, password);
    if (demoUser) {
      masterAttempt.current += 1;
      setMasterLoad("ready");
      const demoMasterData = loadMasterData();
      setSessionMode("demo");
      setMasterData(demoMasterData);
      setSupabaseSites([]);
      setUser(demoUser);
      setJobsiteId(null);
      return;
    }

    if (isSupabaseConfigured) {
      window.localStorage.removeItem(STORAGE_KEY);
      const access = await signInWithSupabase(identifier, password);
      await hydrateSupabaseMasterData(access);
      setJobsiteId(null);
      return;
    }

    const managedUser = authenticateManagedUser(masterData.users, identifier, password);
    if (!managedUser) {
      throw new Error("ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง");
    }
    setUser(managedUser);
    setJobsiteId(null);
  };

  const logout = async () => {
    masterAttempt.current += 1;
    if (onlineMode) {
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
    window.localStorage.removeItem(STORAGE_KEY);
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
        demoAccounts={demoUsers}
        initialError={authError}
        onLogin={login}
        useSupabase={isSupabaseConfigured}
      />
    );
  }

  if (onlineMode && masterLoad !== "ready") {
    return (
      <main className="access-loading" aria-live="polite" aria-busy={masterLoad === "loading"}>
        <strong>ThaiCon CMMS</strong>
        {masterLoad === "loading" ? <span>กำลังโหลดทะเบียนข้อมูลออนไลน์...</span> : (
          <>
            <p role="alert">{authError}</p>
            <p>ยังไม่แสดงจำนวนหรือรายการจนกว่าจะโหลดข้อมูลครบ ข้อมูลที่โหลดสำเร็จก่อนหน้านี้ไม่ได้ถูกลบ</p>
            <button className="access-submit" type="button" onClick={() => void retryMasterData()}>ลองโหลดอีกครั้ง</button>
          </>
        )}
        <button className="access-submit" type="button" onClick={() => void logout()}>ออกจากระบบ</button>
      </main>
    );
  }

  if (assetTarget && (!selectedSite || user.role === "engineer")) {
    return <main className="access-loading">
      <strong>เปิดเครื่องจักรไม่ได้</strong>
      <p>ไม่พบไซต์หรือบัญชีนี้ไม่มีสิทธิ์ดูเครื่องจักร กรุณาติดต่อผู้ดูแล</p>
      <button type="button" className="access-submit" onClick={dismissAssetTarget}>กลับสู่ระบบ</button>
      <button type="button" className="access-submit" onClick={() => void logout()}>เปลี่ยนบัญชี</button>
    </main>;
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
      key={`${sessionMode}:${user.id}`}
      activeJobsite={selectedSite}
      allowedJobsites={allowedSites}
      currentUser={user}
      masterData={masterData}
      initialAssetId={assetTarget?.assetId}
      onMasterDataChange={setMasterData}
      onChangeJobsite={() => { dismissAssetTarget(); setJobsiteId(null); }}
      onLogout={() => void logout()}
      onlineMode={onlineMode}
    />
  );
}
