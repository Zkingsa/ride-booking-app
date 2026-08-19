const nodemailer = require('nodemailer');

// Builds a nodemailer transport from environment config, or null when SMTP
// isn't configured (local dev). Callers fall back to logging the reset link
// to the server console when this returns null.
function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// Sends the password-reset email. Returns true if an email was sent, false if
// no SMTP transport is configured (so the caller can use the dev fallback).
async function sendPasswordResetEmail(to, resetLink) {
  const transporter = getTransporter();
  if (!transporter) return false;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'RideBook <no-reply@ridebook.local>',
    to,
    subject: 'RideBook — Reset your password',
    text: `You asked to reset your RideBook password.\n\nClick this link to choose a new password (valid for 1 hour):\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `<p>You asked to reset your <strong>RideBook</strong> password.</p>
<p><a href="${resetLink}">Click here to choose a new password</a> — this link is valid for 1 hour.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`
  });
  return true;
}

module.exports = { sendPasswordResetEmail };
