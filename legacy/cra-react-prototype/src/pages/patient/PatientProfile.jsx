import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export default function PatientProfile() {
  const { user, logout } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>My Profile 👤</h2>
      <p style={styles.sub}>Manage your account details</p>

      <div style={styles.card}>
        <div style={styles.avatarWrap}>
          <div style={styles.avatar}>
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <h3 style={styles.name}>{user?.name}</h3>
          <span style={styles.role}>Patient</span>
        </div>

        <div style={styles.divider} />

        <div style={styles.infoList}>
          <div style={styles.infoRow}>
            <span style={styles.label}>👤 Full Name</span>
            {editing ? (
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                style={styles.input}
              />
            ) : (
              <span style={styles.value}>{user?.name}</span>
            )}
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>📧 Email</span>
            <span style={styles.value}>{user?.email}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.label}>🏥 Role</span>
            <span style={styles.value}>Patient</span>
          </div>
        </div>

        <div style={styles.btnRow}>
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                style={styles.saveBtn}>
                Save Changes
              </button>
              <button
                onClick={() => setEditing(false)}
                style={styles.cancelBtn}>
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              style={styles.editBtn}>
              ✏️ Edit Profile
            </button>
          )}
        </div>

        <div style={styles.divider} />

        <button onClick={logout} style={styles.logoutBtn}>
          🚪 Logout
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888', marginBottom:'28px' },
  card: { background:'#fff', padding:'32px', borderRadius:'16px',
          maxWidth:'480px', boxShadow:'0 4px 20px rgba(0,0,0,0.08)',
          display:'flex', flexDirection:'column', gap:'20px' },
  avatarWrap: { display:'flex', flexDirection:'column',
                alignItems:'center', gap:'10px' },
  avatar: { width:'80px', height:'80px', borderRadius:'50%',
             background:'#1a73e8', color:'#fff', fontSize:'2.2rem',
             display:'flex', alignItems:'center', justifyContent:'center' },
  name: { fontSize:'1.3rem', color:'#222' },
  role: { background:'#e8f0fe', color:'#1a73e8', padding:'4px 16px',
          borderRadius:'20px', fontSize:'0.85rem' },
  divider: { height:'1px', background:'#eee' },
  infoList: { display:'flex', flexDirection:'column', gap:'16px' },
  infoRow: { display:'flex', justifyContent:'space-between',
             alignItems:'center' },
  label: { color:'#888', fontSize:'0.95rem' },
  value: { color:'#222', fontWeight:'500' },
  input: { padding:'8px 12px', border:'1px solid #ddd',
           borderRadius:'6px', fontSize:'0.95rem' },
  btnRow: { display:'flex', gap:'10px' },
  editBtn: { background:'#1a73e8', color:'#fff', border:'none',
             padding:'10px 24px', borderRadius:'8px', fontSize:'0.95rem' },
  saveBtn: { background:'#34a853', color:'#fff', border:'none',
             padding:'10px 24px', borderRadius:'8px', fontSize:'0.95rem' },
  cancelBtn: { background:'#f4f6fb', color:'#666', border:'1px solid #ddd',
               padding:'10px 24px', borderRadius:'8px', fontSize:'0.95rem' },
  logoutBtn: { background:'#fff', color:'#ea4335', border:'2px solid #ea4335',
               padding:'10px 24px', borderRadius:'8px', fontSize:'0.95rem',
               width:'100%' }
};