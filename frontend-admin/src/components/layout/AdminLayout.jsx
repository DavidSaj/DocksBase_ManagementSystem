import { useAuth } from '../../context/AuthContext.jsx';
import Sidebar from './Sidebar.jsx';

export default function AdminLayout({ children }) {
  const { signOut } = useAuth();
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar onSignOut={signOut} />
      <main style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
