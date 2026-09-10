import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axiosInstance';

export default function PatientDashboard() {
  const { user } = useAuth();
  const [plan, setPlan] = useState([]);

  useEffect(() => {
    api.get('/patient/dashboard')
      .then(r => setPlan(r.data.exercises || []))
      .catch(() => {
        setPlan([
          { _id:'1', name:'Squat', reps:12, difficulty:'medium',
            schedule:'Daily', targetJoints:['knee','hip'] },
          { _id:'2', name:'Shoulder Press', reps:10, difficulty:'easy',
            schedule:'Daily', targetJoints:['shoulder'] },
          { _id:'3', name:'Lunge', reps:8, difficulty:'hard',
            schedule:'Weekly', targetJoints:['knee','ankle'] },
        ]);
      });
  }, []);

  const diffColor = {
    easy:   { bg:'#e6f4ea', color:'#34a853' },
    medium: { bg:'#fff3e0', color:'#fb8c00' },
    hard:   { bg:'#fce8e6', color:'#ea4335' },
  };

  return (
    <div style={styles.page}>

      {/* Welcome Banner */}
      <div style={styles.banner}>
        <div>
          <h2 style={styles.bannerTitle}>
            Good morning, {user?.name?.split(' ')[0]} 👋
          </h2>
          <p style={styles.bannerSub}>
            You have {plan.length} exercises assigned today.
            Let's get moving!
          </p>
        </div>
        <div style={styles.bannerIcon}>🏃‍♂️</div>
      </div>

      {/* Stats Row */}
      <div style={styles.statsRow}>
        {[
          { icon:'🏋️', label:'Assigned', value:plan.length,
            color:'#667eea' },
          { icon:'✅', label:'Completed', value:'0',
            color:'#34a853' },
          { icon:'🎯', label:'Accuracy', value:'—',
            color:'#fb8c00' },
          { icon:'🔥', label:'Day Streak', value:'1',
            color:'#ea4335' },
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

      {/* Today's Exercises */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <h3 style={styles.sectionTitle}>Today's Exercises</h3>
          <Link to="/patient/plan" style={styles.seeAll}>
            View all →
          </Link>
        </div>
        <div style={styles.exerciseGrid}>
          {plan.map((ex, i) => (
            <div key={ex._id} style={styles.exCard}>
              <div style={styles.exCardTop}>
                <div style={styles.exNum}>{i + 1}</div>
                <span style={{
                  ...styles.diffBadge,
                  background: diffColor[ex.difficulty]?.bg,
                  color: diffColor[ex.difficulty]?.color,
                }}>
                  {ex.difficulty}
                </span>
              </div>
              <h3 style={styles.exName}>{ex.name}</h3>
              <div style={styles.exMeta}>
                <span>🔁 {ex.reps} reps</span>
                <span>📅 {ex.schedule}</span>
              </div>
              <div style={styles.exJoints}>
                {ex.targetJoints?.map((j, idx) => (
                  <span key={idx} style={styles.joint}>{j}</span>
                ))}
              </div>
              <Link
                to={`/patient/session/${ex._id}`}
                style={styles.startBtn}>
                Start Exercise ▶
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Quick Actions</h3>
        <div style={styles.quickGrid}>
          {[
            { icon:'📋', label:'My Exercise Plan',
              path:'/patient/plan', color:'#667eea' },
            { icon:'📈', label:'Progress Reports',
              path:'/patient/progress', color:'#34a853' },
            { icon:'🕐', label:'Session History',
              path:'/patient/history', color:'#fb8c00' },
            { icon:'💬', label:'Message Therapist',
              path:'/patient/messages', color:'#764ba2' },
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
  bannerTitle: { fontSize:'1.6rem', fontWeight:'700', color:'#fff',
                 marginBottom:'8px' },
  bannerSub: { color:'rgba(255,255,255,0.85)', fontSize:'1rem' },
  bannerIcon: { fontSize:'4rem' },

  // Stats
  statsRow: { display:'flex', gap:'16px', marginBottom:'24px',
              flexWrap:'wrap' },
  statCard: { background:'#fff', padding:'20px 24px', borderRadius:'14px',
              flex:1, minWidth:'140px', display:'flex',
              alignItems:'center', gap:'16px',
              boxShadow:'0 2px 12px rgba(0,0,0,0.06)' },
  statIcon: { width:'48px', height:'48px', borderRadius:'12px',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:'1.4rem', flexShrink:0 },
  statValue: { fontSize:'1.6rem', fontWeight:'700', lineHeight:1 },
  statLabel: { color:'#718096', fontSize:'0.85rem', marginTop:'4px' },

  // Section
  section: { background:'#fff', borderRadius:'16px', padding:'24px',
             marginBottom:'24px',
             boxShadow:'0 2px 12px rgba(0,0,0,0.06)' },
  sectionHeader: { display:'flex', justifyContent:'space-between',
                   alignItems:'center', marginBottom:'20px' },
  sectionTitle: { fontSize:'1.1rem', fontWeight:'600', color:'#1a202c' },
  seeAll: { color:'#667eea', fontSize:'0.9rem', fontWeight:'500' },

  // Exercise Cards
  exerciseGrid: { display:'grid',
                  gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))',
                  gap:'16px' },
  exCard: { background:'#f8faff', borderRadius:'12px', padding:'20px',
            border:'1px solid #e2e8f0', display:'flex',
            flexDirection:'column', gap:'10px' },
  exCardTop: { display:'flex', justifyContent:'space-between',
               alignItems:'center' },
  exNum: { width:'28px', height:'28px', borderRadius:'8px',
           background:'#667eea', color:'#fff', display:'flex',
           alignItems:'center', justifyContent:'center',
           fontSize:'0.85rem', fontWeight:'700' },
  diffBadge: { padding:'4px 12px', borderRadius:'20px',
               fontSize:'0.78rem', fontWeight:'600' },
  exName: { fontSize:'1.05rem', fontWeight:'600', color:'#1a202c' },
  exMeta: { display:'flex', gap:'12px', color:'#718096',
            fontSize:'0.85rem' },
  exJoints: { display:'flex', gap:'6px', flexWrap:'wrap' },
  joint: { background:'#e8f0fe', color:'#667eea', padding:'2px 10px',
           borderRadius:'20px', fontSize:'0.78rem' },
  startBtn: { display:'block', textAlign:'center', marginTop:'8px',
              background:'linear-gradient(135deg, #667eea, #764ba2)',
              color:'#fff', padding:'10px', borderRadius:'8px',
              fontSize:'0.9rem', fontWeight:'600' },

  // Quick Actions
  quickGrid: { display:'grid',
               gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))',
               gap:'16px' },
  quickCard: { display:'flex', flexDirection:'column', alignItems:'center',
               gap:'12px', padding:'24px', borderRadius:'12px',
               border:'1px solid #e2e8f0', textDecoration:'none',
               background:'#f8faff', transition:'all 0.2s' },
  quickIcon: { width:'52px', height:'52px', borderRadius:'14px',
               display:'flex', alignItems:'center', justifyContent:'center',
               fontSize:'1.5rem' },
  quickLabel: { color:'#4a5568', fontSize:'0.9rem', fontWeight:'500',
                textAlign:'center' },
};