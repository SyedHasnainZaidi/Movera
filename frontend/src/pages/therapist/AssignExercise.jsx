import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axiosInstance';

export default function AssignExercise() {
  const { patientId } = useParams();
  const [exercises, setExercises] = useState([]);
  const [form, setForm] = useState({
    exerciseId:'', reps:10, schedule:'daily', difficulty:'easy'
  });
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/exercises')
      .then(r => setExercises(r.data || []))
      .catch(() => {
        setExercises([
          { _id:'1', name:'Squat' },
          { _id:'2', name:'Lunge' },
          { _id:'3', name:'Shoulder Press' },
        ]);
      });
  }, []);

  const assign = async () => {
    if (!form.exerciseId) return;
    await api.post('/therapist/assign', {
      patientId, ...form
    }).catch(() => {});
    setSuccess(true);
    setTimeout(() => navigate('/therapist/patients'), 2000);
  };

  if (success) return (
    <div style={styles.successWrap}>
      <div style={styles.successCard}>
        <div style={styles.checkmark}>✅</div>
        <h2>Exercise Assigned!</h2>
        <p style={styles.successSub}>
          Redirecting back to patients...
        </p>
      </div>
    </div>
  );

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Assign Exercise ➕</h2>
      <p style={styles.sub}>
        Assign a physiotherapy exercise to this patient
      </p>

      <div style={styles.card}>
        <div style={styles.field}>
          <label style={styles.label}>Select Exercise</label>
          <select
            style={styles.input}
            value={form.exerciseId}
            onChange={e =>
              setForm({...form, exerciseId: e.target.value})}>
            <option value="">-- Choose an exercise --</option>
            {exercises.map(ex => (
              <option key={ex._id} value={ex._id}>
                {ex.name}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Number of Reps</label>
          <input
            type="number"
            min="1"
            max="100"
            value={form.reps}
            style={styles.input}
            onChange={e =>
              setForm({...form, reps: parseInt(e.target.value)})}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Schedule</label>
          <select
            style={styles.input}
            value={form.schedule}
            onChange={e =>
              setForm({...form, schedule: e.target.value})}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="twice_a_week">Twice a Week</option>
            <option value="three_times_a_week">
              Three Times a Week
            </option>
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Difficulty Level</label>
          <select
            style={styles.input}
            value={form.difficulty}
            onChange={e =>
              setForm({...form, difficulty: e.target.value})}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <div style={styles.preview}>
          <h4 style={styles.previewTitle}>Summary</h4>
          <p>📋 Exercise: <strong>
            {exercises.find(e => e._id === form.exerciseId)?.name
              || 'Not selected'}
          </strong></p>
          <p>🔁 Reps: <strong>{form.reps}</strong></p>
          <p>📅 Schedule: <strong>{form.schedule}</strong></p>
          <p>💪 Difficulty: <strong>{form.difficulty}</strong></p>
        </div>

        <div style={styles.btnRow}>
          <button
            onClick={() => navigate('/therapist/patients')}
            style={styles.cancelBtn}>
            Cancel
          </button>
          <button
            onClick={assign}
            style={styles.assignBtn}>
            Assign Exercise ✅
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888', marginBottom:'28px' },
  card: { background:'#fff', padding:'32px', borderRadius:'16px',
          maxWidth:'520px',
          boxShadow:'0 4px 20px rgba(0,0,0,0.08)',
          display:'flex', flexDirection:'column', gap:'20px' },
  field: { display:'flex', flexDirection:'column', gap:'8px' },
  label: { color:'#444', fontWeight:'500', fontSize:'0.95rem' },
  input: { padding:'12px', border:'1px solid #ddd',
           borderRadius:'8px', fontSize:'1rem' },
  preview: { background:'#f4f6fb', padding:'16px',
             borderRadius:'10px', display:'flex',
             flexDirection:'column', gap:'8px', color:'#444' },
  previewTitle: { color:'#222', marginBottom:'4px' },
  btnRow: { display:'flex', gap:'12px' },
  cancelBtn: { flex:1, background:'#f4f6fb', color:'#666',
               border:'1px solid #ddd', padding:'12px',
               borderRadius:'8px', fontSize:'1rem' },
  assignBtn: { flex:2, background:'#34a853', color:'#fff',
               border:'none', padding:'12px',
               borderRadius:'8px', fontSize:'1rem' },
  successWrap: { display:'flex', justifyContent:'center',
                 alignItems:'center', height:'80vh' },
  successCard: { background:'#fff', padding:'48px', borderRadius:'16px',
                 textAlign:'center',
                 boxShadow:'0 4px 20px rgba(0,0,0,0.1)' },
  checkmark: { fontSize:'4rem', marginBottom:'16px' },
  successSub: { color:'#888', marginTop:'8px' }
};