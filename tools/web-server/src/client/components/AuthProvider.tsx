import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  silentRefresh,
  logoutRequest,
  getAuthHeaders,
} from '../hooks/useAuth.js';

interface AuthUser {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  role?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Decode the payload of a JWT without verifying it (client-side only).
 * Returns null if the token is malformed.
 */
function decodeJwtPayload(token: string): AuthUser | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const payload = JSON.parse(json) as {
      sub?: string;
      email?: string;
      username?: string;
      displayName?: string;
      avatarUrl?: string;
      role?: string;
    };
    if (!payload.sub || !payload.email) return null;
    return {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      displayName: payload.displayName,
      avatarUrl: payload.avatarUrl,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const token = getAccessToken();
    return token ? decodeJwtPayload(token) : null;
  });

  const [accessToken, setAccessToken] = useState<string | null>(getAccessToken);

  // On mount, check if tokens exist and try silent refresh if access token is missing
  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      setUser(decodeJwtPayload(token));
      setAccessToken(token);
    } else if (getRefreshToken()) {
      // Access token expired but refresh token exists — attempt silent refresh
      silentRefresh().then((result) => {
        if (result) {
          setAccessToken(result.accessToken);
          setUser(decodeJwtPayload(result.accessToken));
        } else {
          setUser(null);
          setAccessToken(null);
        }
      });
    }
  }, []);

  // Listen for auth callback data stored in URL hash (after GitHub redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackData = params.get('auth_callback');
    if (callbackData) {
      try {
        const data = JSON.parse(atob(callbackData)) as {
          accessToken: string;
          refreshToken: string;
          user: AuthUser;
        };
        setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        setAccessToken(data.accessToken);
        setUser(data.user);
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        // Ignore malformed callback data
      }
    }
  }, []);

  const login = useCallback(() => {
    window.location.href = '/auth/github';
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setAccessToken(null);
    clearTokens();
  }, []);

  const value: AuthContextValue = {
    user,
    accessToken,
    isAuthenticated: user !== null && accessToken !== null,
    login,
    logout,
    getAuthHeaders,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the auth context. Must be used within an <AuthProvider>.
 */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuthContext must be used within an <AuthProvider>');
  }
  return ctx;
}
