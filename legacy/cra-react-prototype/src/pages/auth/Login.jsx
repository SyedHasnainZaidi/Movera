import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axiosInstance';

export default function Login() {
  const [form, setForm] = useState({ email:'', password:'' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if (!form.email || !form.password) {
      setError('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/login', form);
      login(res.data.token);
      const role = res.data.role;
      navigate(role === 'patient'
        ? '/patient/dashboard'
        : '/therapist/dashboard');
    } catch {
      setError('Invalid email or password. Please try again.');
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
            Your recovery journey starts here
          </h2>
          <p style={styles.leftSub}>
            AI-powered physiotherapy that tracks your movements,
            counts your reps, and keeps your therapist in the loop.
          </p>
          <div style={styles.features}>
            {[
              '📷 Real-time pose detection',
              '🔁 Automatic rep counting',
              '📈 Weekly progress reports',
              '💬 Direct therapist messaging',
            ].map((f, i) => (
              <div key={i} style={styles.feature}>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div style={styles.right}>
        <div style={styles.card}>
          <h2 style={styles.title}>Welcome back 👋</h2>
          <p style={styles.sub}>Login to your Movera account</p>

          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          <div style={styles.field}>
            <label style={styles.label}>Email Address</label>
            <input
              placeholder="you@example.com"
              style={styles.input}
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              onKeyDown={handleKey}
            />
          </div>

          <div style={styles.field}>
            <div style={styles.labelRow}>
              <label style={styles.label}>Password</label>
              <Link to="/forgot-password" style={styles.forgot}>
                Forgot password?
              </Link>
            </div>
            <input
              placeholder="••••••••"
              type="password"
              style={styles.input}
              value={form.password}
              onChange={e =>
                setForm({...form, password: e.target.value})}
              onKeyDown={handleKey}
            />
          </div>

          <button
            onClick={handleSubmit}
            style={{
              ...styles.btn,
              opacity: loading ? 0.7 : 1
            }}>
            {loading ? 'Logging in...' : 'Login →'}
          </button>

          <div style={styles.divider}>
            <div style={styles.dividerLine} />
            <span style={styles.dividerText}>or</span>
            <div style={styles.dividerLine} />
          </div>

          <p style={styles.link}>
            Don't have an account?{' '}
            <Link to="/signup" style={styles.a}>
              Sign up free
            </Link>
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
          padding:'60px', display:'flex' },
  leftContent: { maxWidth:'420px' },
  brand: { fontSize:'1.8rem', fontWeight:'700', color:'#fff',
           marginBottom:'40px' },
  leftTitle: { fontSize:'2rem', fontWeight:'700', color:'#fff',
               lineHeight:'1.3', marginBottom:'16px' },
  leftSub: { color:'rgba(255,255,255,0.8)', lineHeight:'1.7',
             marginBottom:'36px', fontSize:'1rem' },
  features: { display:'flex', flexDirection:'column', gap:'12px' },
  feature: { display:'flex', alignItems:'center', gap:'12px',
             color:'rgba(255,255,255,0.9)', fontSize:'0.95rem',
             background:'rgba(255,255,255,0.1)', padding:'12px 16px',
             borderRadius:'10px', backdropFilter:'blur(10px)' },

  // Right
  right: { flex:1, display:'flex', alignItems:'center',
           justifyContent:'center', padding:'40px',
           background:'#f8faff' },
  card: { background:'#fff', padding:'48px', borderRadius:'20px',
          width:'100%', maxWidth:'420px',
          boxShadow:'0 4px 24px rgba(0,0,0,0.08)',
          display:'flex', flexDirection:'column', gap:'20px' },
  title: { fontSize:'1.6rem', fontWeight:'700', color:'#1a202c' },
  sub: { color:'#718096', marginTop:'-12px', fontSize:'0.95rem' },
  errorBox: { background:'#fff5f5', border:'1px solid #fed7d7',
              color:'#c53030', padding:'12px 16px', borderRadius:'10px',
              fontSize:'0.9rem' },
  field: { display:'flex', flexDirection:'column', gap:'8px' },
  label: { fontSize:'0.9rem', fontWeight:'500', color:'#4a5568' },
  labelRow: { display:'flex', justifyContent:'space-between',
              alignItems:'center' },
  forgot: { fontSize:'0.85rem', color:'#667eea', fontWeight:'500' },
  input: { padding:'14px 16px', border:'2px solid #e2e8f0',
           borderRadius:'10px', fontSize:'1rem', outline:'none',
           transition:'border 0.2s' },
  btn: { background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
         color:'#fff', padding:'14px', borderRadius:'10px',
         fontSize:'1rem', fontWeight:'600', border:'none',
         boxShadow:'0 4px 15px rgba(102,126,234,0.4)' },
  divider: { display:'flex', alignItems:'center', gap:'12px' },
  dividerLine: { flex:1, height:'1px', background:'#e2e8f0' },
  dividerText: { color:'#a0aec0', fontSize:'0.85rem' },
  link: { textAlign:'center', color:'#718096', fontSize:'0.95rem' },
  a: { color:'#667eea', fontWeight:'600' }
};