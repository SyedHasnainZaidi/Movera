import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axiosInstance';

export default function PatientList() {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/therapist/patients')
      .then(r => setPatients(r.data || []))
      .catch(() => {
        setPatients([
          { _id:'1', name:'Ahmed Khan', email:'ahmed@gmail.com',
            lastSession:'2 days ago', accuracy:85 },
          { _id:'2', name:'Sara Ali', email:'sara@gmail.com',
            lastSession:'Today', accuracy:92 },
          { _id:'3', name:'Usman Malik', email:'usman@gmail.com',
            lastSession:'1 week ago', accuracy:60 },
        ]);
      });
  }, []);

  const filtered = patients.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Patient List 👥</h2>
          <p style={styles.sub}>Manage all your patients</p>
        </div>
      </div>

      <input
        placeholder="🔍 Search patients by name or email..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={styles.search}
      />

      <div style={styles.list}>
        {filtered.map(p => (
          <div key={p._id} style={styles.card}>
            <div style={styles.left}>
              <div style={styles.avatar}>
                {p.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <h3 style={styles.name}>{p.name}</h3>
                <p style={styles.email}>{p.email}</p>
                <p style={styles.lastSession}>
                  Last session: {p.lastSession}
                </p>
              </div>
            </div>
            <div style={styles.right}>
              <div style={{
                ...styles.accuracy,
                color: p.accuracy >= 80 ? '#34a853' : '#ea4335',
                background: p.accuracy >= 80 ? '#e6f4ea' : '#fce8e6'
              }}>
                {p.accuracy}% accuracy
              </div>
              <div style={styles.btnGroup}>
                <Link
                  to={`/therapist/patient/${p._id}`}
                  style={styles.viewBtn}>
                  📊 Reports
                </Link>
                <Link
                  to={`/therapist/assign/${p._id}`}
                  style={styles.assignBtn}>
                  ➕ Assign
                </Link>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={styles.empty}>
            No patients found matching "{search}"
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  header: { display:'flex', justifyContent:'space-between',
            alignItems:'center', marginBottom:'20px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888' },
  search: { width:'100%', padding:'14px', border:'1px solid #ddd',
            borderRadius:'10px', fontSize:'1rem', marginBottom:'20px',
            boxSizing:'border-box' },
  list: { display:'flex', flexDirection:'column', gap:'14px' },
  card: { background:'#fff', padding:'20px 24px', borderRadius:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.07)',
          display:'flex', justifyContent:'space-between',
          alignItems:'center', flexWrap:'wrap', gap:'16px' },
  left: { display:'flex', alignItems:'center', gap:'16px' },
  avatar: { width:'52px', height:'52px', borderRadius:'50%',
             background:'#e8f0fe', color:'#1a73e8', fontSize:'1.4rem',
             display:'flex', alignItems:'center', justifyContent:'center',
             fontWeight:'bold', flexShrink:0 },
  name: { color:'#222', marginBottom:'4px' },
  email: { color:'#888', fontSize:'0.9rem', marginBottom:'2px' },
  lastSession: { color:'#aaa', fontSize:'0.85rem' },
  right: { display:'flex', flexDirection:'column',
           alignItems:'flex-end', gap:'10px' },
  accuracy: { padding:'4px 14px', borderRadius:'20px',
              fontSize:'0.85rem', fontWeight:'bold' },
  btnGroup: { display:'flex', gap:'8px' },
  viewBtn: { background:'#e8f0fe', color:'#1a73e8', padding:'8px 16px',
             borderRadius:'6px', fontSize:'0.9rem' },
  assignBtn: { background:'#34a853', color:'#fff', padding:'8px 16px',
               borderRadius:'6px', fontSize:'0.9rem' },
  empty: { background:'#fff', padding:'48px', borderRadius:'12px',
           textAlign:'center', color:'#888' }
};