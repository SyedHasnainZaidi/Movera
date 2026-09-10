import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';
import {
  exerciseAssignedEmail,
  passwordResetEmail,
  patientLinkedEmail,
  therapistLinkedEmail,
  verificationEmail,
  type EmailContent,
} from './email.templates';

/**
 * Outbound email.
 *
 * Two design rules run through this file:
 *
 * 1. **Sending never breaks the thing that triggered it.** A registration, a
 *    therapist-patient link and an exercise assignment are all database facts
 *    that have already been committed by the time we try to email about them.
 *    If Gmail is unreachable, the correct behaviour is a logged warning, not a
 *    500 that makes the user think the action failed. Every `send` therefore
 *    resolves; it returns false rather than throwing.
 *
 *    The one deliberate exception is signup verification, where the caller
 *    surfaces a "we could not send the email" path so the user can retry -
 *    see AuthService.register.
 *
 * 2. **No credential is ever logged.** Recipient addresses are logged because
 *    they are needed to diagnose delivery; passwords, tokens and full message
 *    bodies containing links are not.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const smtp = this.config.smtp;

    if (!smtp) {
      // Loud on purpose. A silent "email disabled" is how a demo ends with
      // nobody able to verify their account and no clue why.
      this.logger.warn(
        'SMTP is not configured - emails will be WRITTEN TO THIS LOG instead of sent. ' +
          'Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD in apps/backend/.env to send real mail.',
      );
      return;
    }

    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS. Gmail supports both,
      // and getting this wrong is the usual cause of a hanging connection.
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.password },
    });

    this.logger.log(
      `SMTP configured: ${smtp.host}:${smtp.port} as ${smtp.user}`,
    );
  }

  /** True when a transport exists; false when running in log-only mode. */
  get enabled(): boolean {
    return this.transporter !== null;
  }

  // -- public senders --------------------------------------------------------

  async sendVerification(input: {
    to: string;
    firstName: string;
    token: string;
  }): Promise<boolean> {
    const url = this.link('/verify-email', input.token);
    return this.send(
      input.to,
      verificationEmail({
        appName: this.config.appName,
        firstName: input.firstName,
        url,
        expiresInHours: this.config.emailVerificationTtlHours,
      }),
    );
  }

  async sendPasswordReset(input: {
    to: string;
    firstName: string;
    token: string;
  }): Promise<boolean> {
    const url = this.link('/reset-password', input.token);
    return this.send(
      input.to,
      passwordResetEmail({
        appName: this.config.appName,
        firstName: input.firstName,
        url,
        expiresInMinutes: this.config.passwordResetTtlMinutes,
      }),
    );
  }

  async sendPatientLinked(input: {
    to: string;
    patientName: string;
    therapistName: string;
  }): Promise<boolean> {
    return this.send(
      input.to,
      patientLinkedEmail({
        appName: this.config.appName,
        patientName: input.patientName,
        therapistName: input.therapistName,
        url: `${this.config.publicUrl}/patient/exercises`,
      }),
    );
  }

  async sendTherapistLinked(input: {
    to: string;
    therapistName: string;
    patientName: string;
    patientProfileId: string;
  }): Promise<boolean> {
    return this.send(
      input.to,
      therapistLinkedEmail({
        appName: this.config.appName,
        therapistName: input.therapistName,
        patientName: input.patientName,
        url: `${this.config.publicUrl}/therapist/patients/${input.patientProfileId}`,
      }),
    );
  }

  async sendExerciseAssigned(input: {
    to: string;
    patientName: string;
    therapistName: string;
    exerciseName: string;
    dueDate: Date | null;
    /** Already phrased for the exercise's goal type - see the template. */
    prescription: string;
  }): Promise<boolean> {
    return this.send(
      input.to,
      exerciseAssignedEmail({
        appName: this.config.appName,
        patientName: input.patientName,
        therapistName: input.therapistName,
        exerciseName: input.exerciseName,
        dueDate: input.dueDate
          ? input.dueDate.toISOString().slice(0, 10)
          : null,
        prescription: input.prescription,
        url: `${this.config.publicUrl}/patient/exercises`,
      }),
    );
  }

  // -- internals -------------------------------------------------------------

  /**
   * Builds a frontend URL carrying a token.
   *
   * The token goes in the query string because that is the only place a link
   * in an email body can carry it. It is a single-use, short-lived credential
   * for exactly this reason - a URL is logged by proxies and kept in browser
   * history, so it must stop being useful quickly.
   */
  private link(path: string, token: string): string {
    return `${this.config.publicUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  private async send(to: string, content: EmailContent): Promise<boolean> {
    if (!this.transporter) {
      // Log-only mode. The body is printed so a developer can copy the
      // verification link out of the terminal and complete the flow with no
      // mail server at all.
      this.logger.log(
        `\n--- EMAIL (not sent: SMTP unconfigured) ---\n` +
          `To:      ${to}\n` +
          `Subject: ${content.subject}\n\n` +
          `${content.text}\n` +
          `--- end email ---`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.config.smtp?.from,
        to,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      this.logger.log(`Sent "${content.subject}" to ${to}`);
      return true;
    } catch (error) {
      // Message, not the whole error: an SMTP stack trace can echo back the
      // authentication exchange.
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Failed to email ${to}: ${reason}`);
      return false;
    }
  }
}
