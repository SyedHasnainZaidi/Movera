import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={styles.wrap}>
      <h1 style={styles.code}>404</h1>
      <h2 style={styles.msg}>Oops! Page not found</h2>
      <p style={styles.sub}>The page you're looking for doesn't exist.</p>
      <Link to="/" style={styles.btn}>← Go Home</Link>
    </div>
  );
}

const styles = {
  wrap: { textAlign:'center', padding:'100px 20px' },
  code: { fontSize:'6rem', color:'#1a73e8', fontWeight:'bold' },
  msg: { fontSize:'1.8rem', color:'#333', marginBottom:'12px' },
  sub: { color:'#888', marginBottom:'32px' },
  btn: { background:'#1a73e8', color:'#fff', padding:'12px 32px',
         borderRadius:'8px', fontSize:'1rem' }
};