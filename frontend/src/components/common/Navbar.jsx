import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  const patientLinks = [
    { path:'/patient/dashboard', label:'Dashboard', icon:'🏠' },
    { path:'/patient/plan', label:'My Plan', icon:'📋' },
    { path:'/patient/history', label:'History', icon:'🕐' },
    { path:'/patient/progress', label:'Progress', icon:'📈' },
    { path:'/patient/messages', label:'Messages', icon:'💬' },
    { path:'/patient/notifications', label:'Alerts', icon:'🔔' },
  ];

  const therapistLinks = [
    { path:'/therapist/dashboard', label:'Dashboard', icon:'🏠' },
    { path:'/therapist/patients', label:'Patients', icon:'👥' },
    { path:'/therapist/exercises', label:'Exercises', icon:'📚' },
    { path:'/therapist/analytics', label:'Analytics', icon:'📊' },
    { path:'/therapist/messages', label:'Messages', icon:'💬' },
  ];

  const links = user?.role === 'patient'
    ? patientLinks
    : user?.role === 'therapist'
    ? therapistLinks : [];

  // Don't show navbar on auth pages
  const authPages = ['/', '/login', '/signup', '/forgot-password'];
  if (authPages.includes(location.pathname)) return null;

  return (
    <nav style={styles.nav}>
      {/* Brand */}
      <Link to="/" style={styles.brand}>
        🦾 <span style={styles.brandText}>Movera</span>
      </Link>

      {/* Nav Links */}
      <div style={styles.links}>
        {links.map(link => (
          <Link
            key={link.path}
            to={link.path}
            style={{
              ...styles.link,
              background: isActive(link.path)
                ? 'rgba(255,255,255,0.2)' : 'transparent',
              color: '#fff',
            }}>
            <span>{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
      </div>

      {/* Right Side */}
      {user && (
        <div style={styles.right}>
          <Link
            to={user.role === 'patient'
              ? '/patient/profile'
              : '/therapist/profile'}
            style={styles.userBtn}>
            <div style={styles.avatar}>
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <span style={styles.userName}>{user?.name}</span>
          </Link>
          <button onClick={logout} style={styles.logoutBtn}>
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}

const styles = {
  nav: {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'0 32px', height:'64px',
    background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    boxShadow:'0 2px 20px rgba(102,126,234,0.4)',
    position:'sticky', top:0, zIndex:1000,
    flexWrap:'wrap', gap:'8px'
  },
  brand: {
    display:'flex', alignItems:'center', gap:'8px',
    fontSize:'1.3rem', fontWeight:'700', color:'#fff',
    textDecoration:'none'
  },
  brandText: { color:'#fff' },
  links: {
    display:'flex', alignItems:'center', gap:'4px',
    flexWrap:'wrap'
  },
  link: {
    display:'flex', alignItems:'center', gap:'6px',
    padding:'8px 14px', borderRadius:'8px',
    fontSize:'0.9rem', fontWeight:'500',
    transition:'all 0.2s', textDecoration:'none'
  },
  right: {
    display:'flex', alignItems:'center', gap:'12px'
  },
  userBtn: {
    display:'flex', alignItems:'center', gap:'10px',
    background:'rgba(255,255,255,0.15)', padding:'6px 14px',
    borderRadius:'50px', textDecoration:'none',
    backdropFilter:'blur(10px)'
  },
  avatar: {
    width:'32px', height:'32px', borderRadius:'50%',
    background:'#fff', color:'#667eea', display:'flex',
    alignItems:'center', justifyContent:'center',
    fontWeight:'700', fontSize:'0.9rem'
  },
  userName: {
    color:'#fff', fontSize:'0.9rem', fontWeight:'500'
  },
  logoutBtn: {
    background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
    color:'#fff', padding:'8px 16px', borderRadius:'8px',
    fontSize:'0.85rem', fontWeight:'500', cursor:'pointer',
    backdropFilter:'blur(10px)'
  }
};