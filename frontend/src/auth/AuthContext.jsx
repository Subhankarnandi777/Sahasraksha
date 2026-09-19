import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { authConfigurationMessage } from "../services/auth.js";
import { isSupabaseConfigured, supabase } from "../services/supabaseClient.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem("sahasraksha_session");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setSession(parsed);
          setUser(parsed.user || null);
        } catch {
          // ignore corrupted session
        }
      }
      setLoading(false);
      return undefined;
    }

    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (!error) {
        setSession(data.session);
        setUser(data.session?.user || null);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user || null);
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    user,
    session,
    loading,
    isConfigured: isSupabaseConfigured,
    async login(email, password) {
      if (!supabase) {
        const localSession = {
          access_token: "local-session-token",
          user: { email, id: `local-${email}` }
        };
        localStorage.setItem("sahasraksha_session", JSON.stringify(localSession));
        setSession(localSession);
        setUser(localSession.user);
        return { session: localSession, user: localSession.user };
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signup(email, password, metadata = {}) {
      if (!supabase) {
        const localSession = {
          access_token: "local-session-token",
          user: { email, id: `local-${email}`, user_metadata: metadata }
        };
        localStorage.setItem("sahasraksha_session", JSON.stringify(localSession));
        setSession(localSession);
        setUser(localSession.user);
        return { session: localSession, user: localSession.user };
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: metadata,
          emailRedirectTo: `${window.location.origin}/dashboard`
        }
      });
      if (error) throw error;
      return data;
    },
    async logout() {
      if (!supabase) {
        localStorage.removeItem("sahasraksha_session");
        setSession(null);
        setUser(null);
        return;
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
  }), [loading, session, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
