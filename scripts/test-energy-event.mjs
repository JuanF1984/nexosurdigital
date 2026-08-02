#!/usr/bin/env node
/**
 * Manual test script for POST /api/energy-event.
 *
 * Usage:
 *   DEVICE_API_KEY=xxxxx node scripts/test-energy-event.mjs
 *   DEVICE_API_KEY=xxxxx BASE_URL=https://tu-deploy.vercel.app node scripts/test-energy-event.mjs
 *
 *   # Ejemplo RESTAURADO (cutStartedAt/restoredAt/durationSeconds coherentes):
 *   DEVICE_API_KEY=xxxxx EVENT=RESTAURADO node scripts/test-energy-event.mjs
 *
 * Optional env vars:
 *   BASE_URL          Defaults to http://localhost:3000
 *   EVENT             CORTE | BAJA_TENSION | RESTAURADO | NORMAL (default: CORTE)
 *   DEVICE_ID         Defaults to detector-casa-01
 *
 *   For EVENT=RESTAURADO only:
 *   DURATION_SECONDS  Duration used to derive cutStartedAt from restoredAt (default: 2256)
 *   RESTORED_AT       ISO date-time; defaults to "now"
 *   CUT_STARTED_AT    ISO date-time; defaults to RESTORED_AT - DURATION_SECONDS
 *                      (kept coherent unless you override it on purpose to test the 400 case)
 */

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const deviceApiKey = process.env.DEVICE_API_KEY;
const event = process.env.EVENT ?? "CORTE";
const deviceId = process.env.DEVICE_ID ?? "detector-casa-01";

if (!deviceApiKey) {
  console.error("Falta DEVICE_API_KEY en el entorno. Ejemplo:");
  console.error("  DEVICE_API_KEY=xxxxx node scripts/test-energy-event.mjs");
  process.exit(1);
}

let payload;
if (event === "RESTAURADO") {
  const durationSeconds = Number(process.env.DURATION_SECONDS ?? 2256);
  const restoredAt = process.env.RESTORED_AT ?? new Date().toISOString();
  const cutStartedAt =
    process.env.CUT_STARTED_AT ??
    new Date(new Date(restoredAt).getTime() - durationSeconds * 1000).toISOString();

  payload = { deviceId, event, cutStartedAt, restoredAt, durationSeconds };
} else {
  payload = { deviceId, event, dateTime: new Date().toISOString(), durationSeconds: null };
}

const url = `${baseUrl.replace(/\/$/, "")}/api/energy-event`;

console.log(`POST ${url}`);
console.log("Payload:", JSON.stringify(payload, null, 2));

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${deviceApiKey}`,
  },
  body: JSON.stringify(payload),
});

const body = await response.text();
console.log(`\nStatus: ${response.status}`);
console.log("Body:", body);
