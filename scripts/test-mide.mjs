#!/usr/bin/env node
/**
 * Battery of manual tests for POST /api/mide/report, POST /api/mide/event
 * and GET /api/mide/config. Same style as scripts/test-energy-event.mjs
 * (plain fetch, no extra tooling) but runs every case in one go and prints
 * a PASS/FAIL summary, since there are many cases to cover.
 *
 * Requires a running dev server with SUPABASE_URL / SUPABASE_SECRET_KEY /
 * MIDE_DEVICE_API_KEY set, the MIDE schema migration applied, and
 * supabase/seed.sql run (registers mide-frio-001 and the inactive fixture
 * device mide-test-inactivo-001 used by the "dispositivo inactivo" cases).
 *
 * Usage:
 *   MIDE_DEVICE_API_KEY=xxxxx node scripts/test-mide.mjs
 *   MIDE_DEVICE_API_KEY=xxxxx BASE_URL=https://tu-deploy.vercel.app node scripts/test-mide.mjs
 *
 * Optional env vars:
 *   BASE_URL              Defaults to http://localhost:3000
 *   DEVICE_ID              Defaults to mide-frio-001 (must exist and be active)
 *   INACTIVE_DEVICE_ID     Defaults to mide-test-inactivo-001 (must exist and be inactive)
 */

const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const apiKey = process.env.MIDE_DEVICE_API_KEY;
const deviceId = process.env.DEVICE_ID ?? "mide-frio-001";
const inactiveDeviceId = process.env.INACTIVE_DEVICE_ID ?? "mide-test-inactivo-001";

if (!apiKey) {
  console.error("Falta MIDE_DEVICE_API_KEY en el entorno. Ejemplo:");
  console.error("  MIDE_DEVICE_API_KEY=xxxxx node scripts/test-mide.mjs");
  process.exit(1);
}

const authHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
};

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postRaw(path, rawBody) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: authHeaders,
    body: rawBody,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // some invalid-input cases may not return JSON; leave body as null
  }
  return { status: response.status, body };
}

async function post(path, payload) {
  return postRaw(path, JSON.stringify(payload));
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders });
  const body = await response.json();
  return { status: response.status, body };
}

function nowIso(offsetSeconds = 0) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function validMetric(overrides = {}) {
  return { metric: "temperature", unit: "C", min: 3.7, max: 4.2, avg: 3.9, samples: 60, ...overrides };
}

function validReportPayload(overrides = {}) {
  return {
    deviceId,
    firmwareVersion: "0.1.0",
    periodStart: nowIso(-300),
    periodEnd: nowIso(0),
    metrics: [validMetric()],
    ...overrides,
  };
}

console.log(`Base URL: ${baseUrl}`);
console.log(`Device: ${deviceId} / Inactive fixture: ${inactiveDeviceId}\n`);

// --- /api/mide/report ---------------------------------------------------

await check("report: reporte válido -> 200 + configVersion", async () => {
  const { status, body } = await post("/api/mide/report", validReportPayload());
  assert(status === 200, `esperaba 200, recibí ${status}`);
  assert(body?.ok === true, "esperaba ok:true");
  assert(typeof body?.configVersion !== "undefined", "esperaba configVersion en la respuesta");
});

await check("report: dispositivo inexistente -> 404", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ deviceId: "mide-no-existe-9999" })
  );
  assert(status === 404, `esperaba 404, recibí ${status}`);
});

await check("report: dispositivo inactivo -> 403", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ deviceId: inactiveDeviceId })
  );
  assert(status === 403, `esperaba 403, recibí ${status}`);
});

await check("report: JSON inválido -> 400", async () => {
  const { status } = await postRaw("/api/mide/report", "{ esto no es json");
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

await check("report: fecha inválida -> 400", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ periodStart: "2026-08-18 08:00:00" })
  );
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

await check("report: período invertido -> 400", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ periodStart: nowIso(0), periodEnd: nowIso(-300) })
  );
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

