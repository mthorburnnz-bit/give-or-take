/**
 * The VAPID public key, shared by the client and the Worker.
 *
 * It lives here rather than in either of them because both need the exact same
 * value and they are separate bundles: a browser's push subscription is bound
 * to the key it was created with, so if these two ever drifted apart every
 * send would be rejected by the push service and nobody would get a reminder.
 *
 * Public by design — the client has to hand it to the browser. The private
 * half is a Worker secret. See tools/generateVapidKeys.mjs.
 */
export const VAPID_PUBLIC_KEY =
  "BJ4yucf5i6dCngDJmz7L_kVriTbrRI695yqe7BPovd7uOQVuD2fuAqZG2ZlYAXfRJ98asCAnqw1XbyVg8YPe4hY";
