import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { useAuth } from './AuthContext';
import { WorkflowProvider } from './WorkflowContext';
import Loader from './components/Loader';
import Sidebar from './components/Sidebar';

const AuthPage = lazy(() => import('./pages/AuthPage'));
const ImportWorkflowPage = lazy(() => import('./pages/ImportWorkflowPage'));
const ScanWorkflowPage = lazy(() => import('./pages/ScanWorkflowPage'));
const UpdateWorkflowPage = lazy(() => import('./pages/UpdateWorkflowPage'));
const ExportWorkflowPage = lazy(() => import('./pages/ExportWorkflowPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

function App() {
  const { auth, login, logout } = useAuth();

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
          <button className="logout-btn" onClick={logout} style={{ marginLeft: 'auto' }}>
            Log out
          </button>
        </header>

        <main className="page-content">
          <WorkflowProvider>
            <Suspense fallback={<Loader label="Loading page..." />}>
              <Routes>
                <Route path="/import" element={<ImportWorkflowPage />} />
                <Route path="/scan" element={<ScanWorkflowPage />} />
                <Route path="/update" element={<UpdateWorkflowPage />} />
                <Route path="/export" element={<ExportWorkflowPage />} />
                <Route path="/reports" element={<ReportsPage />} />
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
