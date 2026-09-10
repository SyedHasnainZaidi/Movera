import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar
} from "recharts";

const recoveryData = [
  { week: "Week 1", accuracy: 62 },
  { week: "Week 2", accuracy: 70 },
  { week: "Week 3", accuracy: 81 },
  { week: "Week 4", accuracy: 90 }
];

const exerciseData = [
  { name: "Squats", sessions: 25 },
  { name: "Shoulder", sessions: 18 },
  { name: "Knee", sessions: 30 },
  { name: "Back", sessions: 14 }
];

export default function TherapistAnalytics() {

  return (

    <div style={styles.page}>

      <h2>Analytics Dashboard</h2>

      <div style={styles.cards}>

        <div style={styles.card}>
          <h3>Patients</h3>
          <h1>54</h1>
        </div>

        <div style={styles.card}>
          <h3>Exercises Assigned</h3>
          <h1>127</h1>
        </div>

        <div style={styles.card}>
          <h3>Average Accuracy</h3>
          <h1>86%</h1>
        </div>

      </div>

      <div style={styles.chartBox}>

        <h3>Recovery Progress</h3>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={recoveryData}>
            <CartesianGrid strokeDasharray="3 3"/>
            <XAxis dataKey="week"/>
            <YAxis/>
            <Tooltip/>
            <Line
              type="monotone"
              dataKey="accuracy"
              stroke="#1a73e8"
              strokeWidth={3}
            />
          </LineChart>
        </ResponsiveContainer>

      </div>

      <div style={styles.chartBox}>

        <h3>Exercise Sessions</h3>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={exerciseData}>
            <CartesianGrid strokeDasharray="3 3"/>
            <XAxis dataKey="name"/>
            <YAxis/>
            <Tooltip/>
            <Bar dataKey="sessions" fill="#34a853"/>
          </BarChart>
        </ResponsiveContainer>

      </div>

    </div>

  );

}

const styles={

page:{
padding:"30px"
},

cards:{
display:"flex",
gap:"20px",
margin:"25px 0"
},

card:{
flex:1,
background:"#fff",
padding:"20px",
borderRadius:"12px",
boxShadow:"0 2px 8px rgba(0,0,0,.08)"
},

chartBox:{
background:"#fff",
padding:"20px",
marginTop:"25px",
borderRadius:"12px",
boxShadow:"0 2px 8px rgba(0,0,0,.08)"
}

};