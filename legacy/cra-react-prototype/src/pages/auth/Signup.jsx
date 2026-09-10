import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api/axiosInstance';

export default function Signup() {
  const [form, setForm] = useState({
    name:'', email:'', password:'', role:'patient'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.password) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/signup', form);
      navigate('/login');
    } catch {
      setError('Signup failed. Please try again.');
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div style={styles.wrap}>

      {/* Left Panel */}
      <div style={styles.left}>
        <div style={styles.leftContent}>
          <div style={styles.brand}>🦾 Movera</div>
          <h2 style={styles.leftTitle}>
            Join thousands recovering smarter
          </h2>
          <p style={styles.leftSub}>
            Whether you're a patient or a physiotherapist,
            Movera gives you the tools to make rehabilitation
            more effective and data-driven.
          </p>
          <div style={styles.roles}>
            <div style={styles.roleCard}>
              <span style={styles.roleIcon}>🧑‍⚕️</span>
              <div>
                <strong style={styles.roleTitle}>Patients</strong>
                <p style={styles.roleDesc}>
                  Get guided exercises with real-time AI feedback
                </p>
              </div>
            </div>
            <div style={styles.roleCard}>
              <span style={styles.roleIcon}>👨‍⚕️</span>
              <div>
                <strong style={styles.roleTitle}>Therapists</strong>
                <p style={styles.roleDesc}>
                  Manage patients and track their recovery remotely
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div style={styles.right}>
        <div style={styles.card}>
          <h2 style={styles.title}>Create your account 🎉</h2>
          <p style={styles.sub}>Join Movera today — it's free</p>

          {error && (
            <div style={styles.errorBox}>⚠️ {error}</div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Full Name</label>
            <input
              placeholder="John Doe"
              style={styles.input}
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              onKeyDown={handleKey}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Email Address</label>
            <input
              placeholder="you@example.com"
              style={styles.input}
              value={form.email}
              onChange={e =>
                setForm({...form, email: e.target.value})}
              onKeyDown={handleKey}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              placeholder="Min. 8 characters"
              type="password"
              style={styles.input}
              value={form.password}
              onChange={e =>
                setForm({...form, password: e.target.value})}
              onKeyDown={handleKey}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>I am a...</label>
            <div style={styles.roleToggle}>
              <button
                onClick={() => setForm({...form, role:'patient'})}
                style={{
                  ...styles.toggleBtn,
                  background: form.role === 'patient'
                    ? 'linear-gradient(135deg, #667eea, #764ba2)'
                    : '#f8faff',
                  color: form.role === 'patient' ? '#fff' : '#4a5568',
                  border: form.role === 'patient'
                    ? 'none' : '2px solid #e2e8f0'
                }}>
                🧑‍⚕️ Patient
              </button>
              <button
                onClick={() => setForm({...form, role:'therapist'})}
                style={{
                  ...styles.toggleBtn,
                  background: form.role === 'therapist'
                    ? 'linear-gradient(135deg, #667eea, #764ba2)'
                    : '#f8faff',
                  color: form.role === 'therapist' ? '#fff' : '#4a5568',
                  border: form.role === 'therapist'
                    ? 'none' : '2px solid #e2e8f0'
                }}>
                👨‍⚕️ Therapist
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            style={{
              ...styles.btn,
              opacity: loading ? 0.7 : 1
            }}>
            {loading ? 'Creating account...' : 'Create Account →'}
          </button>

          <p style={styles.terms}>
            By signing up, you agree to our{' '}
            <span style={styles.a}>Terms of Service</span>
            {' '}and{' '}
            <span style={styles.a}>Privacy Policy</span>
          </p>

          <div style={styles.divider}>
            <div style={styles.dividerLine} />
            <span style={styles.dividerText}>or</span>
            <div style={styles.dividerLine} />
          </div>

          <p style={styles.link}>
            Already have an account?{' '}
            <Link to="/login" style={styles.a}>Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { display:'flex', minHeight:'100vh' },

  // Left
  left: { flex:1, background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display:'flex', alignItems:'center', justifyContent:'center',
          padding:'60px' },
  leftContent: { maxWidth:'420px' },
  brand: { fontSize:'1.8rem', fontWeight:'700', color:'#fff',
           marginBottom:'40px' },
  leftTitle: { fontSize:'2rem', fontWeight:'700', color:'#fff',
               lineHeight:'1.3', marginBottom:'16px' },
  leftSub: { color:'rgba(255,255,255,0.8)', lineHeight:'1.7',
             marginBottom:'36px', fontSize:'1rem' },
  roles: { display:'flex', flexDirection:'column', gap:'16px' },
  roleCard: { display:'flex', alignItems:'center', gap:'16px',
              background:'rgba(255,255,255,0.15)', padding:'16px 20px',
              borderRadius:'12px', backdropFilter:'blur(10px)' },
  roleIcon: { fontSize:'2rem' },
  roleTitle: { color:'#fff', display:'block', marginBottom:'4px' },
  roleDesc: { color:'rgba(255,255,255,0.75)', fontSize:'0.85rem' },

  // Right
  right: { flex:1, display:'flex', alignItems:'center',
           justifyContent:'center', padding:'40px',
           background:'#f8faff', overflowY:'auto' },
  card: { background:'#fff', padding:'48px', borderRadius:'20px',
          width:'100%', maxWidth:'420px',
          boxShadow:'0 4px 24px rgba(0,0,0,0.08)',
          display:'flex', flexDirection:'column', gap:'18px' },
  title: { fontSize:'1.6rem', fontWeight:'700', color:'#1a202c' },
  sub: { color:'#718096', marginTop:'-10px', fontSize:'0.95rem' },
  errorBox: { background:'#fff5f5', border:'1px solid #fed7d7',
              color:'#c53030', padding:'12px 16px',
              borderRadius:'10px', fontSize:'0.9rem' },
  field: { display:'flex', flexDirection:'column', gap:'8px' },
  label: { fontSize:'0.9rem', fontWeight:'500', color:'#4a5568' },
  input: { padding:'14px 16px', border:'2px solid #e2e8f0',
           borderRadius:'10px', fontSize:'1rem' },
  roleToggle: { display:'flex', gap:'12px' },
  toggleBtn: { flex:1, padding:'12px', borderRadius:'10px',
               fontSize:'0.95rem', fontWeight:'500',
               cursor:'pointer', transition:'all 0.2s' },
  btn: { background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
         color:'#fff', padding:'14px', borderRadius:'10px',
         fontSize:'1rem', fontWeight:'600', border:'none',
         boxShadow:'0 4px 15px rgba(102,126,234,0.4)' },
  terms: { textAlign:'center', color:'#a0aec0', fontSize:'0.82rem' },
  divider: { display:'flex', alignItems:'center', gap:'12px' },
  dividerLine: { flex:1, height:'1px', background:'#e2e8f0' },
  dividerText: { color:'#a0aec0', fontSize:'0.85rem' },
  link: { textAlign:'center', color:'#718096', fontSize:'0.95rem' },
  a: { color:'#667eea', fontWeight:'600', cursor:'pointer' }
};