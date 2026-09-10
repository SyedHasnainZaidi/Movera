import { useEffect, useState } from "react";
import api from "../../api/axiosInstance";

export default function PatientNotifications() {

  const [notifications,setNotifications]=useState([]);

  useEffect(()=>{

    api.get("/notifications")
    .then(res=>setNotifications(res.data))
    .catch(()=>{

      setNotifications([

        {
          id:1,
          title:"Exercise Reminder",
          message:"Complete today's Knee Flexion exercise.",
          time:"10 mins ago"
        },

        {
          id:2,
          title:"Therapist Feedback",
          message:"Great improvement in your posture.",
          time:"2 hours ago"
        },

        {
          id:3,
          title:"Session Completed",
          message:"Your last exercise session was saved successfully.",
          time:"Yesterday"
        }

      ])

    })

  },[])

  return(

    <div style={styles.page}>

      <h2 style={styles.heading}>
        Notifications 🔔
      </h2>

      <div style={styles.container}>

        {notifications.map((item)=>(

          <div
          key={item.id}
          style={styles.card}
          >

            <h3>{item.title}</h3>

            <p style={styles.message}>
              {item.message}
            </p>

            <span style={styles.time}>
              {item.time}
            </span>

          </div>

        ))}

      </div>

    </div>

  )

}

const styles={

page:{
padding:"30px"
},

heading:{
marginBottom:"25px"
},

container:{
display:"flex",
flexDirection:"column",
gap:"15px"
},

card:{
background:"#fff",
padding:"20px",
borderRadius:"12px",
boxShadow:"0 2px 8px rgba(0,0,0,.08)"
},

message:{
marginTop:"10px",
marginBottom:"12px",
color:"#666"
},

time:{
fontSize:"13px",
color:"#999"
}

}