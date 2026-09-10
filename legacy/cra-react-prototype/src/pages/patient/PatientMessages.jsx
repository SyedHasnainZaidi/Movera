import { useEffect, useState } from 'react';
import api from '../../api/axiosInstance';

export default function PatientMessages() {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    api.get('/messages')
      .then(r => setMessages(r.data || []))
      .catch(() => {
        // demo data if backend not ready
        setMessages([
          { text:'Hello! How are you feeling today?',
            from:'therapist', createdAt: new Date() },
          { text:'I am doing better, thank you!',
            from:'me', createdAt: new Date() },
          { text:'Great! Make sure to complete your squats today.',
            from:'therapist', createdAt: new Date() },
        ]);
      });
  }, []);

  const send = async () => {
    if (!text.trim()) return;
    await api.post('/messages', { text }).catch(() => {});
    setMessages([...messages,
      { text, from:'me', createdAt: new Date() }]);
    setText('');
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') send();
  };

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Messages 💬</h2>
      <p style={styles.sub}>Chat with your therapist</p>

      <div style={styles.chatBox}>
        {messages.map((m, i) => (
          <div key={i} style={{
            ...styles.msgWrap,
            justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start'
          }}>
            {m.from !== 'me' && (
              <div style={styles.avatarSmall}>T</div>
            )}
            <div style={{
              ...styles.msg,
              background: m.from === 'me' ? '#1a73e8' : '#f0f4ff',
              color: m.from === 'me' ? '#fff' : '#222',
              borderRadius: m.from === 'me'
                ? '18px 18px 4px 18px'
                : '18px 18px 18px 4px'
            }}>
              {m.text}
              <div style={{
                ...styles.time,
                color: m.from === 'me'
                  ? 'rgba(255,255,255,0.7)' : '#aaa'
              }}>
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour:'2-digit', minute:'2-digit'
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={styles.inputRow}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message..."
          style={styles.input}
        />
        <button onClick={send} style={styles.btn}>Send ➤</button>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888', marginBottom:'20px' },
  chatBox: { background:'#fff', borderRadius:'12px', padding:'20px',
             height:'420px', overflowY:'auto',
             display:'flex', flexDirection:'column', gap:'12px',
             marginBottom:'16px',
             boxShadow:'0 2px 10px rgba(0,0,0,0.08)' },
  msgWrap: { display:'flex', alignItems:'flex-end', gap:'8px' },
  avatarSmall: { width:'32px', height:'32px', borderRadius:'50%',
                 background:'#34a853', color:'#fff', display:'flex',
                 alignItems:'center', justifyContent:'center',
                 fontSize:'0.85rem', flexShrink:0 },
  msg: { padding:'10px 16px', maxWidth:'60%' },
  time: { fontSize:'0.75rem', marginTop:'4px', textAlign:'right' },
  inputRow: { display:'flex', gap:'10px' },
  input: { flex:1, padding:'14px', border:'1px solid #ddd',
           borderRadius:'8px', fontSize:'1rem' },
  btn: { background:'#1a73e8', color:'#fff', border:'none',
         padding:'14px 24px', borderRadius:'8px', fontSize:'1rem' }
};