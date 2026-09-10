import { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axiosInstance';

export default function ExerciseSession() {
  const { exerciseId } = useParams();
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const [reps, setReps] = useState(0);
  const [feedback, setFeedback] = useState('Get into position...');
  const [sessionDone, setSessionDone] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const repCountRef = useRef(0);
  const positionRef = useRef('up');
  const navigate = useNavigate();

  useEffect(() => {
    let camera;

    async function loadPose() {
      try {
        const { Pose } = await import('@mediapipe/pose');
        const { Camera } = await import('@mediapipe/camera_utils');

        const pose = new Pose({
          locateFile: f =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`
        });

        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        pose.onResults(onResults);
        setIsLoading(false);

        if (webcamRef.current?.video) {
          camera = new Camera(webcamRef.current.video, {
            onFrame: async () => {
              await pose.send({ image: webcamRef.current.video });
            },
            width: 640,
            height: 480
          });
          camera.start();
        }
      } catch (err) {
        setFeedback('Error loading pose model. Check internet connection.');
        setIsLoading(false);
      }
    }

    loadPose();
    return () => { if (camera) camera.stop(); };
  }, []);

  function getAngle(a, b, c) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) -
      Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
  }

  function onResults(results) {
    if (!results.poseLandmarks) return;
    const lm = results.poseLandmarks;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw dots on joints
    lm.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#1a73e8';
      ctx.fill();
    });

    // Draw connections between key joints
    const connections = [
      [11,12],[11,13],[13,15],[12,14],[14,16],
      [11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]
    ];
    connections.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
      ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
      ctx.strokeStyle = '#34a853';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Count squats using knee angle
    const hip = lm[23];
    const knee = lm[25];
    const ankle = lm[27];
    const angle = getAngle(hip, knee, ankle);

    if (angle < 90 && positionRef.current === 'up') {
      positionRef.current = 'down';
      setFeedback('Good! Now stand up ⬆');
    } else if (angle > 160 && positionRef.current === 'down') {
      positionRef.current = 'up';
      repCountRef.current += 1;
      setReps(repCountRef.current);
      setFeedback(`Rep ${repCountRef.current} counted! Go down again ⬇`);
    }

    if (angle < 60) setFeedback('⚠️ Too deep! Ease up a bit.');
  }

  const finishSession = async () => {
    await api.post('/session', {
      exerciseId,
      repsDone: repCountRef.current,
      accuracy: 80,
      errors: []
    }).catch(() => {});
    setSessionDone(true);
  };

  if (sessionDone) return (
    <div style={styles.done}>
      <h2>Session Complete! 🎉</h2>
      <p style={styles.doneSub}>Great work today!</p>
      <div style={styles.doneStats}>
        <div style={styles.doneStat}>
          <h3>{reps}</h3>
          <p>Reps Completed</p>
        </div>
        <div style={styles.doneStat}>
          <h3>80%</h3>
          <p>Accuracy</p>
        </div>
      </div>
      <button onClick={() => navigate('/patient/dashboard')} style={styles.doneBtn}>
        Back to Dashboard
      </button>
    </div>
  );

  return (
    <div style={styles.page}>
      <h2 style={styles.title}>Exercise Session 🏋️</h2>
      {isLoading && (
        <p style={styles.loading}>Loading pose detection model...</p>
      )}
      <div style={styles.camWrap}>
        <Webcam
          ref={webcamRef}
          style={styles.cam}
          mirrored
          width={640}
          height={480}
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={styles.canvas}
        />
      </div>
      <div style={styles.info}>
        <div style={styles.repBox}>
          🔁 Reps: <strong>{reps}</strong>
        </div>
        <div style={styles.feedback}>{feedback}</div>
        <button onClick={finishSession} style={styles.finishBtn}>
          Finish Session ✅
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: { padding:'24px', textAlign:'center' },
  title: { marginBottom:'16px', color:'#1a73e8' },
  loading: { color:'#888', marginBottom:'12px' },
  camWrap: { position:'relative', width:'640px', margin:'0 auto',
             borderRadius:'12px', overflow:'hidden' },
  cam: { width:'640px', height:'480px', display:'block' },
  canvas: { position:'absolute', top:0, left:0 },
  info: { marginTop:'20px' },
  repBox: { fontSize:'1.6rem', marginBottom:'12px' },
  feedback: { background:'#fff', display:'inline-block',
              padding:'12px 28px', borderRadius:'8px', margin:'8px',
              fontSize:'1.1rem', boxShadow:'0 2px 8px rgba(0,0,0,0.1)' },
  finishBtn: { display:'block', margin:'20px auto 0', background:'#34a853',
               color:'#fff', border:'none', padding:'14px 40px',
               borderRadius:'8px', fontSize:'1rem' },
  done: { textAlign:'center', padding:'80px 20px' },
  doneSub: { color:'#888', margin:'8px 0 32px' },
  doneStats: { display:'flex', gap:'24px', justifyContent:'center',
               marginBottom:'32px' },
  doneStat: { background:'#fff', padding:'24px 40px', borderRadius:'12px',
              boxShadow:'0 2px 10px rgba(0,0,0,0.08)' },
  doneBtn: { background:'#1a73e8', color:'#fff', border:'none',
             padding:'14px 32px', borderRadius:'8px', fontSize:'1rem' }
};