import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import api from '../../api/axiosInstance';

export default function PatientDetail() {
  const { id } = useParams();
  const [reports, setReports] = useState([]);
  const [patient, setPatient] = useState(null);

  useEffect(() => {
    api.get(`/therapist/patient/${id}/reports`)
      .then(r => setReports(r.data || []))
      .catch(() => {
        setReports([
          { date:'Week 1', accuracy:50, reps:5 },
          { date:'Week 2', accuracy:62, reps:7 },
          { date:'Week 3', accuracy:70, reps:10 },
          { date:'Week 4', accuracy:78, reps:12 },
          { date:'Week 5', accuracy:85, reps:14 },
          { date:'Week 6', accuracy:90, reps:15 },
        ]);
        setPatient({ name:'Ahmed Khan', email:'ahmed@gmail.com' });
      });
  }, [id]);

  const latest = reports[reports.length - 1];
  const first = reports[0];
  const improvement = latest && first
    ? (latest.accuracy - first.accuracy).toFixed(0)
    : 0;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>
            Patient Report 📊
          </h2>
          {patient && (
            <p style={styles.sub}>
              {patient.name} — {patient.email}
            </p>
          )}
        </div>
        <Link
          to={`/therapist/assign/${id}`}
          style={styles.assignBtn}>
          ➕ Assign Exercise
        </Link>
      </div>

      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <h3 style={{ color:'#1a73e8' }}>
            {latest?.accuracy || 0}%
          </h3>
          <p>Latest Accuracy</p>
        </div>
        <div style={styles.stat}>
          <h3 style={{ color:'#34a853' }}>+{improvement}%</h3>
          <p>Improvement</p>
        </div>
        <div style={styles.stat}>
          <h3 style={{ color:'#fbbc04' }}>{reports.length}</h3>
          <p>Weeks Tracked</p>
        </div>
        <div style={styles.stat}>
          <h3 style={{ color:'#ea4335' }}>
            {latest?.reps || 0}
          </h3>
          <p>Latest Reps</p>
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Accuracy Trend</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={reports}>
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
        <h3 style={styles.cardTitle}>Reps Per Week</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={reports}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="reps"
              fill="#34a853"
              radius={[6,6,0,0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  header: { display:'flex', justifyContent:'space-between',
            alignItems:'center', marginBottom:'24px',
            flexWrap:'wrap', gap:'12px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888' },
  assignBtn: { background:'#34a853', color:'#fff',
               padding:'10px 24px', borderRadius:'8px' },
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