import { useEffect, useState } from 'react';
import api from '../../api/axiosInstance';

export default function ExerciseLibrary() {
  const [exercises, setExercises] = useState([]);
  const [form, setForm] = useState({
    name:'', targetJoints:'', difficulty:'easy', description:''
  });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    api.get('/exercises')
      .then(r => setExercises(r.data || []))
      .catch(() => {
        setExercises([
          { _id:'1', name:'Squat', targetJoints:['knee','hip'],
            difficulty:'medium', description:'Basic squat exercise' },
          { _id:'2', name:'Lunge', targetJoints:['knee','ankle'],
            difficulty:'easy', description:'Forward lunge' },
          { _id:'3', name:'Shoulder Press', targetJoints:['shoulder','elbow'],
            difficulty:'hard', description:'Overhead press' },
        ]);
      });
  }, []);

  const add = async () => {
    if (!form.name.trim()) return;
    const newEx = {
      ...form,
      targetJoints: form.targetJoints.split(',').map(j => j.trim()),
      _id: Date.now().toString()
    };
    await api.post('/exercises', newEx).catch(() => {});
    setExercises([...exercises, newEx]);
    setForm({ name:'', targetJoints:'', difficulty:'easy', description:'' });
    setShowForm(false);
  };

  const diffColor = {
    easy: { bg:'#e6f4ea', color:'#34a853' },
    medium: { bg:'#fff3e0', color:'#fb8c00' },
    hard: { bg:'#fce8e6', color:'#ea4335' }
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Exercise Library 📚</h2>
          <p style={styles.sub}>
            Manage your physiotherapy exercises
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={styles.addBtn}>
          {showForm ? '✕ Cancel' : '+ Add Exercise'}
        </button>
      </div>

      {showForm && (
        <div style={styles.formCard}>
          <h3 style={styles.formTitle}>New Exercise</h3>
          <div style={styles.formGrid}>
            <input
              placeholder="Exercise Name"
              value={form.name}
              style={styles.input}
              onChange={e => setForm({...form, name: e.target.value})}
            />
            <input
              placeholder="Target Joints (e.g. knee, hip)"
              value={form.targetJoints}
              style={styles.input}
              onChange={e =>
                setForm({...form, targetJoints: e.target.value})}
            />
            <select
              value={form.difficulty}
              style={styles.input}
              onChange={e =>
                setForm({...form, difficulty: e.target.value})}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <input
              placeholder="Description"
              value={form.description}
              style={styles.input}
              onChange={e =>
                setForm({...form, description: e.target.value})}
            />
          </div>
          <button onClick={add} style={styles.saveBtn}>
            Save Exercise ✅
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {exercises.map(ex => (
          <div key={ex._id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.exName}>{ex.name}</h3>
              <span style={{
                ...styles.diffBadge,
                background: diffColor[ex.difficulty]?.bg,
                color: diffColor[ex.difficulty]?.color
              }}>
                {ex.difficulty}
              </span>
            </div>
            <p style={styles.desc}>{ex.description}</p>
            <div style={styles.joints}>
              {ex.targetJoints?.map((j, i) => (
                <span key={i} style={styles.joint}>{j}</span>
              ))}
            </div>
          </div>
        ))}
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
  addBtn: { background:'#1a73e8', color:'#fff', border:'none',
            padding:'12px 24px', borderRadius:'8px', fontSize:'1rem' },
  formCard: { background:'#fff', padding:'24px', borderRadius:'12px',
              boxShadow:'0 2px 10px rgba(0,0,0,0.08)',
              marginBottom:'24px' },
  formTitle: { color:'#222', marginBottom:'16px' },
  formGrid: { display:'grid', gridTemplateColumns:'1fr 1fr',
              gap:'12px', marginBottom:'16px' },
  input: { padding:'12px', border:'1px solid #ddd',
           borderRadius:'8px', fontSize:'1rem' },
  saveBtn: { background:'#34a853', color:'#fff', border:'none',
             padding:'12px 28px', borderRadius:'8px', fontSize:'1rem' },
  grid: { display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))',
          gap:'16px' },
  card: { background:'#fff', padding:'20px', borderRadius:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.07)' },
  cardHeader: { display:'flex', justifyContent:'space-between',
                alignItems:'center', marginBottom:'10px' },
  exName: { color:'#222' },
  diffBadge: { padding:'4px 12px', borderRadius:'20px',
               fontSize:'0.8rem', fontWeight:'bold' },
  desc: { color:'#666', fontSize:'0.9rem', marginBottom:'12px' },
  joints: { display:'flex', gap:'6px', flexWrap:'wrap' },
  joint: { background:'#e8f0fe', color:'#1a73e8', padding:'4px 10px',
           borderRadius:'20px', fontSize:'0.8rem' }
};