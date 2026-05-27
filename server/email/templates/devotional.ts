/**
 * Devotional email template — used by the Mon/Wed/Fri cadence and by ad-hoc
 * devotional campaigns.
 *
 * Keep this file presentational only. Any branching on segment or content
 * belongs in cadence.ts (Phase D).
 */

import { emailConfig } from "../config";

export interface DevotionalEmailOptions {
  churchName: string;
  primaryColor: string;
  bibleTopicTag: string;
  verseText?: string;
  verseRef?: string;
  reflection?: string;
  appUrl?: string;
}

export function buildDevotionalEmailHtml(options: DevotionalEmailOptions): string {
  const {
    churchName,
    primaryColor,
    bibleTopicTag,
    verseText  = "",
    verseRef   = "",
    reflection = "",
    appUrl     = emailConfig.appUrl,
  } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(churchName)} — ${escapeHtml(bibleTopicTag)}</title>
  <style>
    body { margin: 0; padding: 0; background: #f5f0eb; font-family: Georgia, 'Times New Roman', serif; }
    .wrapper { max-width: 600px; margin: 0 auto; background: #fff; }
    .header { background: ${primaryColor}; padding: 28px 32px; }
    .header h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
    .header p { margin: 4px 0 0; color: rgba(255,255,255,0.7); font-size: 13px; font-family: Arial, sans-serif; }
    .topic-bar { background: #f9f5f0; border-left: 4px solid ${primaryColor}; padding: 14px 24px; font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${primaryColor}; }
    .body { padding: 32px; }
    .verse { font-style: italic; font-size: 18px; line-height: 1.7; color: #3a2e1e; border-left: 3px solid ${primaryColor}; padding-left: 20px; margin: 0 0 8px; }
    .verse-ref { font-family: Arial, sans-serif; font-size: 13px; color: #9a8a7a; margin: 0 0 24px; padding-left: 20px; }
    .reflection { font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7; color: #4a4038; margin: 0 0 32px; }
    .cta-block { text-align: center; padding: 24px; background: #f9f5f0; border-radius: 8px; margin-bottom: 32px; }
    .cta-block p { margin: 0 0 14px; font-family: Arial, sans-serif; font-size: 14px; color: #6b5a4a; }
    .cta-btn { display: inline-block; background: ${primaryColor}; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-family: Arial, sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; }
    .footer { padding: 20px 32px; border-top: 1px solid #e8e0d8; font-family: Arial, sans-serif; font-size: 12px; color: #9a8a7a; text-align: center; }
    .footer a { color: #9a8a7a; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>${escapeHtml(churchName)}</h1>
      <p>A word for your week</p>
    </div>
    <div class="topic-bar">This week's topic: ${escapeHtml(bibleTopicTag)}</div>
    <div class="body">
      ${verseText ? `<blockquote class="verse">"${escapeHtml(verseText)}"</blockquote>` : ""}
      ${verseRef  ? `<p class="verse-ref">— ${escapeHtml(verseRef)}</p>` : ""}
      ${reflection
        ? `<p class="reflection">${escapeHtml(reflection)}</p>`
        : `<p class="reflection">This week, we invite you to spend time reflecting on what Scripture says about <strong>${escapeHtml(bibleTopicTag)}</strong>. Let God's Word be your guide as you navigate the days ahead.</p>`}
      <div class="cta-block">
        <p>Explore more Scripture on <strong>${escapeHtml(bibleTopicTag)}</strong> in the My Shepherd app</p>
        <a href="${appUrl}" class="cta-btn">Go Deeper in My Shepherd →</a>
      </div>
    </div>
    <div class="footer">
      <p>You're receiving this because you're a member of ${escapeHtml(churchName)}.</p>
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
