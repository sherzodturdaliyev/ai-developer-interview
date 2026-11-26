import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from "../lib/api";
import type { Company, SessionResponse, User } from "../lib/types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthValue {
  status: Status;
  user: User | null;
  company: Company | null;
  login(email: string, password: string): Promise<void>;
  register(input: { companyName: string; name: string; email: string; password: string }): Promise<void>;
  acceptInvitation(input: { token: string; name: string; password: string }): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

interface State {
  status: Status;
  user: User | null;
  company: Company | null;
}

const ANONYMOUS: State = { status: "anonymous", user: null, company: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading", user: null, company: null });

  const applySession = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: "authenticated", user: session.user, company: session.company });
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setState(ANONYMOUS);
  }, []);

  // Restore the session from the refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      if (session) applySession(session);
      else clearSession();
    });
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  const value = useMemo<AuthValue>(
    () => ({
      ...state,
      async login(email, password) {
        applySession(
          await api<SessionResponse>("/api/auth/login", { method: "POST", body: { email, password }, auth: false }),
        );
      },
      async register(input) {
        applySession(await api<SessionResponse>("/api/auth/register", { method: "POST", body: input, auth: false }));
      },
      async acceptInvitation(input) {
        applySession(
          await api<SessionResponse>("/api/invitations/accept", { method: "POST", body: input, auth: false }),
        );
      },
      async logout() {
        try {
          await api<void>("/api/auth/logout", { method: "POST", auth: false });
        } finally {
          clearSession();
        }
      },
    }),
    [state, applySession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
