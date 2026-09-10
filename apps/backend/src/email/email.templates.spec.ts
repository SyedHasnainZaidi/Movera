import {
  exerciseAssignedEmail,
  passwordResetEmail,
  patientLinkedEmail,
  therapistLinkedEmail,
  verificationEmail,
} from './email.templates';

const APP = 'Movera';

describe('Email templates', () => {
  describe('subjects match the agreed wording', () => {
    it('verification', () => {
      const mail = verificationEmail({
        appName: APP,
        firstName: 'Ahmed',
        url: 'http://localhost:5173/verify-email?token=abc',
        expiresInHours: 24,
      });
      expect(mail.subject).toBe('Verify your email address - Movera');
    });

    it('password reset', () => {
      const mail = passwordResetEmail({
        appName: APP,
        firstName: 'Ahmed',
        url: 'http://localhost:5173/reset-password?token=abc',
        expiresInMinutes: 60,
      });
      expect(mail.subject).toBe('Reset your password - Movera');
    });

    it('patient side of a therapist link', () => {
      const mail = patientLinkedEmail({
        appName: APP,
        patientName: 'Ahmed Raza',
        therapistName: 'Ayesha Khan',
        url: 'http://localhost:5173/patient/exercises',
      });
      expect(mail.subject).toBe(
        'Successfully connected with your therapist - Movera',
      );
    });

    it('therapist side of a patient link', () => {
      const mail = therapistLinkedEmail({
        appName: APP,
        therapistName: 'Ayesha Khan',
        patientName: 'Ahmed Raza',
        url: 'http://localhost:5173/therapist/patients/abc',
      });
      expect(mail.subject).toBe('Patient successfully connected - Movera');
    });

    it('exercise assignment', () => {
      const mail = exerciseAssignedEmail({
        appName: APP,
        patientName: 'Ahmed Raza',
        therapistName: 'Ayesha Khan',
        exerciseName: 'Bicep Curl',
        dueDate: '2026-09-30',
        prescription: '3 sets of 12 repetitions',

        url: 'http://localhost:5173/patient/exercises',
      });
      expect(mail.subject).toBe('New exercise assigned on Movera');
    });
  });

  describe('content', () => {
    it('carries the link in BOTH the html and the plain text part', () => {
      const url = 'http://localhost:5173/verify-email?token=xyz123';
      const mail = verificationEmail({
        appName: APP,
        firstName: 'Ahmed',
        url,
        expiresInHours: 24,
      });

      // A client that refuses to render HTML must still be able to verify.
      expect(mail.text).toContain(url);
      expect(mail.html).toContain(url);
    });

    it('names the recipient and the other party in an assignment email', () => {
      const mail = exerciseAssignedEmail({
        appName: APP,
        patientName: 'Ahmed Raza',
        therapistName: 'Ayesha Khan',
        exerciseName: 'Bodyweight Squat',
        dueDate: '2026-09-30',
        prescription: '3 sets of 12 repetitions',

        url: 'http://localhost:5173/patient/exercises',
      });

      for (const part of [mail.text, mail.html]) {
        expect(part).toContain('Ahmed Raza');
        expect(part).toContain('Ayesha Khan');
        expect(part).toContain('Bodyweight Squat');
        expect(part).toContain('2026-09-30');
      }
      expect(mail.text).toContain('3 sets of 12 repetitions');
    });

    it('states a readable due date when the assignment is open-ended', () => {
      const mail = exerciseAssignedEmail({
        appName: APP,
        patientName: 'Ahmed Raza',
        therapistName: 'Ayesha Khan',
        exerciseName: 'Bicep Curl',
        dueDate: null,
        prescription: '2 sets of 10 repetitions',

        url: 'http://localhost:5173/patient/exercises',
      });
      expect(mail.text).toContain('No end date');
      expect(mail.text).not.toContain('null');
    });

    it('carries the expiry so the reader knows the link is time-limited', () => {
      const mail = passwordResetEmail({
        appName: APP,
        firstName: 'Ahmed',
        url: 'http://localhost:5173/reset-password?token=abc',
        expiresInMinutes: 45,
      });
      expect(mail.text).toContain('45 minutes');
      expect(mail.html).toContain('45 minutes');
    });

    it('carries Movera branding and the clinical disclaimer', () => {
      const mail = verificationEmail({
        appName: APP,
        firstName: 'Ahmed',
        url: 'http://x/y',
        expiresInHours: 24,
      });
      expect(mail.html).toContain('Movera');
      expect(mail.html).toContain('not a medical device');
    });
  });

  describe('escaping', () => {
    /**
     * Names, exercise titles and the product name are user- or config-supplied
     * and land inside HTML that a mail client renders. Without escaping, a
     * patient who registers as `<script>...` turns every notification email
     * into an injection vector.
     */
    it('escapes angle brackets in a patient name', () => {
      const mail = patientLinkedEmail({
        appName: APP,
        patientName: '<script>alert(1)</script>',
        therapistName: 'Ayesha Khan',
        url: 'http://localhost:5173/patient/exercises',
      });

      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&lt;script&gt;');
    });

    it('escapes quotes in an exercise name', () => {
      const mail = exerciseAssignedEmail({
        appName: APP,
        patientName: 'Ahmed',
        therapistName: 'Ayesha',
        exerciseName: 'The "Big" Squat',
        dueDate: null,
        prescription: '1 sets of 1 repetitions',

        url: 'http://localhost:5173/patient/exercises',
      });

      expect(mail.html).toContain('&quot;Big&quot;');
    });

    it('escapes an ampersand without double-escaping it', () => {
      const mail = therapistLinkedEmail({
        appName: APP,
        therapistName: 'Smith & Jones',
        patientName: 'Ahmed',
        url: 'http://localhost:5173/therapist/patients/abc',
      });

      expect(mail.html).toContain('Smith &amp; Jones');
      expect(mail.html).not.toContain('&amp;amp;');
    });

    it('leaves the plain-text part unescaped - it is not markup', () => {
      const mail = patientLinkedEmail({
        appName: APP,
        patientName: 'Smith & Jones',
        therapistName: 'Ayesha',
        url: 'http://x/y',
      });
      expect(mail.text).toContain('Smith & Jones');
    });
  });
});
