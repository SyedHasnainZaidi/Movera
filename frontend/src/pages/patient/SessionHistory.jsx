import { useEffect, useState } from 'react';
import api from '../../api/axiosInstance';

export default function SessionHistory() {
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    api.get('/patient/history')
      .then(r => setSessions(r.data || []))
      .catch(() => {
        // demo data if backend not ready
        setSessions([
          { date: new Date(), exerciseName:'Squat', repsDone:10,
            accuracy:85, errors:['Knee too far forward'] },
          { date: new Date(), exerciseName:'Lunge', repsDone:8,
            accuracy:90, errors:[] },
          { date: new Date(), exerciseName:'Squat', repsDone:12,
            accuracy:92, errors:[] },
        ]);
      });
  }, []);

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Session History 🕐</h2>
      <p style={styles.sub}>Your past exercise sessions</p>

      {sessions.length === 0 ? (
        <div style={styles.empty}>No sessions recorded yet.</div>
      ) : (
        <div style={styles.list}>
          {sessions.map((s, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.left}>
                <div style={styles.icon}>🏋️</div>
                <div>
                  <h3 style={styles.name}>{s.exerciseName}</h3>
                  <p style={styles.date}>
                    {new Date(s.date).toLocaleDateString('en-US', {
                      weekday:'short', year:'numeric',
                      month:'short', day:'numeric'
                    })}
                  </p>
                </div>
              </div>
              <div style={styles.stats}>
                <div style={styles.statBox}>
                  <strong>{s.repsDone}</strong>
                  <span>Reps</span>
                </div>
                <div style={styles.statBox}>
                  <strong style={{
                    color: s.accuracy >= 80 ? '#34a853' : '#ea4335'
                  }}>
                    {s.accuracy}%
                  </strong>
                  <span>Accuracy</span>
                </div>
                <div style={styles.statBox}>
                  <strong style={{ color:'#ea4335' }}>
                    {s.errors?.length || 0}
                  </strong>
                  <span>Errors</span>
                </div>
              </div>
              {s.errors?.length > 0 && (
                <div style={styles.errors}>
                  ⚠️ {s.errors.join(', ')}
                </div>
              )}
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
           textAlign:'center', color:'#666' },
  list: { display:'flex', flexDirection:'column', gap:'14px' },
  card: { background:'#fff', padding:'20px 24px', borderRadius:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.07)',
          display:'flex', alignItems:'center',
          gap:'20px', flexWrap:'wrap' },
  left: { display:'flex', alignItems:'center', gap:'14px', flex:1 },
  icon: { fontSize:'2rem' },
  name: { color:'#222', marginBottom:'4px' },
  date: { color:'#888', fontSize:'0.9rem' },
  stats: { display:'flex', gap:'16px' },
  statBox: { display:'flex', flexDirection:'column',
             alignItems:'center', gap:'2px',
             background:'#f4f6fb', padding:'10px 16px',
             borderRadius:'8px', minWidth:'60px' },
  errors: { width:'100%', background:'#fff3f3', color:'#ea4335',
            padding:'8px 14px', borderRadius:'8px',
            fontSize:'0.9rem' }
};