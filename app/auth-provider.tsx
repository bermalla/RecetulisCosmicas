"use client";

import {
  type User as FirebaseUser,
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getApps, initializeApp } from "firebase/app";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type SessionActor = {
  id: string;
  email: string;
  displayName: string;
  groupId: string;
  groupName: string;
  role: "owner" | "editor" | "reader";
};

type AuthStatus = "loading" | "signed-out" | "authorizing" | "ready" | "offline" | "error";

type AuthContextValue = {
  status: AuthStatus;
  firebaseUser: FirebaseUser | null;
  actor: SessionActor | null;
  error: string;
  configured: boolean;
  mode: "online" | "offline";
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  useOfflineMode: () => void;
  useOnlineMode: () => void;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const MODE_KEY = "recetulis-cosmicas-mode";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(true);
  const [mode, setMode] = useState<"online" | "offline">("online");

  const validateSession = useCallback(async (user: FirebaseUser) => {
    setStatus("authorizing");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/auth/session", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json()) as { user?: SessionActor; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "No se pudo validar el acceso.");
      setActor(data.user);
      setError("");
      setStatus("ready");
    } catch (sessionError) {
      setActor(null);
      setError(sessionError instanceof Error ? sessionError.message : "No se pudo validar el acceso.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    let active = true;
    const savedMode = window.localStorage.getItem(MODE_KEY);
    if (savedMode === "offline") {
      queueMicrotask(() => {
        if (!active) return;
        setMode("offline");
        setStatus("offline");
      });
    }

    void (async () => {
      try {
        const response = await fetch("/api/auth/config", { cache: "no-store" });
        const data = (await response.json()) as {
          configured?: boolean;
          config?: { apiKey: string; authDomain: string; projectId: string; appId: string };
          error?: string;
        };
        if (!response.ok || !data.config) {
          if (!active) return;
          setConfigured(false);
          if (savedMode !== "offline") {
            setError(data.error || "El acceso con Google todavía no está configurado.");
            setStatus("signed-out");
          }
          return;
        }
        const app = getApps()[0] ?? initializeApp(data.config);
        const auth = getAuth(app);
        await setPersistence(auth, browserLocalPersistence);
        await getRedirectResult(auth).catch(() => null);
        unsubscribe = onAuthStateChanged(auth, (user) => {
          if (!active) return;
          setFirebaseUser(user);
          if (savedMode === "offline") return;
          if (user) void validateSession(user);
          else {
            setActor(null);
            setStatus("signed-out");
          }
        });
      } catch (setupError) {
        if (!active) return;
        setConfigured(false);
        setError(setupError instanceof Error ? setupError.message : "No se pudo iniciar el acceso con Google.");
        if (savedMode !== "offline") setStatus("signed-out");
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [validateSession]);

  const signIn = useCallback(async () => {
    if (!configured || getApps().length === 0) return;
    setError("");
    const auth = getAuth(getApps()[0]);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      const result = await signInWithPopup(auth, provider);
      setFirebaseUser(result.user);
      await validateSession(result.user);
    } catch (signInError) {
      const code = (signInError as { code?: string }).code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
        await signInWithRedirect(auth, provider);
        return;
      }
      setError(signInError instanceof Error ? signInError.message : "No se pudo iniciar sesión.");
      setStatus("signed-out");
    }
  }, [configured, validateSession]);

  const signOut = useCallback(async () => {
    if (getApps().length > 0) await firebaseSignOut(getAuth(getApps()[0]));
    setFirebaseUser(null);
    setActor(null);
    setError("");
    setStatus("signed-out");
  }, []);

  const useOfflineMode = useCallback(() => {
    window.localStorage.setItem(MODE_KEY, "offline");
    setMode("offline");
    setStatus("offline");
    setError("");
  }, []);

  const useOnlineMode = useCallback(() => {
    window.localStorage.setItem(MODE_KEY, "online");
    setMode("online");
    if (firebaseUser) void validateSession(firebaseUser);
    else setStatus("signed-out");
  }, [firebaseUser, validateSession]);

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!firebaseUser) throw new Error("Iniciá sesión para continuar.");
      const token = await firebaseUser.getIdToken();
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    [firebaseUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      firebaseUser,
      actor,
      error,
      configured,
      mode,
      signIn,
      signOut,
      useOfflineMode,
      useOnlineMode,
      authorizedFetch,
    }),
    [status, firebaseUser, actor, error, configured, mode, signIn, signOut, useOfflineMode, useOnlineMode, authorizedFetch],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de AuthProvider.");
  return value;
}

export function AccessGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading" || auth.status === "authorizing") {
    return (
      <main className="access-shell">
        <section className="access-card"><p className="eyebrow">Recetulis Cósmicas</p><h1>Preparando tu colección…</h1></section>
      </main>
    );
  }
  if (auth.status === "ready" || auth.status === "offline") return <>{children}</>;
  return (
    <main className="access-shell">
      <section className="access-card">
        <p className="eyebrow">Colección privada</p>
        <h1>Entrá a Recetulis Cósmicas</h1>
        <p>Las recetas online sólo están disponibles para las cuentas invitadas al grupo.</p>
        {auth.error && <p className="form-error" role="alert">{auth.error}</p>}
        <div className="access-actions">
          <button className="primary-button" type="button" onClick={() => void auth.signIn()} disabled={!auth.configured}>
            Continuar con Google
          </button>
          <button className="secondary-button" type="button" onClick={auth.useOfflineMode}>
            Usar colección local
          </button>
        </div>
        {!auth.configured && <p className="helper-text">Mientras se completa Firebase podés usar el modo local sin conexión.</p>}
      </section>
    </main>
  );
}
