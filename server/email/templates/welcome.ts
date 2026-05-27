/**
 * Welcome / onboarding step-1 email template.
 * Used by the onboarding sequence (Phase C) and by ad-hoc welcome campaigns.
 */

import { emailConfig } from "../config";

export interface WelcomeEmailOptions {
  churchName: string;
  primaryColor: string;
  firstName: string;
  appUrl?: string;
}

export function buildWelcomeEmailHtml(options: WelcomeEmailOptions): string {
  const {
    churchName,
    primaryColor,
    firstName,
    appUrl = emailConfig.appUrl,
  } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ${escapeHtml(churchName)}!</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f0eb; font-family: Georgia, 'Times New Roman', serif; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: ${primaryColor}; padding: 36px 32px; text-align: center; }
    .header h1 { margin: 0; color: #fff; font-size: 28px; font-weight: 700; }
    .header p { margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 15px; font-family: Arial, sans-serif; }
    .body { padding: 36px 32px; }
    .greeting { font-size: 20px; color: #3a2e1e; margin-bottom: 20px; }
    .body p { font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4a4038; margin: 0 0 16px; }
    .steps { background: #f9f5f0; border-radius: 8px; padding: 24px; margin: 24px 0; }
    .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; font-family: Arial, sans-serif; font-size: 14px; color: #4a4038; line-height: 1.5; }
    .step:last-child { margin-bottom: 0; }
    .step-num { background: ${primaryColor}; color: #fff; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
    .cta-btn { display: inline-block; background: ${primaryColor}; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-family: Arial, sans-serif; font-size: 15px; font-weight: 600; margin: 8px 0 24px; }
    .footer { padding: 20px 32px; border-top: 1px solid #e8e0d8; font-family: Arial, sans-serif; font-size: 12px; color: #9a8a7a; text-align: center; }
    .footer a { color: #9a8a7a; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Welcome, ${escapeHtml(firstName)}!</h1>
      <p>We're so glad you're here</p>
    </div>
    <div class="body">
      <p class="greeting">Dear ${escapeHtml(firstName)},</p>
      <p>Welcome to <strong>${escapeHtml(churchName)}</strong>. Our community exists to help people grow in faith, connect with one another, and experience the life-changing power of God's Word.</p>
      <p>Here are a few ways to get connected:</p>
      <div class="steps">
        <div class="step"><span class="step-num">1</span><span><strong>Explore Scripture</strong> — Use My Shepherd to discover what the Bible says about topics you're facing right now.</span></div>
        <div class="step"><span class="step-num">2</span><span><strong>Join a small group</strong> — Community is where faith grows. Ask us about our small groups at the next service.</span></div>
        <div class="step"><span class="step-num">3</span><span><strong>Stay connected</strong> — You'll hear from us a couple of times each week with Scripture, devotionals, and upcoming events.</span></div>
      </div>
      <p>In the meantime, explore Scripture in the My Shepherd app — it's a great starting point for any question you're carrying.</p>
      <a href="${appUrl}" class="cta-btn">Open My Shepherd</a>
      <p>With joy,<br /><strong>The ${escapeHtml(churchName)} Team</strong></p>
    </div>
    <div class="footer">
      <p><a href="{{unsubscribe}}">Unsubscribe</a> &nbsp;·&nbsp; <a href="{{unsubscribe_preferences}}">Update preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
