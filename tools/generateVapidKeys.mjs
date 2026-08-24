/**
 * Generates a VAPID keypair for Web Push.
 *
 * VAPID identifies this server to the push services (FCM, Mozilla, Apple) that
 * actually deliver notifications. The public half is baked into the client so
 * the browser can pin its subscription to us; the private half signs each send
 * and must never leave the Worker.
 *
 * Run once. Rotating the keypair invalidates every existing subscription —
 * a browser's subscription is bound to the public key it was created with —
 * so every player would silently stop receiving reminders until they
 * re-subscribed. Rotate only if the private key is believed compromised.
 *
 *   node tools/generateVapidKeys.mjs
 *
 * Prints the public key. Writes the private key to .vapid-private-key, which
 * is gitignored, and never prints it. Install it with:
 *
 *   npx wrangler secret put VAPID_PRIVATE_KEY < .vapid-private-key
 *
 * then delete the file.
 */
import { writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);

// The uncompressed point (0x04 || X || Y), which is the form the Push API
// expects for applicationServerKey.
const publicKey = b64url(await webcrypto.subtle.exportKey("raw", pair.publicKey));
// The raw private scalar, which is what VAPID signing wants — not PKCS#8.
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);

writeFileSync(".vapid-private-key", jwk.d, { mode: 0o600 });

console.log("VAPID public key (safe to commit, goes in the client):");
console.log(publicKey);
console.log("");
console.log("Private key written to .vapid-private-key (gitignored, not printed).");
console.log("Install it with:  npx wrangler secret put VAPID_PRIVATE_KEY < .vapid-private-key");
console.log("Then delete that file.");
