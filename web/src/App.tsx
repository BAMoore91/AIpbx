import { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuthStore } from './store/authStore';
import { useCallStore } from './store/callStore';
import { wsClient } from './lib/ws';
import { tokenStorage } from './lib/auth';
import { authApi } from './lib/api';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { SoftphoneWidget } from './softphone/SoftphoneWidget';
import { IncomingCallPopup } from './softphone/IncomingCallPopup';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { WSEvent, LiveCall, QueueStats } from './lib/types';

// ─── Lazy page imports ────────────────────────────────────────────────────────
const Login          = lazy(() => import('./pages/Login'));
const Dashboard      = lazy(() => import('./pages/Dashboard'));
const LiveWallboard  = lazy(() => import('./pages/LiveWallboard'));
const Users          = lazy(() => import('./pages/Users'));
const Extensions     = lazy(() => import('./pages/Extensions'));
const Trunks         = lazy(() => import('./pages/Trunks'));
const Routing        = lazy(() => import('./pages/Routing'));
const Queues         = lazy(() => import('./pages/Queues'));
const IVR            = lazy(() => import('./pages/IVR'));
const TimeConditions = lazy(() => import('./pages/TimeConditions'));
const AIAgents       = lazy(() => import('./pages/AIAgents'));
const KnowledgeBases = lazy(() => import('./pages/KnowledgeBases'));
const CDR            = lazy(() => import('./pages/CDR'));
const Recordings     = lazy(() => import('./pages/Recordings'));
const Voicemail      = lazy(() => import('./pages/Voicemail'));
const Messages       = lazy(() => import('./pages/Messages'));
const Reports        = lazy(() => import('./pages/Reports'));
const Settings       = lazy(() => import('./pages/Settings'));
const Tenants        = lazy(() => import('./pages/Tenants'));
const Departments    = lazy(() => import('./pages/Departments'));
const Roles          = lazy(() => import('./pages/Roles'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    // Verify token on mount
    const token = tokenStorage.getAccess();
    if (!token) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('aipbx-dark-mode');
    return stored ? stored === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const { addOrUpdateCall, removeCall, updateQueueStats } = useCallStore();

  // Apply dark mode class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('aipbx-dark-mode', String(darkMode));
  }, [darkMode]);

  // Connect WebSocket and wire up live events
  useEffect(() => {
    wsClient.connect();

    const unsubs = [
      wsClient.on('call.started', (e: WSEvent) => {
        addOrUpdateCall(e.payload as LiveCall);
      }),
      wsClient.on('call.updated', (e: WSEvent) => {
        addOrUpdateCall(e.payload as LiveCall);
      }),
      wsClient.on('call.ended', (e: WSEvent) => {
        removeCall((e.payload as { id: string }).id);
      }),
      wsClient.on('queue.stats', (e: WSEvent) => {
        updateQueueStats(e.payload as QueueStats);
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
      wsClient.disconnect();
    };
  }, [addOrUpdateCall, removeCall, updateQueueStats]);

  return (
    <div className={clsx('flex h-full', darkMode && 'dark')}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          onSidebarToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          darkMode={darkMode}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />
        <main className="flex-1 overflow-y-auto bg-surface-50 dark:bg-surface-950 p-6">
          <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wallboard" element={<LiveWallboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/extensions" element={<Extensions />} />
              <Route path="/trunks" element={<Trunks />} />
              <Route path="/routing" element={<Routing />} />
              <Route path="/queues" element={<Queues />} />
              <Route path="/ivr" element={<IVR />} />
              <Route path="/time-conditions" element={<TimeConditions />} />
              <Route path="/ai-agents" element={<AIAgents />} />
              <Route path="/knowledge-bases" element={<KnowledgeBases />} />
              <Route path="/cdr" element={<CDR />} />
              <Route path="/cdr/:id" element={<CDR />} />
              <Route path="/recordings" element={<Recordings />} />
              <Route path="/voicemail" element={<Voicemail />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/tenants" element={<Tenants />} />
              <Route path="/departments" element={<Departments />} />
              <Route path="/roles" element={<Roles />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Softphone overlay */}
      <SoftphoneWidget />
      <IncomingCallPopup />
    </div>
  );
}

// Verify auth state on app load
function AuthSync({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, setUser, logout } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setReady(true);
      return;
    }
    authApi
      .me()
      .then((user) => {
        setUser(user);
        setReady(true);
      })
      .catch(() => {
        logout();
        setReady(true);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-surface-950">
        <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <AuthSync>
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageLoader />}>
              <Login />
            </Suspense>
          }
        />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }
        />
      </Routes>
    </AuthSync>
  );
}
