import { sgSendMail } from "../email/sendgrid-client";
import { emailConfig } from "../email/config";
import type { Welcome } from "./routes";

export async function sendWaitlistWelcome(message: Welcome): Promise<boolean> {
  // Separate from customer auth and church sequences. Never relax provider
  // suppression settings or enable the existing email automation crons.
  if (!process.env.SENDGRID_API_KEY || emailConfig.dryRun) return false;
  const text = [
    "You're on the My Shepherd launch list.",
    "",
    "Thanks for joining us. We'll email you with launch updates and let you know when My Shepherd is available for your phone. Release timing may differ by platform.",
    "In the meantime, you can explore the web experience: https://app.myshepherdapp.church/",
    "",
    "You asked to receive these launch updates. No app account was created.",
    `Unsubscribe: ${message.unsubscribeUrl}`,
    "Privacy: https://app.myshepherdapp.church/waitlist/#privacy",
    "Contact: myshepherdadmin@gmail.com",
    "Bar Above LLC | 523 California Ave, Oakdale, CA 95361-3005",
  ].join("\n");
  const result = await sgSendMail({
    apiKey: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.SENDGRID_FROM_EMAIL || "hello@myshepherdapp.church",
    fromName: process.env.SENDGRID_FROM_NAME || "My Shepherd",
  }, {
    to: message.email,
    subject: "You're on the My Shepherd launch list",
    text,
    html: `<div style="font-family:Georgia,serif;color:#332c25;background:#f6f0e2;padding:32px;max-width:560px;margin:auto">
      <p style="font-size:20px">My Shepherd</p>
      <h1 style="font-size:28px">A little more Scripture.<br>A little closer to your day.</h1>
      <p>You're on the launch list. Thank you for joining us.</p>
      <p>We'll email you with launch updates and let you know when My Shepherd is available for your phone. Release timing may differ by platform.</p>
      <p><a href="https://app.myshepherdapp.church/">Explore My Shepherd on the web</a></p>
      <hr>
      <p style="font:13px/1.6 Arial,sans-serif">You asked to receive these launch updates. No app account was created.<br>
      <a href="${message.unsubscribeUrl}">Unsubscribe</a> ·
      <a href="https://app.myshepherdapp.church/waitlist/#privacy">Waitlist privacy</a><br>
      Contact: myshepherdadmin@gmail.com<br>
      Bar Above LLC | 523 California Ave, Oakdale, CA 95361-3005</p></div>`,
    categories: ["mobile-launch-waitlist"],
    replyTo: "myshepherdadmin@gmail.com",
  });
  return result.success;
}
