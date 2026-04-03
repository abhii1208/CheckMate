import { Suspense, lazy } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from './AuthContext';
import { setAuthToken } from './api';
import { WorkflowProvider } from './WorkflowContext';
import Loader from './components/Loader';
import Sidebar from './components/Sidebar';

const AuthPage = lazy(() => import('./pages/AuthPage'));
const ImportWorkflowPage = lazy(() => import('./pages/ImportWorkflowPage'));
const ScanWorkflowPage = lazy(() => import('./pages/ScanWorkflowPage'));
const UpdateWorkflowPage = lazy(() => import('./pages/UpdateWorkflowPage'));
const ExportWorkflowPage = lazy(() => import('./pages/ExportWorkflowPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

const workflowSteps = [
  { to: '/import', label: 'Import' },
  { to: '/scan', label: 'Scan' },
  { to: '/update', label: 'Update' },
  { to: '/export', label: 'Export' },
];

function WorkflowStrip() {
  const location = useLocation();

  return (
    <section className="workflow-strip panel">
      <div className="workflow-steps">
        {workflowSteps.map((step, index) => {
          const isActive = location.pathname === step.to;
          const isComplete = workflowSteps.findIndex((item) => item.to === location.pathname) > index;

          return (
            <div key={step.to} className={`workflow-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function App() {
  const { auth, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
            <h1>CheckMate Inventory Workflow</h1>
            <p>Login, import sheet, scan and filter exact rows, update values, then export the final file.</p>
          </div>
          <img src="/checkmate-logo.svg" alt="CheckMate logo" className="topbar-logo" />
          <div className="topbar-actions">
            <div className="profile-menu" ref={menuRef}>
              <button
                type="button"
                className="profile-menu-trigger"
                onClick={() => setMenuOpen((current) => !current)}
                aria-label="Open account menu"
              >
                <div className="topbar-user-avatar">
                  {auth.user?.profile_image_url ? (
                    <img src={auth.user.profile_image_url} alt={auth.user.name || 'Profile'} />
                  ) : (
                    <span>{String(auth.user?.name || 'C').trim().charAt(0).toUpperCase()}</span>
                  )}
                </div>
              </button>

              {menuOpen ? (
                <div className="profile-menu-dropdown">
                  <div className="profile-menu-summary">
                    <strong>{auth.user?.name || 'CheckMate User'}</strong>
                    <p>{auth.user?.email || ''}</p>
                  </div>
                  <Link to="/profile" className="profile-menu-item" onClick={() => setMenuOpen(false)}>
                    Profile
                  </Link>
                  <button
                    type="button"
                    className="profile-menu-item profile-menu-item-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setAuthToken(null);
                      logout();
                    }}
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="page-content">
          <WorkflowProvider>
            <Suspense fallback={<Loader label="Loading page..." />}>
              <WorkflowStrip />
              <Routes>
                <Route path="/import" element={<ImportWorkflowPage />} />
                <Route path="/scan" element={<ScanWorkflowPage />} />
                <Route path="/update" element={<UpdateWorkflowPage />} />
                <Route path="/export" element={<ExportWorkflowPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/scanner" element={<Navigate to="/import" replace />} />
                <Route path="/dashboard" element={<Navigate to="/import" replace />} />
                <Route path="/upload" element={<Navigate to="/import" replace />} />
                <Route path="*" element={<Navigate to="/import" replace />} />
              </Routes>
            </Suspense>
          </WorkflowProvider>
        </main>
      </div>

      <Toaster position="top-right" />
    </div>
  );
}

export default App;
