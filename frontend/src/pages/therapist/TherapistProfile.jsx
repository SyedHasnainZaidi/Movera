import { useAuth } from '../../context/AuthContext';

export default function TherapistProfile() {
  const { user } = useAuth();

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Therapist Profile</h2>

      <div style={styles.card}>
        <div style={styles.avatar}>
          {user?.name?.[0]?.toUpperCase() || "T"}
        </div>

        <h3>{user?.name || "Dr. John Doe"}</h3>

        <p>
          <strong>Email:</strong>{" "}
          {user?.email || "doctor@example.com"}
        </p>

        <p>
          <strong>Role:</strong>{" "}
          {user?.role || "Therapist"}
        </p>

        <p>
          <strong>Department:</strong> Physiotherapy
        </p>

        <p>
          <strong>Experience:</strong> 5 Years
        </p>

        <button style={styles.btn}>
          Edit Profile
        </button>
      </div>
    </div>
  );
}

const styles = {
  page:{
    padding:'32px'
  },

  title:{
    marginBottom:'24px'
  },

  card:{
    width:'420px',
    background:'#fff',
    padding:'30px',
    borderRadius:'12px',
    boxShadow:'0 2px 10px rgba(0,0,0,0.08)',
    display:'flex',
    flexDirection:'column',
    gap:'14px'
  },

  avatar:{
    width:'90px',
    height:'90px',
    borderRadius:'50%',
    background:'#1a73e8',
    color:'#fff',
    display:'flex',
    alignItems:'center',
    justifyContent:'center',
    fontSize:'2rem',
    fontWeight:'bold'
  },

  btn:{
    marginTop:'10px',
    background:'#1a73e8',
    color:'#fff',
    border:'none',
    padding:'12px',
    borderRadius:'8px',
    cursor:'pointer'
  }
};