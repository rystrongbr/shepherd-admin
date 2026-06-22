/**
 * Church signup welcome-email templates.
 *
 * Two persona variants:
 *   - "staff"  → pastor / staff / leadership. Pitches Church Dashboard + soft
 *                Founder Cohort mention. CTA = book a 15-min call.
 *   - "member" → parishioner / regular member (Red Rocks scenario). Opens with
 *                a direct ask for the intro to leadership. NO Founder Cohort
 *                mention (that conversation belongs in the call we have with
 *                whoever they introduce us to).
 *
 * Both are sent personally as Ryan Armstrong <ryan@myshepherdapp.church>
 * (replyTo also routes to ryan@). Wire from server/church-signup.ts.
 *
 * Template variables (replaced via .replace() in church-signup.ts):
 *   {{contactName}}, {{churchName}}
 */

export const WELCOME_HTML_STAFF = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Welcome to My Shepherd</title>
</head>
<body style="margin:0;padding:0;background:#F7F3EA;font-family:Inter,Arial,sans-serif;color:#2B1B11;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F3EA;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#FBF8F0;border:1px solid #D9CFBE;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 16px;">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#964219;font-weight:600;">MY SHEPHERD &middot; WELCOME</p>
              <h1 style="margin:0 0 16px;font-family:Georgia,'DM Serif Display',serif;font-size:28px;line-height:1.25;color:#5C2A0E;">Welcome, {{contactName}}.</h1>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Brother, thank you for signing <strong>{{churchName}}</strong> up for My Shepherd &mdash; that means a lot.</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.55;">I built this as a free, KJV-anchored Scripture companion for believers who want thoughtful answers that come directly from the Bible &mdash; not paraphrased or invented by a language model.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Here's a small menu of ways to introduce it to your congregation. Pick whichever fits your style this week:</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5C2A0E;font-weight:700;">1. THE ONE-LINE BULLETIN / SUNDAY SLIDE</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;font-style:italic;color:#2B1B11;">Try My Shepherd &mdash; a free, scripture-only AI companion built around the King James Bible: <a href="https://myshepherdapp.church" style="color:#5C2A0E;">myshepherdapp.church</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5C2A0E;font-weight:700;">2. THE PASTOR'S SHARE</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;font-style:italic;color:#2B1B11;">I want to share something I've been using personally. My Shepherd is a free AI Scripture companion built around the KJV. Unlike other AI tools, it doesn't paraphrase or invent verses &mdash; every answer is anchored in real chapter-and-verse text. Try it at <a href="https://myshepherdapp.church" style="color:#5C2A0E;">myshepherdapp.church</a> &mdash; no signup, no ads, no subscription.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5C2A0E;font-weight:700;">3. THE SMALL GROUP PROMPT</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;font-style:italic;color:#2B1B11;">This week, try asking My Shepherd a question from Sunday's passage &mdash; and discuss the verses it surfaces together. It's a useful way to start a conversation about how Scripture answers the questions we're actually carrying.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">One more thing worth a quick conversation. The member-facing app is free for your congregation forever &mdash; that part doesn't change. But I've also built a <strong>Church Dashboard</strong> for pastors and staff: you can see (anonymized) the kinds of questions your members are actually asking, create email campaigns rooted in those insights, and help your congregation engage with Scripture between Sundays. I'm opening the first ten seats nationally as a <strong>Founder Cohort</strong> with intentionally generous terms &mdash; I'd rather walk you through what that looks like on a call than write it out cold.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">If your church needs something specific &mdash; a custom landing page, a tailored intro for your members &mdash; just reply and I'll handle it personally.</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.55;">And if you'd like to talk it through, here's my calendar for a 15-minute call:</p>
              <p style="margin:0 0 24px;text-align:center;">
                <a href="https://calendar.app.google/eF91brMLnhhQxEHN7" style="display:inline-block;background:#5C2A0E;color:#F7F3EA;text-decoration:none;padding:12px 28px;border-radius:4px;font-size:15px;font-weight:600;letter-spacing:0.02em;">Book a 15-min call</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 32px;border-top:1px solid #D9CFBE;">
              <p style="margin:24px 0 8px;font-size:15px;line-height:1.55;font-style:italic;color:#6E5B4C;">"He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake." &mdash; Psalm 23:3</p>
              <p style="margin:24px 0 4px;font-size:16px;line-height:1.4;">In Him,</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.4;font-weight:600;">Ryan</p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#6E5B4C;">
                Ryan Armstrong &middot; Founder, My Shepherd<br>
                <a href="mailto:ryan@myshepherdapp.church" style="color:#964219;">ryan@myshepherdapp.church</a><br>
                <a href="https://myshepherdapp.church" style="color:#964219;">myshepherdapp.church</a> &middot;
                <a href="https://app.myshepherdapp.church" style="color:#964219;">app.myshepherdapp.church</a> &middot;
                <a href="https://faith.tools/app/15245-my-shepherd" style="color:#964219;">Vetted on faith.tools</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const WELCOME_TEXT_STAFF = `Welcome, {{contactName}}.

Brother, thank you for signing {{churchName}} up for My Shepherd — that
means a lot.

I built this as a free, KJV-anchored Scripture companion for believers who want
thoughtful answers that come directly from the Bible — not paraphrased or
invented by a language model.

Here's a small menu of ways to introduce it to your congregation. Pick
whichever fits your style this week:

1. THE ONE-LINE BULLETIN / SUNDAY SLIDE
   "Try My Shepherd — a free, scripture-only AI companion built around the
   King James Bible: myshepherdapp.church"

2. THE PASTOR'S SHARE
   "I want to share something I've been using personally. My Shepherd is a
   free AI Scripture companion built around the KJV. Unlike other AI tools,
   it doesn't paraphrase or invent verses — every answer is anchored in real
   chapter-and-verse text. Try it at myshepherdapp.church — no signup, no
   ads, no subscription."

3. THE SMALL GROUP PROMPT
   "This week, try asking My Shepherd a question from Sunday's passage — and
   discuss the verses it surfaces together. It's a useful way to start a
   conversation about how Scripture answers the questions we're actually
   carrying."

One more thing worth a quick conversation. The member-facing app is free for
your congregation forever — that part doesn't change. But I've also built a
Church Dashboard for pastors and staff: you can see (anonymized) the kinds of
questions your members are actually asking, create email campaigns rooted in
those insights, and help your congregation engage with Scripture between
Sundays. I'm opening the first ten seats nationally as a Founder Cohort with
intentionally generous terms — I'd rather walk you through what that looks
like on a call than write it out cold.

If your church needs something specific — a custom landing page, a tailored
intro for your members — just reply and I'll handle it personally.

And if you'd like to talk it through, here's my calendar for a 15-minute call:
https://calendar.app.google/eF91brMLnhhQxEHN7

"He restoreth my soul: he leadeth me in the paths of righteousness for his
name's sake." — Psalm 23:3

In Him,
Ryan

—
Ryan Armstrong · Founder, My Shepherd
ryan@myshepherdapp.church
myshepherdapp.church · app.myshepherdapp.church
Vetted on faith.tools: faith.tools/app/15245-my-shepherd`;

