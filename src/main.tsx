import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  const queryRedirect = params.get('spa_redirect');
  let storedRedirect = '';
  try {
    storedRedirect = sessionStorage.getItem('tapnex_spa_redirect') || '';
    if (storedRedirect) sessionStorage.removeItem('tapnex_spa_redirect');
  } catch {
    // ignore storage access issues
  }
  const nextPath = queryRedirect || storedRedirect;
  if (nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//')) {
    window.history.replaceState(null, '', nextPath);
  }
}

createRoot(document.getElementById('root')!).render(<App />);
