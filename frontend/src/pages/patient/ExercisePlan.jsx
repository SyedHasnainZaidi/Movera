import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axiosInstance';

export default function ExercisePlan() {
  const [plan, setPlan] = useState([]);

  useEffect(() => {
    api.get('/patient/dashboard')
      .then(r => setPlan(r.data.exercises || []))
      .catch(() => {});
  }, []);

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>My Exercise Plan 📋</h2>
      <p style={styles.sub}>Exercises assigned by your therapist</p>

      {plan.length === 0 ? (
        <div style={styles.empty}>
          <p>No exercises assigned yet.</p>
          <p style={{ color:'#aaa', marginTop:'8px' }}>
            Contact your therapist to get started!
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {plan.map((ex, i) => (
            <div key={ex._id} style={styles.card}>
              <div style={styles.number}>{i + 1}</div>
              <div style={styles.info}>
                <h3 style={styles.name}>{ex.name}</h3>
                <div style={styles.tags}>
                  <span style={styles.tag}>🎯 {ex.reps} reps</span>
                  <span style={styles.tag}>💪 {ex.difficulty}</span>
                  <span style={styles.tag}>📅 {ex.schedule}</span>
                  <span style={styles.tag}>
                    🦵 {ex.targetJoints?.join(', ')}
                  </span>
                </div>
              </div>
              <Link
                to={`/patient/session/${ex._id}`}
                style={styles.btn}>
                Start ▶
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888', marginBottom:'28px' },
  empty: { background:'#fff', padding:'48px', borderRadius:'12px',
           textAlign:'center', color:'#666',
           boxShadow:'0 2px 10px rgba(0,0,0,0.07)' },
  list: { display:'flex', flexDirection:'column', gap:'14px' },
  card: { background:'#fff', padding:'20px 24px', borderRadius:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.07)',
          display:'flex', alignItems:'center', gap:'20px' },
  number: { width:'40px', height:'40px', borderRadius:'50%',
            background:'#1a73e8', color:'#fff', display:'flex',
            alignItems:'center', justifyContent:'center',
            fontWeight:'bold', flexShrink:0 },
  info: { flex:1 },
  name: { color:'#222', marginBottom:'8px' },
  tags: { display:'flex', gap:'8px', flexWrap:'wrap' },
  tag: { background:'#f0f4ff', color:'#1a73e8', padding:'4px 12px',
         borderRadius:'20px', fontSize:'0.85rem' },
  btn: { background:'#1a73e8', color:'#fff', padding:'10px 20px',
         borderRadius:'8px', flexShrink:0 }
};