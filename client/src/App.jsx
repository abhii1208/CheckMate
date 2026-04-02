import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './AuthContext';
import Loader from './components/Loader';
import Sidebar from './components/Sidebar';
const AuthPage = lazy(() => import('./pages/AuthPage'));
const ScannerPage = lazy(() => import('./pages/ScannerPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));


function App() {
  const { auth, login, logout } = useAuth();

  // Show AuthPage if not authenticated
  if (!auth) {
    return (
      <div className="auth-bg">
        <Suspense fallback={<Loader label="Loading login..." />}>
          <AuthPage onAuthenticated={login} />
          <Toaster position="top-right" />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="main-shell">
        <header className="topbar">
          <div>
            <h1>CheckMate Inventory Manager</h1>
            <p>Import stock, scan products, adjust quantities, and download the final Excel in one smooth workflow.</p>
          </div>
          <img src="/checkmate-logo.svg" alt="CheckMate logo" className="topbar-logo" />
          <button className="logout-btn" onClick={logout} style={{ marginLeft: 'auto' }}>
            Log out
          </button>
        </header>

        <main className="page-content">
          <Suspense fallback={<Loader label="Loading page..." />}>
            <Routes>
              <Route path="/scanner" element={<ScannerPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/dashboard" element={<Navigate to="/scanner" replace />} />
              <Route path="/upload" element={<Navigate to="/scanner" replace />} />
              <Route path="*" element={<Navigate to="/scanner" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <Toaster position="top-right" />
    </div>
  );
}

export default App;
