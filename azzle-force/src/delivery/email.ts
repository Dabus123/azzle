import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export interface EmailDeliveryConfig {
  provider: "resend" | "smtp" | "none";
  resendApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
  fromEmail: string;
  fromName: string;
}

export class EmailDelivery {
  private transporter: Transporter | null = null;

  constructor(private config: EmailDeliveryConfig) {
    if (config.provider === "smtp" && config.smtpHost) {
      this.transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth:
          config.smtpUser || config.smtpPass
            ? { user: config.smtpUser, pass: config.smtpPass }
            : undefined,
      });
    }
  }

  isConfigured(): boolean {
    if (this.config.provider === "resend") return Boolean(this.config.resendApiKey);
    if (this.config.provider === "smtp") return Boolean(this.config.smtpHost);
    return false;
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error(
        "Email not configured — set RESEND_API_KEY or SMTP_HOST (+ SMTP_USER/SMTP_PASS) in .env"
      );
    }

    const from = this.formatFrom();

    if (this.config.provider === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text: body,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Resend API error ${res.status}: ${errText.slice(0, 300)}`);
      }
      return;
    }

    if (!this.transporter) {
      throw new Error("SMTP transporter not initialized");
    }

    await this.transporter.sendMail({
      from,
      to,
      subject,
      text: body,
    });
  }

  private formatFrom(): string {
    const email = this.config.fromEmail;
    const name = this.config.fromName;
    if (name && email) return `${name} <${email}>`;
    return email || "noreply@azzle.local";
  }
}
