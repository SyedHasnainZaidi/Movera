/**
 * Movera email templates.
 *
 * Every message is built as BOTH HTML and plain text. Plain text is not a
 * courtesy: some clients refuse to render HTML, and a verification link the
 * recipient cannot reach is an account they cannot use.
 *
 * The markup is deliberately primitive - tables, inline styles, no external
 * CSS or images. Mail clients strip <style> blocks and block remote images by
 * default, so anything cleverer degrades badly in exactly the clients students
 * and supervisors actually use (Gmail web, Outlook).
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const BRAND = '#0f766e';
const INK = '#1f2937';
const MUTED = '#6b7280';

/**
 * Shared shell. `appName` is threaded through rather than hard-coded so the
 * product name lives in exactly one place (APP_NAME).
 */
function layout(options: {
  appName: string;
  heading: string;
  bodyHtml: string;
  action?: { label: string; url: string };
  footerNote?: string;
}): string {
  const { appName, heading, bodyHtml, action, footerNote } = options;

  const button = action
    ? `
      <tr>
        <td style="padding: 8px 0 24px;">
          <a href="${escapeAttr(action.url)}"
             style="display:inline-block;background:${BRAND};color:#ffffff;
                    text-decoration:none;padding:12px 24px;border-radius:8px;
                    font-weight:600;font-size:15px;">
            ${escapeHtml(action.label)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:24px;color:${MUTED};font-size:13px;line-height:1.6;">
          If the button does not work, copy this address into your browser:<br />
          <span style="color:${BRAND};word-break:break-all;">${escapeHtml(action.url)}</span>
        </td>
      </tr>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;
               font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="max-width:560px;margin:0 auto;background:#ffffff;
                  border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="width:36px;height:36px;background:${BRAND};border-radius:50%;
                         text-align:center;vertical-align:middle;color:#ffffff;
                         font-size:18px;font-weight:700;">M</td>
              <td style="padding-left:12px;font-size:17px;font-weight:600;color:${INK};">
                ${escapeHtml(appName)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-size:20px;font-weight:600;color:${INK};padding-bottom:16px;">
                ${escapeHtml(heading)}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.65;color:${INK};padding-bottom:24px;">
                ${bodyHtml}
              </td>
            </tr>
            ${button}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;
                   font-size:12px;line-height:1.6;color:${MUTED};">
          ${footerNote ? `${escapeHtml(footerNote)}<br /><br />` : ''}
          ${escapeHtml(appName)} is an academic rehabilitation support prototype.
          It does not diagnose, is not a medical device, and is not a substitute
          for professional assessment.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function verificationEmail(options: {
  appName: string;
  firstName: string;
  url: string;
  expiresInHours: number;
}): EmailContent {
  const { appName, firstName, url, expiresInHours } = options;
  return {
    subject: `Verify your email address - ${appName}`,
    text: [
      `Hello ${firstName},`,
      ``,
      `Welcome to ${appName}. Please confirm your email address to activate your account.`,
      ``,
      url,
      ``,
      `This link expires in ${expiresInHours} hours. You will not be able to sign in until your email is verified.`,
      ``,
      `If you did not create this account, you can ignore this email.`,
      ``,
      `Regards,`,
      `${appName} Team`,
    ].join('\n'),
    html: layout({
      appName,
      heading: 'Confirm your email address',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hello ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 12px;">
          Welcome to ${escapeHtml(appName)}. Please confirm your email address
          to activate your account.
        </p>
        <p style="margin:0;">
          You will not be able to sign in until your email is verified.
        </p>`,
      action: { label: 'Verify my email', url },
      footerNote:
        `This link expires in ${expiresInHours} hours. ` +
        `If you did not create this account, you can safely ignore this email.`,
    }),
  };
}

