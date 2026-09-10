import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import api from '../../api/axiosInstance';

export default function ProgressReports() {
  const [data, setData] = useState([]);

  useEffect(() => {
    api.get('/patient/progress')
      .then(r => setData(r.data || []))
      .catch(() => {
        // demo data if backend not ready
        setData([
          { date:'Week 1', accuracy:55, reps:6 },
          { date:'Week 2', accuracy:65, reps:8 },
          { date:'Week 3', accuracy:72, reps:10 },
          { date:'Week 4', accuracy:80, reps:12 },
          { date:'Week 5', accuracy:85, reps:14 },
          { date:'Week 6', accuracy:91, reps:15 },
        ]);
      });
  }, []);

  const latest = data[data.length - 1];
  const first = data[0];
  const improvement = latest && first
    ? (latest.accuracy - first.accuracy).toFixed(0)
    : 0;

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Progress Reports 📈</h2>
      <p style={styles.sub}>Track your rehabilitation journey</p>

      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <h3 style={{ color:'#1a73e8' }}>{latest?.accuracy || 0}%</h3>
          <p>Latest Accuracy</p>
        </div>
        <div style={styles.stat}>
          <h3 style={{ color:'#34a853' }}>+{improvement}%</h3>
          <p>Overall Improvement</p>
        </div>
        <div style={styles.stat}>
          <h3 style={{ color:'#fbbc04' }}>{data.length}</h3>
          <p>Weeks Tracked</p>
        </div>
        <div style={styles.stat}>
          <h3 style={{ color:'#ea4335' }}>{latest?.reps || 0}</h3>
          <p>Latest Reps</p>
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Accuracy Over Time</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="accuracy"
              stroke="#1a73e8"
              strokeWidth={3}
              dot={{ r:5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Reps Completed Per Week</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="reps" fill="#34a853" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888', marginBottom:'28px' },
  statsRow: { display:'flex', gap:'16px', marginBottom:'24px',
              flexWrap:'wrap' },
  stat: { background:'#fff', padding:'20px', borderRadius:'10px',
          flex:1, textAlign:'center', minWidth:'120px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.07)' },
  card: { background:'#fff', padding:'24px', borderRadius:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.08)',
          marginBottom:'20px' },
  cardTitle: { color:'#444', marginBottom:'16px' }
};