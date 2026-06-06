import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from './api/client.js';
import CalendarView from './components/CalendarView.jsx';

export default function App() {
  const { isLoading, isAuthenticated, loginWithRedirect, getAccessTokenSilently, user } =
    useAuth0();

  const [toast, setToast] = useState(null);

  // Wire Auth0 token getter into axios client
  useEffect(() => {
    setTokenGetter(getAccessTokenSilently);
  }, [getAccessTokenSilently]);

  // Listen for global toast / auth events dispatched by axios interceptors
  useEffect(() => {
    const onAuthRequired = () => loginWithRedirect();
    const onToast = (e) => {
      setToast(e.detail);
      setTimeout(() => setToast(null), 4000);
    };
    window.addEventListener('rrc:auth-required', onAuthRequired);
    window.addEventListener('rrc:toast', onToast);
    return () => {
      window.removeEventListener('rrc:auth-required', onAuthRequired);
      window.removeEventListener('rrc:toast', onToast);
    };
  }, [loginWithRedirect]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Regulated Release Calendar</h1>
        <p className="text-gray-600">Sign in to manage your release schedule.</p>
        <button
          onClick={() => loginWithRedirect()}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium
                     rounded-lg transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-gray-900">RRC</span>
          <span className="text-gray-400">|</span>
          <span className="text-sm text-gray-600">Regulated Release Calendar</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span>{user?.email}</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <CalendarView jurisdiction="FCA" />
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium
            ${toast.type === 'error' ? 'bg-red-600 text-white'  : ''}
            ${toast.type === 'warn'  ? 'bg-amber-500 text-white': ''}
            ${toast.type === 'info'  ? 'bg-blue-600 text-white' : ''}`}
          role="alert"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
