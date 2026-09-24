/**
 * Interactive, no-echo hash generator. Does not create a password, call a
 * service, modify the DB, or save plaintext. Run locally, not in deploy logs:
 * npx tsx script/hash-reviewer-password.ts
 */
import bcrypt from "bcryptjs";
import { emitKeypressEvents } from "node:readline";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error("Run in an interactive local terminal; do not supply a password as a command argument.");
}
emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
let password = "";
let first: string | undefined;
process.stdout.write("New reviewer password (hidden, 20+ characters): ");
process.stdin.on("keypress", (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
  if (key?.ctrl && key.name === "c") {
    process.stdin.setRawMode(false);
    process.stdout.write("\nCancelled.\n");
    process.exit(1);
  }
  if (key?.name === "return") {
    process.stdout.write("\n");
    if (password.length < 20 || Buffer.byteLength(password, "utf8") > 72) {
      password = "";
      process.stdout.write("Use 20+ characters and at most 72 UTF-8 bytes. Try again: ");
      return;
    }
    if (first === undefined) {
      first = password;
      password = "";
      process.stdout.write("Confirm password (hidden): ");
      return;
    }
    if (password !== first) {
      first = undefined;
      password = "";
      process.stdout.write("Passwords did not match. New password (hidden): ");
      return;
    }
    process.stdin.setRawMode(false);
    const hash = bcrypt.hashSync(password, 12);
    password = "";
    first = undefined;
    process.stdout.write(`bcrypt hash (copy to the matching Railway hash variable):\n${hash}\n`);
    process.exit(0);
  }
  if (key?.name === "backspace") password = Array.from(password).slice(0, -1).join("");
  else if (text && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) password += text;
});