await check("report: samples 0 -> 400", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ metrics: [validMetric({ samples: 0 })] })
  );
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

await check("report: min > avg -> 400", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ metrics: [validMetric({ min: 5, avg: 3.9 })] })
  );
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

await check("report: avg > max -> 400", async () => {
  const { status } = await post(
    "/api/mide/report",
    validReportPayload({ metrics: [validMetric({ avg: 4.5, max: 4.2 })] })
  );
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

await check("report: múltiples métricas -> 200", async () => {
  const { status, body } = await post(
    "/api/mide/report",
    validReportPayload({
      metrics: [
        validMetric({ metric: "temperature", unit: "C" }),
        validMetric({ metric: "humidity", unit: "%", min: 40, max: 55, avg: 47 }),
      ],
    })
  );
  assert(status === 200, `esperaba 200, recibí ${status}`);
  assert(body?.ok === true, "esperaba ok:true");
});

// --- /api/mide/event ------------------------------------------------------

const eventId = `test-event-${Date.now()}`;

await check("event: evento válido -> 200 duplicate:false", async () => {
  const { status, body } = await post("/api/mide/event", {
    deviceId,
    eventId,
    type: "TEMP_HIGH",
    severity: "warning",
    startedAt: nowIso(0),
    value: 8.6,
  });
  assert(status === 200, `esperaba 200, recibí ${status}`);
  assert(body?.ok === true, "esperaba ok:true");
  assert(body?.duplicate === false, "esperaba duplicate:false en el primer envío");
});

await check("event: reenviar mismo eventId -> 200 duplicate:true, sin duplicar fila", async () => {
  const { status, body } = await post("/api/mide/event", {
    deviceId,
    eventId,
    type: "TEMP_HIGH",
    severity: "warning",
    startedAt: nowIso(0),
    value: 8.6,
  });
  assert(status === 200, `esperaba 200, recibí ${status}`);
  assert(body?.ok === true, "esperaba ok:true");
  assert(body?.duplicate === true, "esperaba duplicate:true en el reintento");
});

await check("event: dispositivo inexistente -> 404", async () => {
  const { status } = await post("/api/mide/event", {
    deviceId: "mide-no-existe-9999",
    eventId: `test-event-${Date.now()}`,
    type: "TEMP_HIGH",
    severity: "warning",
    startedAt: nowIso(0),
    value: 8.6,
  });
  assert(status === 404, `esperaba 404, recibí ${status}`);
});

await check("event: payload inválido -> 400", async () => {
  const { status } = await post("/api/mide/event", {
    deviceId,
    eventId: `test-event-${Date.now()}`,
    type: "temp_high", // debe ser MAYUSCULAS_CON_GUION_BAJO
    severity: "warning",
    startedAt: nowIso(0),
    value: 8.6,
  });
  assert(status === 400, `esperaba 400, recibí ${status}`);
});

// --- /api/mide/config -------------------------------------------------------

await check("config: dispositivo válido -> 200 + campos esperados", async () => {
  const { status, body } = await get(`/api/mide/config?deviceId=${encodeURIComponent(deviceId)}`);
  assert(status === 200, `esperaba 200, recibí ${status}`);
  assert(body?.ok === true, "esperaba ok:true");
  for (const key of [
    "version",
    "sampleIntervalSeconds",
    "reportIntervalSeconds",
    "minThreshold",
    "maxThreshold",
    "alarmDelaySeconds",
    "recoveryDelaySeconds",
    "hysteresis",
  ]) {
    assert(key in body, `esperaba el campo ${key} en la respuesta`);
  }
});

await check("config: dispositivo inexistente -> 404", async () => {
  const { status } = await get("/api/mide/config?deviceId=mide-no-existe-9999");
  assert(status === 404, `esperaba 404, recibí ${status}`);
});

await check("config: dispositivo inactivo -> 403", async () => {
  const { status } = await get(`/api/mide/config?deviceId=${encodeURIComponent(inactiveDeviceId)}`);
  assert(status === 403, `esperaba 403, recibí ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
