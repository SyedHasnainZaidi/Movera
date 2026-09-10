const User = require('../models/User');
const Exercise = require('../models/Exercise');
const Assignment = require('../models/Assignment');
const Session = require('../models/Session');
const Notification = require('../models/Notification');
const connectDB = require('../config/db');

const seedData = async (isStandalone = true) => {
  try {
    if (isStandalone) {
      await connectDB();
    }

    const userCount = await User.countDocuments();
    if (userCount > 0 && !isStandalone) {
      console.log('Database already populated. Skipping auto-seed.');
      return;
    }

    console.log('Clearing existing database collections...');
    await User.deleteMany();
    await Exercise.deleteMany();
    await Assignment.deleteMany();
    await Session.deleteMany();
    await Notification.deleteMany();

    console.log('Creating default users...');
    const admin = await User.create({
      name: 'System Admin',
      email: 'admin@physio.com',
      password: 'admin123password',
      role: 'admin',
    });

    const therapist = await User.create({
      name: 'Dr. Sarah Connor',
      email: 'therapist@physio.com',
      password: 'therapist123password',
      role: 'therapist',
      phone: '+1 555-0199',
    });

    const patient = await User.create({
      name: 'John Doe',
      email: 'patient@physio.com',
      password: 'patient123password',
      role: 'patient',
      therapistId: therapist._id,
      condition: 'Knee ACL Rehab',
      phone: '+1 555-0144',
    });

    console.log('Creating exercise catalog...');
    const exercises = await Exercise.insertMany([
      {
        name: 'Bodyweight Squat',
        category: 'Lower Body',
        description: 'Stand with feet shoulder-width apart and lower your hips as if sitting.',
        targetJoints: ['Hip', 'Knee', 'Ankle'],
        targetAngleMin: 60,
        targetAngleMax: 90,
        difficulty: 'Medium',
        instructions: 'Keep your back straight and ensure knees do not pass beyond your toes.',
      },
      {
        name: 'Shoulder Press',
        category: 'Upper Body',
        description: 'Raise arm upwards above shoulder level to stretch the rotator cuff.',
        targetJoints: ['Shoulder', 'Elbow'],
        targetAngleMin: 150,
        targetAngleMax: 180,
        difficulty: 'Easy',
        instructions: 'Controlled upward extension and slow return.',
      },
      {
        name: 'Knee Extension',
        category: 'Lower Body',
        description: 'Seated leg raise extending the knee joint fully.',
        targetJoints: ['Knee'],
        targetAngleMin: 160,
        targetAngleMax: 180,
        difficulty: 'Easy',
        instructions: 'Pause for 2 seconds at full extension.',
      },
    ]);

    console.log('Creating exercise assignments...');
    await Assignment.create({
      patientId: patient._id,
      therapistId: therapist._id,
      exerciseId: exercises[0]._id,
      targetReps: 15,
      sets: 3,
      frequency: 'Daily',
    });

    console.log('Creating demo exercise sessions...');
    await Session.create([
      {
        patientId: patient._id,
        exerciseId: exercises[0]._id,
        repsDone: 15,
        accuracy: 92,
        errors: [],
        durationSeconds: 140,
      },
      {
        patientId: patient._id,
        exerciseId: exercises[0]._id,
        repsDone: 12,
        accuracy: 85,
        errors: ['Too deep squat on rep 8'],
        durationSeconds: 120,
      },
    ]);

    console.log('Creating demo notifications...');
    await Notification.create({
      userId: patient._id,
      title: 'New Routine Assigned',
      message: 'Dr. Sarah assigned Bodyweight Squat (3 sets x 15 reps).',
      type: 'info',
    });

    console.log('--------------------------------------------');
    console.log('Seed process completed successfully! 🎉');
    console.log('Test Accounts Created:');
    console.log(' 👑 Admin:     admin@physio.com     / admin123password');
    console.log(' 🩺 Therapist: therapist@physio.com / therapist123password');
    console.log(' 🏋️ Patient:   patient@physio.com   / patient123password');
    console.log('--------------------------------------------');

    if (isStandalone) {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error during database seed:', error);
    if (isStandalone) {
      process.exit(1);
    }
  }
};

if (require.main === module) {
  seedData(true);
}

module.exports = seedData;
