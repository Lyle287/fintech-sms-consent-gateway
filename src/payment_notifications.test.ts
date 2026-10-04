import assert from "node:assert/strict";
import test from "node:test";
import {
  notifyPaymentEvent,
  SuppressionRegistry,
  type NotificationDecision,
  type SmsSender,
} from "./payment_notifications.js";

test("a suppressed high-risk payment event is audited without sending", async () => {
  const phone = "+14155550123";
  const suppressions = new SuppressionRegistry();
  suppressions.add(phone);
  const sent: unknown[] = [];
  const records: NotificationDecision[] = [];
  const sender: SmsSender = {
    async send(messages, idempotencyKey) {
      sent.push({ messages, idempotencyKey });
      return {};
    },
  };

  const result = await notifyPaymentEvent(
    {
      eventId: "evt-transfer-42",
      accountRef: "acct-7",
      phone,
      kind: "transfer_reversed",
      occurredAt: "2026-09-29T08:00:00.000Z",
      smsConsent: true,
    },
    {
      suppressions,
      sender,
      audit: { record: (entry) => records.push(entry) },
      now: () => new Date("2026-09-29T08:01:00.000Z"),
    },
  );

  assert.deepEqual(result, {
    eventId: "evt-transfer-42",
    decision: "suppressed",
    reason: "suppression_list",
    risk: "attention",
    decidedAt: "2026-09-29T08:01:00.000Z",
  });
  assert.equal(sent.length, 0);
  assert.deepEqual(records, [result]);
});
