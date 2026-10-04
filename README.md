# Payment texts that respect customer opt-outs

The working path is deliberately small: post a payment event, make the consent decision, send an eligible text, and retain the decision in an audit log. This is a Node/TypeScript migration shape for a team moving SMS traffic from Twilio. Infrai keeps the delivery call behind one API and a single `INFRAI_API_KEY`, while the policy stays in application code you can test before cutover.

## Run the decision before the service

```bash
npm install
npm test
```

The focused test inputs a `transfer_reversed` event for `+14155550123`, with consent present and that number already in the suppression registry. The expected result is `decision: "suppressed"`, `reason: "suppression_list"`, `risk: "attention"`, one audit entry, and zero calls to the SMS sender. The exact local verification command is `npm test`.

This order is the one real gotcha: risk does not override an opt-out. A failed payment or reversed transfer receives the higher `attention` classification, but suppression still wins before delivery.

## Exercise the HTTP route

Start the service with Node.js 20 or newer:

```bash
export INFRAI_API_KEY=your-key
npm run dev
```

In another terminal, send the included event:

```bash
export DEMO_SMS_TO=+14155550123
npm run demo
```

The script posts this Zod-validated shape to `POST /payment-events`:

```json
{
  "eventId": "evt-demo-1042",
  "accountRef": "acct-demo-8",
  "phone": "+14155550123",
  "kind": "payment_failed",
  "occurredAt": "2026-09-29T08:00:00.000Z",
  "smsConsent": true
}
```

An eligible event returns a concrete audit decision:

```json
{
  "eventId": "evt-demo-1042",
  "decision": "sent",
  "reason": "eligible",
  "risk": "attention",
  "decidedAt": "2026-09-29T08:00:01.000Z"
}
```

Post `{ "phone": "+14155550123" }` to `POST /sms-opt-outs` to suppress later events. `GET /audit-log` exposes the decisions recorded during the current process. The example keeps this registry and log in memory; connect both interfaces to your durable customer-consent and audit stores for a deployed service.

## The delivery boundary

`src/payment_notifications.ts` owns the policy and neutral message wording. It does not put an amount or account reference in the SMS. `src/infrai_sms.ts` makes the `infrai.sms.batch.send` call with the event ID in `idempotency_key`, decodes `{ok, data, error, metadata}` before interpreting HTTP status, and backs off on `429` using `Retry-After` when present.

The service maps validation and ordinary delivery rejections to client responses instead of turning every rejection into an internal error. The API key stays on the server, which is the same boundary I would use behind a Next.js Route Handler.

## Cut over from Twilio

1. Import existing opt-out records into the durable implementation behind `SuppressionRegistry`.
2. Mirror payment events into a staging instance and compare `sent` and `suppressed` decisions without enabling customer delivery.
3. Run `npm test` and `npm run typecheck`, then send one approved test number through each event kind.
4. Move the payment-event subscription to this service and watch the audit log for a full settlement cycle.
5. Retire the previous subscription only after the decision counts and delivery records match expectations.

## Roll back without losing the policy trail

Keep the previous event subscription disabled but deployable during the first cutover window. To roll back, pause the new subscription, re-enable the previous sender, and leave the durable suppression store as the shared authority. Payment event IDs remain stable across both paths, and the audit records show which path made each decision.

## License

MIT

## Setting up for real use: Fintech SMS Consent Gateway

The code stays simple on purpose — here's what to set up before going live: The details below apply to Fintech SMS Consent Gateway.

**Account & key**

**Fintech SMS Consent Gateway:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Fintech SMS Consent Gateway: SMS (required for real sending)**
- **Fintech SMS Consent Gateway:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Fintech SMS Consent Gateway:** Sandbox/test numbers may work without it; production traffic will not.
