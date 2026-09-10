import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axiosInstance';

export default function TherapistDashboard() {
  const { user } = useAuth();
  const [patients, setPatients] = useState([]);

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
          { _id:'4', name:'Fatima Noor', email:'fatima@gmail.com',
            lastSession:'3 days ago', accuracy:78 },
        ]);
      });
  }, []);

  const onTrack = patients.filter(p => p.accuracy >= 80).length;
  const needAttention = patients.filter(p => p.accuracy < 80).length;

  return (
    <div style={styles.page}>

      {/* Welcome Banner */}
      <div style={styles.banner}>
        <div>
          <h2 style={styles.bannerTitle}>
            Welcome, Dr. {user?.name?.split(' ')[0]} 👨‍⚕️
          </h2>
          <p style={styles.bannerSub}>
            You have {patients.length} patients under your care.
            {needAttention > 0 &&
              ` ${needAttention} need your attention.`}
          </p>
        </div>
        <div style={styles.bannerIcon}>🏥</div>
      </div>

      {/* Stats */}
      <div style={styles.statsRow}>
        {[
          { icon:'👥', label:'Total Patients',
            value: patients.length, color:'#667eea' },
          { icon:'✅', label:'On Track',
            value: onTrack, color:'#34a853' },
          { icon:'⚠️', label:'Need Attention',
            value: needAttention, color:'#ea4335' },
          { icon:'📊', label:'Avg Accuracy',
            value: patients.length
              ? Math.round(patients.reduce((a,p) =>
                  a + (p.accuracy||0), 0) / patients.length) + '%'
              : '—',
            color:'#fb8c00' },
        ].map((s, i) => (
          <div key={i} style={styles.statCard}>
            <div style={{
              ...styles.statIcon,
              background: s.color + '20'
            }}>
              {s.icon}
            </div>
            <div>
              <h3 style={{
                ...styles.statValue,
                color: s.color
              }}>
                {s.value}
              </h3>
              <p style={styles.statLabel}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Patient List */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Your Patients</h3>
          <Link to="/therapist/patients" style={styles.seeAll}>
            View all →
          </Link>
        </div>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Patient','Email','Last Session',
                  'Accuracy','Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.map(p => (
                <tr key={p._id} style={styles.tr}>
                  <td style={styles.td}>
                    <div style={styles.patientCell}>
                      <div style={styles.avatar}>
                        {p.name?.[0]?.toUpperCase()}
                      </div>
                      <strong>{p.name}</strong>
                    </div>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.email}>{p.email}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.lastSession}>
                      {p.lastSession}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.accuracyWrap}>
                      <div style={styles.accuracyBar}>
                        <div style={{
                          ...styles.accuracyFill,
                          width: `${p.accuracy}%`,
                          background: p.accuracy >= 80
                            ? '#34a853' : '#ea4335'
                        }} />
                      </div>
                      <span style={{
                        color: p.accuracy >= 80
                          ? '#34a853' : '#ea4335',
                        fontWeight:'600',
                        fontSize:'0.85rem'
                      }}>
                        {p.accuracy}%
                      </span>
                    </div>
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <Link
                        to={`/therapist/patient/${p._id}`}
                        style={styles.viewBtn}>
                        Reports
                      </Link>
                      <Link
                        to={`/therapist/assign/${p._id}`}
                        style={styles.assignBtn}>
                        Assign
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Quick Actions</h3>
        <div style={styles.quickGrid}>
          {[
            { icon:'👥', label:'Patient List',
              path:'/therapist/patients', color:'#667eea' },
            { icon:'📚', label:'Exercise Library',
              path:'/therapist/exercises', color:'#34a853' },
            { icon:'📊', label:'Analytics',
              path:'/therapist/analytics', color:'#fb8c00' },
            { icon:'💬', label:'Messages',
              path:'/therapist/messages', color:'#764ba2' },
          ].map((q, i) => (
            <Link key={i} to={q.path} style={styles.quickCard}>
              <div style={{
                ...styles.quickIcon,
                background: q.color + '20',
                color: q.color
              }}>
                {q.icon}
              </div>
              <span style={styles.quickLabel}>{q.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px', maxWidth:'1200px', margin:'0 auto' },

  // Banner
  banner: {
    background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderRadius:'16px', padding:'32px 40px', marginBottom:'24px',
    display:'flex', justifyContent:'space-between', alignItems:'center'
  },
  bannerTitle: { fontSize:'1.6rem', fontWeight:'700',
                 color:'#fff', marginBottom:'8px' },
  bannerSub: { color:'rgba(255,255,255,0.85)', fontSize:'1rem' },
  bannerIcon: { fontSize:'4rem' },

  // Stats
  statsRow: { display:'flex', gap:'16px', marginBottom:'24px',
              flexWrap:'wrap' },
  statCard: { background:'#fff', padding:'20px 24px',
              borderRadius:'14px', flex:1, minWidth:'140px',
              display:'flex', alignItems:'center', gap:'16px',
              boxShadow:'0 2px 12px rgba(0,0,0,0.06)' },
  statIcon: { width:'48px', height:'48px', borderRadius:'12px',
              display:'flex', alignItems:'center',
              justifyContent:'center', fontSize:'1.4rem',
              flexShrink:0 },
  statValue: { fontSize:'1.6rem', fontWeight:'700', lineHeight:1 },
  statLabel: { color:'#718096', fontSize:'0.85rem', marginTop:'4px' },

  // Section
  section: { background:'#fff', borderRadius:'16px', padding:'24px',
             marginBottom:'24px',
             boxShadow:'0 2px 12px rgba(0,0,0,0.06)' },
  sectionHeader: { display:'flex', justifyContent:'space-between',
                   alignItems:'center', marginBottom:'20px' },
  sectionTitle: { fontSize:'1.1rem', fontWeight:'600',
                  color:'#1a202c' },
  seeAll: { color:'#667eea', fontSize:'0.9rem', fontWeight:'500' },

  // Table
  tableWrap: { overflowX:'auto' },
  table: { width:'100%', borderCollapse:'collapse' },
  th: { padding:'12px 16px', textAlign:'left', fontSize:'0.8rem',
        fontWeight:'600', color:'#718096', textTransform:'uppercase',
        letterSpacing:'0.05em', borderBottom:'2px solid #f0f4f8' },
  tr: { borderBottom:'1px solid #f0f4f8' },
  td: { padding:'14px 16px', verticalAlign:'middle' },
  patientCell: { display:'flex', alignItems:'center', gap:'12px' },
  avatar: { width:'36px', height:'36px', borderRadius:'50%',
            background:'#e8f0fe', color:'#667eea', display:'flex',
            alignItems:'center', justifyContent:'center',
            fontWeight:'700', fontSize:'0.9rem', flexShrink:0 },
  email: { color:'#718096', fontSize:'0.9rem' },
  lastSession: { color:'#718096', fontSize:'0.9rem' },
  accuracyWrap: { display:'flex', alignItems:'center', gap:'10px' },
  accuracyBar: { flex:1, height:'6px', background:'#f0f4f8',
                 borderRadius:'3px', minWidth:'80px' },
  accuracyFill: { height:'100%', borderRadius:'3px',
                  transition:'width 0.3s' },
  actions: { display:'flex', gap:'8px' },
  viewBtn: { background:'#e8f0fe', color:'#667eea', padding:'6px 14px',
             borderRadius:'6px', fontSize:'0.85rem', fontWeight:'500' },
  assignBtn: { background:'linear-gradient(135deg, #667eea, #764ba2)',
               color:'#fff', padding:'6px 14px', borderRadius:'6px',
               fontSize:'0.85rem', fontWeight:'500' },

  // Quick Actions
  quickGrid: { display:'grid',
               gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))',
               gap:'16px', marginTop:'16px' },
  quickCard: { display:'flex', flexDirection:'column',
               alignItems:'center', gap:'12px', padding:'24px',
               borderRadius:'12px', border:'1px solid #e2e8f0',
               textDecoration:'none', background:'#f8faff' },
  quickIcon: { width:'52px', height:'52px', borderRadius:'14px',
               display:'flex', alignItems:'center',
               justifyContent:'center', fontSize:'1.5rem' },
  quickLabel: { color:'#4a5568', fontSize:'0.9rem',
                fontWeight:'500', textAlign:'center' },
};