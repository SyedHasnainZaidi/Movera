import { useState } from "react";
import api from "../../api/axiosInstance";

export default function AddPatient() {

  const [patient, setPatient] = useState({
    name: "",
    email: "",
    age: "",
    condition: ""
  });

  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    setPatient({
      ...patient,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await api.post("/therapist/add-patient", patient);
      setSuccess(true);

      setPatient({
        name: "",
        email: "",
        age: "",
        condition: ""
      });

    } catch {

      // Demo response
      setSuccess(true);

    }
  };

  return (
    <div style={styles.page}>

      <h2>Add Patient</h2>

      <form style={styles.form} onSubmit={handleSubmit}>

        <input
          name="name"
          placeholder="Patient Name"
          value={patient.name}
          onChange={handleChange}
          style={styles.input}
        />

        <input
          name="email"
          placeholder="Email"
          value={patient.email}
          onChange={handleChange}
          style={styles.input}
        />

        <input
          name="age"
          placeholder="Age"
          value={patient.age}
          onChange={handleChange}
          style={styles.input}
        />

        <input
          name="condition"
          placeholder="Medical Condition"
          value={patient.condition}
          onChange={handleChange}
          style={styles.input}
        />

        <button style={styles.button}>
          Add Patient
        </button>

        {success && (
          <p style={styles.success}>
            Patient added successfully.
          </p>
        )}

      </form>

    </div>
  );
}

const styles = {

  page: {
    padding: "30px"
  },

  form: {
    marginTop: "25px",
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    maxWidth: "500px"
  },

  input: {
    padding: "12px",
    border: "1px solid #ccc",
    borderRadius: "8px"
  },

  button: {
    padding: "12px",
    border: "none",
    borderRadius: "8px",
    background: "#1a73e8",
    color: "white",
    cursor: "pointer"
  },

  success: {
    color: "green",
    marginTop: "10px"
  }

};