import { useState } from "react";
import api from "../../api/axiosInstance";

export default function ForgotPassword() {

  const [email,setEmail]=useState("");
  const [done,setDone]=useState(false);

  const submit=async()=>{

    if(!email) return;

    await api.post("/auth/forgot-password",{email})
      .catch(()=>{});

    setDone(true);
  }

  return(

    <div style={styles.page}>

      <div style={styles.card}>

        <h2>Forgot Password</h2>

        <p style={styles.sub}>
          Enter your registered email address.
        </p>

        {done?

        <>
        <div style={styles.success}>
          Password reset link sent successfully.
        </div>
        </>

        :

        <>

        <input

        style={styles.input}
        placeholder="Email"

        value={email}

        onChange={(e)=>setEmail(e.target.value)}

        />

        <button
        onClick={submit}
        style={styles.button}
        >
        Send Reset Link
        </button>

        </>
        }

      </div>

    </div>

  )

}

const styles={

page:{
display:"flex",
justifyContent:"center",
alignItems:"center",
height:"85vh"
},

card:{
width:"420px",
background:"#fff",
padding:"35px",
borderRadius:"12px",
boxShadow:"0 2px 10px rgba(0,0,0,.08)"
},

sub:{
marginTop:"10px",
marginBottom:"25px",
color:"#666"
},

input:{
width:"100%",
padding:"12px",
border:"1px solid #ddd",
borderRadius:"8px",
marginBottom:"18px"
},

button:{
width:"100%",
padding:"12px",
background:"#1a73e8",
color:"#fff",
border:"none",
borderRadius:"8px",
cursor:"pointer"
},

success:{
padding:"15px",
background:"#e8f5e9",
color:"#2e7d32",
borderRadius:"8px",
textAlign:"center"
}

}