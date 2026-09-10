# AI Physiotherapy Platform - Express & MongoDB Backend

A production-grade, modular Node.js / Express / MongoDB backend architecture designed for the AI Physiotherapy & Tele-Rehabilitation web application.

---

## 🚀 Features

- **Authentication & Security**: JWT Authentication with `bcryptjs` password hashing.
- **Role-Based Access Control (RBAC)**: Supports `patient`, `therapist`, and `admin` permissions.
- **Real-Time Session Logging**: Endpoint `/api/session` receives webcam pose estimation rep counts and posture accuracy scores.
- **Therapist Management**: Patient list, exercise assignment, individual patient reports, and analytics.
- **Patient Portal**: Dashboard metrics, exercise plans, historical progress tracking, and notifications.
- **Admin Panel**: Complete user CRUD, role management, and overall system analytics.
- **Direct Messaging**: Intra-platform communication between patients and therapists.

---

## 📂 Project Architecture

```
backend/
├── config/             # DB connection logic
├── controllers/        # Route handling business logic
├── middleware/         # JWT Protection, Role RBAC, and Error Handlers
├── models/             # Mongoose Schemas (User, Exercise, Session, Assignment, Message, Notification)
├── routes/             # Express Routers
├── utils/              # Token generation and Seeder utility
├── .env.example        # Environment variable blueprint
├── server.js           # Main Express server entry point
└── package.json        # Dependencies and scripts
```

---

## 🛠️ Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16+ recommended)
- [MongoDB](https://www.mongodb.com/) running locally (`mongodb://127.0.0.1:27017/physiodb`) or a MongoDB Atlas URI.

### 2. Install Dependencies
Navigate to the `backend` directory and run:
```bash
npm install
```

### 3. Environment Setup
The `.env` file is already pre-configured for local development. Adjust `MONGO_URI` or `JWT_SECRET` if needed:
```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/physiodb
JWT_SECRET=supersecretphysiokey_2026_change_in_production
NODE_ENV=development
```

### 4. Seed Initial Data (Optional & Recommended)
Populate your database with default Admin, Therapist, Patient accounts, and sample exercise catalog:
```bash
npm run seed
```

**Default Test Credentials:**
- 👑 **Admin**: `admin@physio.com` / `admin123password`
- 🩺 **Therapist**: `therapist@physio.com` / `therapist123password`
- 🏋️ **Patient**: `patient@physio.com` / `patient123password`

### 5. Start Server
Run in development mode with `nodemon`:
```bash
npm run dev
```
Or run in standard production mode:
```bash
npm start
```

The server will start listening at `http://localhost:5000`.

---

## 🔌 API Endpoints Summary

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/signup` | Public | Register new user account |
| `POST` | `/api/auth/login` | Public | Authenticate user & get JWT token |
| `GET` | `/api/auth/profile` | Private | Get current user profile |
| `GET` | `/api/patient/dashboard` | Patient/Admin | Patient dashboard stats & active plans |
| `POST` | `/api/session` | Patient/Admin | Log real-time webcam pose exercise session |
| `GET` | `/api/patient/history` | Patient/Admin | Session history timeline |
| `GET` | `/api/therapist/patients` | Therapist/Admin | List therapist's assigned patients |
| `POST` | `/api/therapist/assign` | Therapist/Admin | Assign exercise routine to patient |
| `GET` | `/api/therapist/analytics` | Therapist/Admin | Compliance & patient aggregate stats |
| `GET` | `/api/admin/users` | Admin | List all registered platform users |
| `PUT` | `/api/admin/users/:id/role`| Admin | Elevate/change user role |
| `GET` | `/api/admin/stats` | Admin | High-level system statistics |
