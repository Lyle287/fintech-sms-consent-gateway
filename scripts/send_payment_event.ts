const serviceUrl = process.env.SERVICE_URL ?? "http://localhost:3000";

const response = await fetch(`${serviceUrl}/payment-events`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    eventId: "evt-demo-1042",
    accountRef: "acct-demo-8",
    phone: process.env.DEMO_SMS_TO ?? "+14155550123",
    kind: "payment_failed",
    occurredAt: new Date().toISOString(),
    smsConsent: true,
  }),
});

console.log(await response.json());
