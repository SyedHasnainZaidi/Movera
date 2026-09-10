import { useEffect, useState } from 'react';
import api from '../../api/axiosInstance';

export default function TherapistMessages() {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    api.get('/therapist/patients')
      .then(r => setPatients(r.data || []))
      .catch(() => {
        setPatients([
          { _id:'1', name:'Ahmed Khan' },
          { _id:'2', name:'Sara Ali' },
          { _id:'3', name:'Usman Malik' },
        ]);
      });
  }, []);

  const selectPatient = (patient) => {
    setSelected(patient);
    api.get(`/messages/${patient._id}`)
      .then(r => setMessages(r.data || []))
      .catch(() => {
        setMessages([
          { text:'Hello doctor, my knee hurts after squats.',
            from:'patient', createdAt: new Date() },
          { text:'Try reducing the depth of your squat for now.',
            from:'me', createdAt: new Date() },
        ]);
      });
  };

  const send = async () => {
    if (!text.trim() || !selected) return;
    await api.post('/messages', {
      text, patientId: selected._id
    }).catch(() => {});
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
      <p style={styles.sub}>Chat with your patients</p>

      <div style={styles.layout}>
        {/* Patient List Sidebar */}
        <div style={styles.sidebar}>
          <h4 style={styles.sidebarTitle}>Patients</h4>
          {patients.map(p => (
            <div
              key={p._id}
              onClick={() => selectPatient(p)}
              style={{
                ...styles.patientItem,
                background: selected?._id === p._id
                  ? '#e8f0fe' : '#fff',
                borderLeft: selected?._id === p._id
                  ? '3px solid #1a73e8' : '3px solid transparent'
              }}>
              <div style={styles.patAvatar}>
                {p.name?.[0]?.toUpperCase()}
              </div>
              <span style={styles.patName}>{p.name}</span>
            </div>
          ))}
        </div>

        {/* Chat Area */}
        <div style={styles.chatArea}>
          {!selected ? (
            <div style={styles.noChat}>
              <p>👈 Select a patient to start messaging</p>
            </div>
          ) : (
            <>
              <div style={styles.chatHeader}>
                <div style={styles.patAvatar}>
                  {selected.name?.[0]?.toUpperCase()}
                </div>
                <strong>{selected.name}</strong>
              </div>

              <div style={styles.chatBox}>
                {messages.map((m, i) => (
                  <div key={i} style={{
                    ...styles.msgWrap,
                    justifyContent: m.from === 'me'
                      ? 'flex-end' : 'flex-start'
                  }}>
                    <div style={{
                      ...styles.msg,
                      background: m.from === 'me'
                        ? '#1a73e8' : '#f0f4ff',
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
                <button onClick={send} style={styles.btn}>
                  Send ➤
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'32px' },
  title: { fontSize:'1.6rem', color:'#222', marginBottom:'6px' },
  sub: { color:'#888', marginBottom:'24px' },
  layout: { display:'flex', gap:'20px', height:'560px' },
  sidebar: { width:'240px', background:'#fff', borderRadius:'12px',
             boxShadow:'0 2px 10px rgba(0,0,0,0.07)',
             overflow:'auto', flexShrink:0 },
  sidebarTitle: { padding:'16px', color:'#888',
                  fontSize:'0.85rem', textTransform:'uppercase',
                  borderBottom:'1px solid #eee' },
  patientItem: { display:'flex', alignItems:'center', gap:'10px',
                 padding:'14px 16px', cursor:'pointer',
                 transition:'all 0.2s' },
  patAvatar: { width:'36px', height:'36px', borderRadius:'50%',
               background:'#e8f0fe', color:'#1a73e8', display:'flex',
               alignItems:'center', justifyContent:'center',
               fontWeight:'bold', flexShrink:0 },
  patName: { color:'#222', fontSize:'0.95rem' },
  chatArea: { flex:1, background:'#fff', borderRadius:'12px',
              boxShadow:'0 2px 10px rgba(0,0,0,0.07)',
              display:'flex', flexDirection:'column', overflow:'hidden' },
  noChat: { display:'flex', alignItems:'center',
            justifyContent:'center', height:'100%', color:'#888' },
  chatHeader: { display:'flex', alignItems:'center', gap:'12px',
                padding:'16px 20px', borderBottom:'1px solid #eee' },
  chatBox: { flex:1, overflowY:'auto', padding:'20px',
             display:'flex', flexDirection:'column', gap:'12px' },
  msgWrap: { display:'flex' },
  msg: { padding:'10px 16px', maxWidth:'60%' },
  time: { fontSize:'0.75rem', marginTop:'4px', textAlign:'right' },
  inputRow: { display:'flex', gap:'10px', padding:'16px',
              borderTop:'1px solid #eee' },
  input: { flex:1, padding:'12px', border:'1px solid #ddd',
           borderRadius:'8px', fontSize:'1rem' },
  btn: { background:'#1a73e8', color:'#fff', border:'none',
         padding:'12px 20px', borderRadius:'8px' }
};