// ─────────────────────────────────────────────────────────────────────────────
//  Member-champion variant (parishioner, not staff)
// ─────────────────────────────────────────────────────────────────────────────

export const WELCOME_HTML_MEMBER = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Welcome to My Shepherd</title>
</head>
<body style="margin:0;padding:0;background:#F7F3EA;font-family:Inter,Arial,sans-serif;color:#2B1B11;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F3EA;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#FBF8F0;border:1px solid #D9CFBE;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 16px;">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#964219;font-weight:600;">MY SHEPHERD &middot; WELCOME</p>
              <h1 style="margin:0 0 16px;font-family:Georgia,'DM Serif Display',serif;font-size:28px;line-height:1.25;color:#5C2A0E;">Welcome, {{contactName}}.</h1>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Thank you for thinking of <strong>{{churchName}}</strong> for My Shepherd &mdash; that means a lot.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Honestly, the most powerful way a church adopts something like this isn't a cold email from me; it's a recommendation from a member who's actually been using it. So before I get ahead of myself:</p>
              <p style="margin:0 0 24px;padding:16px 20px;background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;font-size:16px;line-height:1.55;color:#2B1B11;"><strong>Would you be open to introducing me to whoever at {{churchName}} would be the right person to talk to?</strong> That's usually a lead pastor, executive pastor, communications director, or whoever owns ministry-tech decisions. A two-line forward of this email is plenty &mdash; I'll handle it from there.</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">While you're thinking about that, here's a small menu of ways you can start sharing My Shepherd with the people around you. Pick whichever fits your style this week:</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5C2A0E;font-weight:700;">1. THE ONE-LINE TEXT / SOCIAL SHARE</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;font-style:italic;color:#2B1B11;">Try My Shepherd &mdash; a free, scripture-only AI companion built around the King James Bible: <a href="https://myshepherdapp.church" style="color:#5C2A0E;">myshepherdapp.church</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 16px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5C2A0E;font-weight:700;">2. THE PERSONAL RECOMMENDATION</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;font-style:italic;color:#2B1B11;">I've been using something called My Shepherd &mdash; it's a free AI Scripture companion built around the KJV. Unlike other AI tools, it doesn't paraphrase or invent verses &mdash; every answer is anchored in real chapter-and-verse text. Try it at <a href="https://myshepherdapp.church" style="color:#5C2A0E;">myshepherdapp.church</a> &mdash; no signup, no ads, no subscription.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0E6D2;border-left:4px solid #964219;border-radius:4px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#5C2A0E;font-weight:700;">3. THE SMALL GROUP PROMPT</p>
                    <p style="margin:0;font-size:15px;line-height:1.5;font-style:italic;color:#2B1B11;">This week, try asking My Shepherd a question from Sunday's passage &mdash; and discuss the verses it surfaces together. It's a useful way to start a conversation about how Scripture answers the questions we're actually carrying.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">For what it's worth: My Shepherd has been vetted on <a href="https://faith.tools/app/15245-my-shepherd" style="color:#964219;">faith.tools</a> (the faith-tech community's directory), and we've had over 1,380 unique visitors and 22,800+ Scripture requests in just our first ~2 weeks. If that gives you something to point to when you make the intro, even better.</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.55;">And if you'd rather just talk through how to approach the conversation with your pastor, here's my calendar for a quick 15 minutes:</p>
              <p style="margin:0 0 24px;text-align:center;">
                <a href="https://calendar.app.google/eF91brMLnhhQxEHN7" style="display:inline-block;background:#5C2A0E;color:#F7F3EA;text-decoration:none;padding:12px 28px;border-radius:4px;font-size:15px;font-weight:600;letter-spacing:0.02em;">Book a 15-min call</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 32px;border-top:1px solid #D9CFBE;">
              <p style="margin:24px 0 8px;font-size:15px;line-height:1.55;font-style:italic;color:#6E5B4C;">"He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake." &mdash; Psalm 23:3</p>
              <p style="margin:24px 0 4px;font-size:16px;line-height:1.4;">In Him,</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.4;font-weight:600;">Ryan</p>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#6E5B4C;">
                Ryan Armstrong &middot; Founder, My Shepherd<br>
                <a href="mailto:ryan@myshepherdapp.church" style="color:#964219;">ryan@myshepherdapp.church</a><br>
                <a href="https://myshepherdapp.church" style="color:#964219;">myshepherdapp.church</a> &middot;
                <a href="https://app.myshepherdapp.church" style="color:#964219;">app.myshepherdapp.church</a> &middot;
                <a href="https://faith.tools/app/15245-my-shepherd" style="color:#964219;">Vetted on faith.tools</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const WELCOME_TEXT_MEMBER = `Welcome, {{contactName}}.

Thank you for thinking of {{churchName}} for My Shepherd — that means a lot.

Honestly, the most powerful way a church adopts something like this isn't
a cold email from me; it's a recommendation from a member who's actually been
using it. So before I get ahead of myself:

  Would you be open to introducing me to whoever at {{churchName}} would be
  the right person to talk to? That's usually a lead pastor, executive
  pastor, communications director, or whoever owns ministry-tech decisions.
  A two-line forward of this email is plenty — I'll handle it from there.

While you're thinking about that, here's a small menu of ways you can start
sharing My Shepherd with the people around you. Pick whichever fits your
style this week:

1. THE ONE-LINE TEXT / SOCIAL SHARE
   "Try My Shepherd — a free, scripture-only AI companion built around the
   King James Bible: myshepherdapp.church"

2. THE PERSONAL RECOMMENDATION
   "I've been using something called My Shepherd — it's a free AI Scripture
   companion built around the KJV. Unlike other AI tools, it doesn't
   paraphrase or invent verses — every answer is anchored in real chapter-
   and-verse text. Try it at myshepherdapp.church — no signup, no ads, no
   subscription."

3. THE SMALL GROUP PROMPT
   "This week, try asking My Shepherd a question from Sunday's passage —
   and discuss the verses it surfaces together. It's a useful way to start
   a conversation about how Scripture answers the questions we're actually
   carrying."

For what it's worth: My Shepherd has been vetted on faith.tools (the
faith-tech community's directory), and we've had over 1,380 unique
visitors and 22,800+ Scripture requests in just our first ~2 weeks. If
that gives you something to point to when you make the intro, even better.

And if you'd rather just talk through how to approach the conversation with
your pastor, here's my calendar for a quick 15 minutes:
https://calendar.app.google/eF91brMLnhhQxEHN7

"He restoreth my soul: he leadeth me in the paths of righteousness for his
name's sake." — Psalm 23:3

In Him,
Ryan

—
Ryan Armstrong · Founder, My Shepherd
ryan@myshepherdapp.church
myshepherdapp.church · app.myshepherdapp.church
Vetted on faith.tools: faith.tools/app/15245-my-shepherd`;

// ─────────────────────────────────────────────────────────────────────────────
//  Persona resolver
// ─────────────────────────────────────────────────────────────────────────────

export type ChurchRole = "staff" | "member" | "exploring";

export const VALID_CHURCH_ROLES: ReadonlySet<ChurchRole> = new Set<ChurchRole>([
  "staff",
  "member",
  "exploring",
]);

/**
 * Pick the welcome variant by role. "exploring" and any other/unknown value
 * fall through to the staff variant for now — it's the safer default (won't
 * ask a stranger to make a warm intro) and matches the original behavior.
 */
export function pickWelcomeTemplate(role: ChurchRole | undefined): {
  html: string;
  text: string;
  subjectSuffix: string;
} {
  if (role === "member") {
    return {
      html: WELCOME_HTML_MEMBER,
      text: WELCOME_TEXT_MEMBER,
      subjectSuffix: "and a quick ask",
    };
  }
  return {
    html: WELCOME_HTML_STAFF,
    text: WELCOME_TEXT_STAFF,
    subjectSuffix: "a few ways to get started",
  };
}

/**
 * Basic HTML escaper for template-variable substitution. Prevents an attacker
 * who submits e.g. `<script>` in the church name field from getting that into
 * the rendered email body.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
