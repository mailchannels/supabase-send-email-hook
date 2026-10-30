// Edit this file to change the subjects and wording of each message.

export type Message = { to: string; subject: string; text: string; html: string };

export type Content = {
  appName: string;
  // The verification link, for actions confirmed by clicking a link.
  link?: string;
  // The one-time code, for actions confirmed by entering a code.
  code?: string;
  // Extra detail for notifications, such as the provider that was linked.
  detail?: string;
};

type Template = { subject: string; intro: string };

export const templates: Record<string, Template> = {
  signup: {
    subject: "Confirm your email address",
    intro: "Confirm your email address to finish signing up.",
  },
  invite: {
    subject: "You have been invited",
    intro: "You have been invited to create an account. Accept the invitation to set it up.",
  },
  magiclink: { subject: "Your sign-in link", intro: "Use this link to sign in." },
  email: { subject: "Your sign-in code", intro: "Use this code to sign in." },
  recovery: { subject: "Reset your password", intro: "Use this link to reset your password." },
  email_change: {
    subject: "Confirm your email change",
    intro: "Confirm the change of the email address for your account.",
  },
  reauthentication: {
    subject: "Confirm it's you",
    intro: "Enter this code to confirm your identity.",
  },
  password_changed_notification: {
    subject: "Your password was changed",
    intro: "The password for your account was changed.",
  },
  email_changed_notification: {
    subject: "Your email address was changed",
    intro: "The email address for your account was changed.",
  },
  phone_changed_notification: {
    subject: "Your phone number was changed",
    intro: "The phone number for your account was changed.",
  },
  identity_linked_notification: {
    subject: "A sign-in method was added",
    intro: "A new sign-in method was linked to your account.",
  },
  identity_unlinked_notification: {
    subject: "A sign-in method was removed",
    intro: "A sign-in method was removed from your account.",
  },
  mfa_factor_enrolled_notification: {
    subject: "A multi-factor method was added",
    intro: "A multi-factor authentication method was added to your account.",
  },
  mfa_factor_unenrolled_notification: {
    subject: "A multi-factor method was removed",
    intro: "A multi-factor authentication method was removed from your account.",
  },
};

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function render(type: string, to: string, content: Content): Message {
  const template = templates[type];
  const lines = [template.intro];
  const html = [`<p>${escapeHtml(template.intro)}</p>`];
  if (content.detail) {
    lines.push(content.detail);
    html.push(`<p>${escapeHtml(content.detail)}</p>`);
  }
  if (content.link) {
    lines.push(`Open this link: ${content.link}`);
    html.push(`<p><a href="${escapeHtml(content.link)}">${escapeHtml(template.subject)}</a></p>`);
  }
  if (content.code) {
    lines.push(`Or enter this code: ${content.code}`);
    html.push(`<p>Or enter this code: <strong>${escapeHtml(content.code)}</strong></p>`);
  }
  const footer = "If you didn't request this, you can ignore this email or contact support.";
  lines.push(footer);
  html.push(`<p>${escapeHtml(footer)}</p>`);
  return {
    to,
    subject: `${content.appName}: ${template.subject}`,
    text: lines.join("\n\n"),
    html: html.join("\n"),
  };
}
