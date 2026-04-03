import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    try {
      const stored = localStorage.getItem('checkmate_auth');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (auth) {
      localStorage.setItem('checkmate_auth', JSON.stringify(auth));
    } else {
      localStorage.removeItem('checkmate_auth');
    }
  }, [auth]);

  const login = (data) => setAuth(data);
  const logout = () => setAuth(null);
  const updateAuthUser = (data) => setAuth(data);

  return (
    <AuthContext.Provider value={{ auth, login, logout, updateAuthUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
