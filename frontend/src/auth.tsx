import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api, setOnUnauthorized, TOKEN_KEY } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type Role = "owner" | "manager" | "supervisor" | "finance" | "marketing" | "crew";
export type User = { id: string; email: string; name: string; role: Role; position: string; access?: string[] };

// Permissions the Owner can reassign from the Access Control screen — for these we trust the
// server-provided `access` list (so an Owner can REVOKE a default). Everything else uses the static map.
const OVERRIDABLE = new Set<string>([
  "finance", "payroll", "audit", "petty_cash_approve", "sales_void", "reports", "settings",
  "menu_edit", "inventory_move", "opname", "waste", "waste_approve", "purchase",
  "purchase_approve", "purchase_receive", "attendance_all", "overtime_approve",
]);

const ALL: Role[] = ["owner", "manager", "supervisor", "finance", "marketing", "crew"];
const OPS: Role[] = ["owner", "manager", "supervisor", "crew"];
const MGMT: Role[] = ["owner", "manager", "supervisor"];

// Mirrors backend PERM — backend remains the authority
export const PERM: Record<string, Role[]> = {
  pos: OPS,
  menu_view: MGMT,
  menu_edit: ["owner", "manager"],
  inventory_view: OPS,
  inventory_move: MGMT,
  opname: OPS,
  waste: OPS,
  waste_approve: MGMT,
  purchase: OPS,
  purchase_approve: ["owner", "manager"],
  purchase_receive: MGMT,
  finance: ["owner", "finance"],
  payroll: ["owner", "finance"],
  attendance: ALL,
  attendance_all: ["owner", "manager", "supervisor", "finance"],
  marketing: ["owner", "marketing", "manager"],
  reports: ["owner", "manager", "supervisor", "finance", "marketing"],
  users: ["owner"],
  settings: ["owner", "finance"],
  sales_view: ALL,
  sales_void: MGMT,
  customers: ["owner", "manager", "supervisor", "marketing", "crew"],
  attendance_live: ["owner", "manager", "supervisor", "finance", "crew"],
  overtime_approve: MGMT,
  audit: ["owner", "finance"],
  petty_cash: OPS,
  petty_cash_approve: ["owner", "manager", "supervisor", "finance"],
  adjust: ["owner", "manager", "supervisor", "finance"],
  external_sales: ["owner", "manager", "supervisor", "crew", "finance"],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  finance: "Finance",
  marketing: "Marketing",
  crew: "Crew",
};

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
  loginWithGoogle: () => Promise<void>;
  googleError: string;
};

WebBrowser.maybeCompleteAuthSession();
const sentIds = new Set<string>();
const extractSessionId = (url: string) => {
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};
const AuthCtx = createContext<Ctx>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleError, setGoogleError] = useState("");

  const logout = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      storage.secureRemove(TOKEN_KEY);
      setUser(null);
    });
    (async () => {
      // Web: Google redirect lands back with session_id — process it first
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const sid = extractSessionId(window.location.href);
        if (sid) {
          try {
            await exchange(sid);
            window.history.replaceState(window.history.state, "", window.location.pathname);
          } catch (e: any) {
            setGoogleError(e.message);
          }
        }
      }
      const t = await storage.secureGet<string | null>(TOKEN_KEY, null);
      if (t) {
        try {
          setUser(await api<User>("/auth/me"));
        } catch {}
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api<{ access_token: string; user: User }>("/auth/login", { body: { email, password } });
    await storage.secureSet(TOKEN_KEY, r.access_token);
    setUser(r.user);
  };
  async function exchange(sid: string) {
    if (sentIds.has(sid)) return;
    sentIds.add(sid);
    const r = await api<{ session_token: string; user: User }>("/auth/session", { body: { session_id: sid } });
    await storage.secureSet(TOKEN_KEY, r.session_token);
    setUser(r.user);
  }

  const loginWithGoogle = async () => {
    setGoogleError("");
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL("");
    let captured: string | null = null;
    const sub = Linking.addEventListener("url", ({ url }) => {
      captured = url;
    });
    try {
      const res = await WebBrowser.openAuthSessionAsync(`https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`, redirect);
      const url = (res.type === "success" && res.url) || captured || (await Linking.getInitialURL());
      const sid = url ? extractSessionId(url) : null;
      if (sid) await exchange(sid);
    } catch (e: any) {
      setGoogleError(e.message);
    } finally {
      sub.remove();
    }
  };

  const can = (p: string) => {
    if (!user) return false;
    const dyn = user.access;
    if (OVERRIDABLE.has(p)) return dyn ? dyn.includes(p) : (PERM[p] || []).includes(user.role);
    if (dyn && dyn.includes(p)) return true;
    return (PERM[p] || []).includes(user.role);
  };

  return <AuthCtx.Provider value={{ user, loading, login, logout, can, loginWithGoogle, googleError }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