export function passwordResetEmail(options: {
  appName: string;
  firstName: string;
  url: string;
  expiresInMinutes: number;
}): EmailContent {
  const { appName, firstName, url, expiresInMinutes } = options;
  return {
    subject: `Reset your password - ${appName}`,
    text: [
      `Hello ${firstName},`,
      ``,
      `We received a request to reset your ${appName} password.`,
      ``,
      url,
      ``,
      `This link expires in ${expiresInMinutes} minutes and can be used once.`,
      ``,
      `If you did not request this, no action is needed - your password has not changed.`,
      ``,
      `Regards,`,
      `${appName} Team`,
    ].join('\n'),
    html: layout({
      appName,
      heading: 'Reset your password',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hello ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 12px;">
          We received a request to reset your ${escapeHtml(appName)} password.
          Choose a new one using the button below.
        </p>
        <p style="margin:0;">
          This link expires in <strong>${expiresInMinutes} minutes</strong> and
          can only be used once.
        </p>`,
      action: { label: 'Choose a new password', url },
      footerNote:
        'If you did not request this, no action is needed - your password has not changed.',
    }),
  };
}

export function patientLinkedEmail(options: {
  appName: string;
  patientName: string;
  therapistName: string;
  url: string;
}): EmailContent {
  const { appName, patientName, therapistName, url } = options;
  return {
    subject: `Successfully connected with your therapist - ${appName}`,
    text: [
      `Hello ${patientName},`,
      ``,
      `You have successfully connected with your therapist ${therapistName} on ${appName}.`,
      ``,
      `You can now view assigned exercises and rehabilitation tasks.`,
      ``,
      url,
      ``,
      `Regards,`,
      `${appName} Team`,
    ].join('\n'),
    html: layout({
      appName,
      heading: 'You are connected with your therapist',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hello ${escapeHtml(patientName)},</p>
        <p style="margin:0 0 12px;">
          You have successfully connected with your therapist
          <strong>${escapeHtml(therapistName)}</strong> on ${escapeHtml(appName)}.
        </p>
        <p style="margin:0;">
          You can now view assigned exercises and rehabilitation tasks.
        </p>`,
      action: { label: 'Open my exercises', url },
    }),
  };
}

export function therapistLinkedEmail(options: {
  appName: string;
  therapistName: string;
  patientName: string;
  url: string;
}): EmailContent {
  const { appName, therapistName, patientName, url } = options;
  return {
    subject: `Patient successfully connected - ${appName}`,
    text: [
      `Hello ${therapistName},`,
      ``,
      `Patient ${patientName} has successfully joined your ${appName} rehabilitation program.`,
      ``,
      `You can now assign exercises and monitor progress.`,
      ``,
      url,
      ``,
      `Regards,`,
      `${appName} Team`,
    ].join('\n'),
    html: layout({
      appName,
      heading: 'A patient has joined your programme',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hello ${escapeHtml(therapistName)},</p>
        <p style="margin:0 0 12px;">
          Patient <strong>${escapeHtml(patientName)}</strong> has successfully
          joined your ${escapeHtml(appName)} rehabilitation program.
        </p>
        <p style="margin:0;">
          You can now assign exercises and monitor progress.
        </p>`,
      action: { label: 'View patient', url },
    }),
  };
}

export function exerciseAssignedEmail(options: {
  appName: string;
  patientName: string;
  therapistName: string;
  exerciseName: string;
  /** Already formatted for display, or null when the assignment is open-ended. */
  dueDate: string | null;
  /**
   * The prescription in words, already phrased for the exercise's goal type
   * - "3 sets of 10 repetitions", or "60 seconds of correct alignment".
   *
   * A string rather than sets and reps, because a held-position exercise has
   * neither and an email that invented them would tell the patient to expect
   * something the session will never ask of them.
   */
  prescription: string;
  url: string;
}): EmailContent {
  const {
    appName,
    patientName,
    therapistName,
    exerciseName,
    dueDate,
    prescription,
    url,
  } = options;

  const due = dueDate ?? 'No end date - continue until your therapist updates it';

  return {
    subject: `New exercise assigned on ${appName}`,
    text: [
      `Hello ${patientName},`,
      ``,
      `Your therapist has assigned you a new exercise.`,
      ``,
      `Therapist: ${therapistName}`,
      `Exercise:  ${exerciseName}`,
      `Prescribed: ${prescription}`,
      `Due date:  ${due}`,
      ``,
      `Please login to ${appName} to complete your exercise session.`,
      ``,
      url,
      ``,
      `Regards,`,
      `${appName} Team`,
    ].join('\n'),
    html: layout({
      appName,
      heading: 'New exercise assigned',
      bodyHtml: `
        <p style="margin:0 0 12px;">Hello ${escapeHtml(patientName)},</p>
        <p style="margin:0 0 16px;">
          Your therapist has assigned you a new exercise.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;border:1px solid #e5e7eb;border-radius:8px;">
          ${row('Therapist', therapistName)}
          ${row('Exercise', exerciseName)}
          ${row('Prescribed', prescription)}
          ${row('Due date', due, true)}
        </table>
        <p style="margin:16px 0 0;">
          Please login to ${escapeHtml(appName)} to complete your exercise session.
        </p>`,
      action: { label: 'Start my exercise', url },
    }),
  };
}

function row(label: string, value: string, last = false): string {
  const border = last ? '' : 'border-bottom:1px solid #e5e7eb;';
  return `
    <tr>
      <td style="padding:10px 14px;${border}color:${MUTED};font-size:13px;width:110px;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:10px 14px;${border}color:${INK};font-size:14px;font-weight:500;">
        ${escapeHtml(value)}
      </td>
    </tr>`;
}

/**
 * Names and exercise titles are user-supplied and end up inside HTML that a
 * mail client renders. Escaping is what stops a patient called
 * `<script>...` from turning every notification into an injection vector.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
