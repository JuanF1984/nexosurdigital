#!/usr/bin/env node
/**
 * Manual test script for POST /api/energy-event.
 *
 * Usage:
 *   DEVICE_API_KEY=xxxxx node scripts/test-energy-event.mjs
 *   DEVICE_API_KEY=xxxxx BASE_URL=https://tu-deploy.vercel.app node scripts/test-energy-event.mjs
 *
 * Optional env vars:
 *   BASE_URL          Defaults to http://localhost:3000
 *   EVENT             CORTE | BAJA_TENSION | RESTAURADO | NORMAL (default: CORTE)
 *   DEVICE_ID         Defaults to detector-casa-01
 *   DURATION_SECONDS  Only used when EVENT=RESTAURADO (default: 88)
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

const payload = {
  deviceId,
  event,
  dateTime: new Date().toISOString(),
  durationSeconds: event === "RESTAURADO" ? Number(process.env.DURATION_SECONDS ?? 88) : null,
};

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
