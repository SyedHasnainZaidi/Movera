import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div style={styles.wrap}>

      {/* Hero Section */}
      <div style={styles.hero}>
        <div style={styles.heroLeft}>
          <div style={styles.badge}>🏥 AI-Powered Physiotherapy</div>
          <h1 style={styles.heroTitle}>
            Smart Rehab.<br />
            <span style={styles.highlight}>Smarter Recovery.</span>
          </h1>
          <p style={styles.heroSub}>
            Movera uses real-time pose detection and AI to guide
            your physiotherapy exercises, track your progress,
            and connect you with your therapist — all from your browser.
          </p>
          <div style={styles.heroBtns}>
            <Link to="/signup" style={styles.primaryBtn}>
              Get Started Free →
            </Link>
            <Link to="/login" style={styles.secondaryBtn}>
              Login
            </Link>
          </div>
          <div style={styles.stats}>
            <div style={styles.stat}>
              <strong>500+</strong>
              <span>Patients</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <strong>50+</strong>
              <span>Therapists</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <strong>95%</strong>
              <span>Accuracy</span>
            </div>
          </div>
        </div>

        <div style={styles.heroRight}>
          <div style={styles.heroCard}>
            <div style={styles.heroCardHeader}>
              <div style={styles.dot1} />
              <div style={styles.dot2} />
              <div style={styles.dot3} />
            </div>
            <div style={styles.skeletonUI}>
              <div style={styles.camBox}>
                <div style={styles.camIcon}>📷</div>
                <p style={styles.camText}>Live Pose Detection</p>
                <div style={styles.skeleton1} />
                <div style={styles.skeleton2} />
              </div>
              <div style={styles.sideInfo}>
                <div style={styles.repCard}>
                  <span style={styles.repNum}>12</span>
                  <span style={styles.repLabel}>Reps Done</span>
                </div>
                <div style={styles.accuracyCard}>
                  <span style={styles.accNum}>86%</span>
                  <span style={styles.accLabel}>Accuracy</span>
                </div>
                <div style={styles.feedbackCard}>
                  ✅ Great form!
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div style={styles.features}>
        <h2 style={styles.featTitle}>
          Everything you need for recovery
        </h2>
        <p style={styles.featSub}>
          Movera combines AI technology with physiotherapy
          to deliver a complete rehabilitation experience
        </p>
        <div style={styles.featGrid}>
          {[
            { icon:'📷', title:'Real-Time Pose Detection',
              desc:'MediaPipe AI tracks your body movements instantly through your camera with sub-50ms feedback.' },
            { icon:'🔁', title:'Auto Rep Counting',
              desc:'Automatically counts exercise repetitions and detects incorrect form to prevent injuries.' },
            { icon:'📈', title:'Progress Tracking',
              desc:'Beautiful charts show your recovery journey week by week with detailed analytics.' },
            { icon:'💬', title:'Therapist Connection',
              desc:'Direct messaging and exercise assignment between patients and physiotherapists.' },
            { icon:'🏥', title:'Exercise Library',
              desc:'Curated physiotherapy exercises with reference angles and difficulty levels.' },
            { icon:'🔔', title:'Smart Notifications',
              desc:'Get reminders for sessions, feedback from therapists, and progress milestones.' },
          ].map((f, i) => (
            <div key={i} style={styles.featCard}>
              <div style={styles.featIcon}>{f.icon}</div>
              <h3 style={styles.featCardTitle}>{f.title}</h3>
              <p style={styles.featCardDesc}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div style={styles.howItWorks}>
        <h2 style={styles.featTitle}>How Movera Works</h2>
        <div style={styles.steps}>
          {[
            { step:'01', title:'Sign Up', desc:'Create your account as a patient or therapist in seconds.' },
            { step:'02', title:'Get Your Plan', desc:'Your therapist assigns personalized exercises to your account.' },
            { step:'03', title:'Exercise with AI', desc:'Open your camera and let Movera guide you in real time.' },
            { step:'04', title:'Track Progress', desc:'See your improvement through detailed weekly reports.' },
          ].map((s, i) => (
            <div key={i} style={styles.step}>
              <div style={styles.stepNum}>{s.step}</div>
              <h3 style={styles.stepTitle}>{s.title}</h3>
              <p style={styles.stepDesc}>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div style={styles.cta}>
        <h2 style={styles.ctaTitle}>
          Ready to start your recovery?
        </h2>
        <p style={styles.ctaSub}>
          Join Movera today and experience AI-powered physiotherapy
        </p>
        <Link to="/signup" style={styles.ctaBtn}>
          Get Started Free →
        </Link>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <p>© 2025 Movera. AI-Powered Physiotherapy Platform.</p>
      </div>
    </div>
  );
}

const styles = {
  wrap: { minHeight:'100vh', background:'#f8faff' },

  // Hero
  hero: { display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'80px 80px', gap:'60px', background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          minHeight:'90vh', flexWrap:'wrap' },
  heroLeft: { flex:1, minWidth:'300px' },
  badge: { display:'inline-block', background:'rgba(255,255,255,0.2)',
           color:'#fff', padding:'8px 20px', borderRadius:'50px',
           fontSize:'0.85rem', marginBottom:'24px', backdropFilter:'blur(10px)' },
  heroTitle: { fontSize:'3.2rem', fontWeight:'700', color:'#fff',
               lineHeight:'1.2', marginBottom:'20px' },
  highlight: { color:'#ffd700' },
  heroSub: { fontSize:'1.1rem', color:'rgba(255,255,255,0.85)',
             lineHeight:'1.7', marginBottom:'36px', maxWidth:'480px' },
  heroBtns: { display:'flex', gap:'16px', marginBottom:'48px', flexWrap:'wrap' },
  primaryBtn: { background:'#fff', color:'#667eea', padding:'16px 32px',
                borderRadius:'12px', fontWeight:'600', fontSize:'1rem',
                boxShadow:'0 4px 20px rgba(0,0,0,0.15)' },
  secondaryBtn: { background:'rgba(255,255,255,0.15)', color:'#fff',
                  padding:'16px 32px', borderRadius:'12px', fontWeight:'600',
                  fontSize:'1rem', border:'2px solid rgba(255,255,255,0.4)',
                  backdropFilter:'blur(10px)' },
  stats: { display:'flex', alignItems:'center', gap:'24px' },
  stat: { display:'flex', flexDirection:'column', color:'#fff' },
  statDivider: { width:'1px', height:'40px', background:'rgba(255,255,255,0.3)' },

  // Hero Card
  heroRight: { flex:1, minWidth:'300px', display:'flex', justifyContent:'center' },
  heroCard: { background:'#fff', borderRadius:'20px', padding:'20px',
              width:'100%', maxWidth:'420px',
              boxShadow:'0 20px 60px rgba(0,0,0,0.2)' },
  heroCardHeader: { display:'flex', gap:'8px', marginBottom:'16px' },
  dot1: { width:'12px', height:'12px', borderRadius:'50%', background:'#ff5f57' },
  dot2: { width:'12px', height:'12px', borderRadius:'50%', background:'#ffbd2e' },
  dot3: { width:'12px', height:'12px', borderRadius:'50%', background:'#28ca41' },
  skeletonUI: { display:'flex', gap:'12px' },
  camBox: { flex:2, background:'#f0f4ff', borderRadius:'12px',
            padding:'20px', textAlign:'center' },
  camIcon: { fontSize:'2.5rem', marginBottom:'8px' },
  camText: { color:'#667eea', fontWeight:'600', fontSize:'0.9rem',
             marginBottom:'12px' },
  skeleton1: { height:'8px', background:'#dde3ff', borderRadius:'4px',
               marginBottom:'8px' },
  skeleton2: { height:'8px', background:'#dde3ff', borderRadius:'4px', width:'70%',
               margin:'0 auto' },
  sideInfo: { flex:1, display:'flex', flexDirection:'column', gap:'10px' },
  repCard: { background:'#667eea', borderRadius:'10px', padding:'12px',
             textAlign:'center', display:'flex', flexDirection:'column' },
  repNum: { color:'#fff', fontSize:'1.6rem', fontWeight:'700' },
  repLabel: { color:'rgba(255,255,255,0.8)', fontSize:'0.75rem' },
  accuracyCard: { background:'#f0fdf4', borderRadius:'10px', padding:'12px',
                  textAlign:'center', display:'flex', flexDirection:'column',
                  border:'2px solid #86efac' },
  accNum: { color:'#16a34a', fontSize:'1.6rem', fontWeight:'700' },
  accLabel: { color:'#16a34a', fontSize:'0.75rem' },
  feedbackCard: { background:'#fefce8', borderRadius:'10px', padding:'10px',
                  textAlign:'center', fontSize:'0.85rem', color:'#854d0e',
                  border:'2px solid #fde047' },

  // Features
  features: { padding:'80px', background:'#fff' },
  featTitle: { fontSize:'2rem', fontWeight:'700', textAlign:'center',
               color:'#1a202c', marginBottom:'12px' },
  featSub: { textAlign:'center', color:'#718096', marginBottom:'48px',
             fontSize:'1.05rem', maxWidth:'500px', margin:'0 auto 48px' },
  featGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))',
              gap:'24px' },
  featCard: { background:'#f8faff', padding:'28px', borderRadius:'16px',
              border:'1px solid #e2e8f0', transition:'all 0.2s' },
  featIcon: { fontSize:'2rem', marginBottom:'16px' },
  featCardTitle: { fontSize:'1.05rem', fontWeight:'600', color:'#1a202c',
                   marginBottom:'10px' },
  featCardDesc: { color:'#718096', lineHeight:'1.6', fontSize:'0.95rem' },

  // How it works
  howItWorks: { padding:'80px', background:'#f8faff' },
  steps: { display:'flex', gap:'24px', marginTop:'48px', flexWrap:'wrap' },
  step: { flex:1, minWidth:'200px', textAlign:'center' },
  stepNum: { fontSize:'3rem', fontWeight:'700', color:'#667eea',
             marginBottom:'16px' },
  stepTitle: { fontSize:'1.1rem', fontWeight:'600', color:'#1a202c',
               marginBottom:'10px' },
  stepDesc: { color:'#718096', lineHeight:'1.6', fontSize:'0.95rem' },

  // CTA
  cta: { padding:'80px', background:'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
         textAlign:'center' },
  ctaTitle: { fontSize:'2.2rem', fontWeight:'700', color:'#fff', marginBottom:'16px' },
  ctaSub: { color:'rgba(255,255,255,0.85)', fontSize:'1.05rem', marginBottom:'36px' },
  ctaBtn: { display:'inline-block', background:'#fff', color:'#667eea',
            padding:'16px 40px', borderRadius:'12px', fontWeight:'600',
            fontSize:'1.05rem', boxShadow:'0 4px 20px rgba(0,0,0,0.15)' },

  // Footer
  footer: { padding:'24px', textAlign:'center', color:'#718096',
            background:'#1a202c', fontSize:'0.9rem',
            color:'rgba(255,255,255,0.5)' }
};