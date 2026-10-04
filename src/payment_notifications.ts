import { z } from "zod";
import { infrai, type SmsBatchResult, type SmsMessage } from "./infrai_sms.js";

export const paymentEventBody = z.object({
  eventId: z.string().min(1).max(100),
  accountRef: z.string().min(1).max(100),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  kind: z.enum(["payment_settled", "payment_failed", "transfer_reversed"]),
  occurredAt: z.string().datetime(),
  smsConsent: z.boolean(),
});

export type PaymentEvent = z.infer<typeof paymentEventBody>;
export type NotificationDecision = {
  eventId: string;
  decision: "sent" | "suppressed";
  reason: "eligible" | "no_consent" | "suppression_list";
  risk: "routine" | "attention";
  decidedAt: string;
};

export interface SmsSender {
  send(messages: SmsMessage[], idempotencyKey: string): Promise<SmsBatchResult>;
}

export interface AuditSink {
  record(entry: NotificationDecision): void;
}

export class SuppressionRegistry {
  readonly #phones = new Set<string>();

  add(phone: string): void {
    this.#phones.add(phone);
  }

  has(phone: string): boolean {
    return this.#phones.has(phone);
  }
}

const messageByKind: Record<PaymentEvent["kind"], string> = {
  payment_settled: "Your payment was completed.",
  payment_failed: "Your payment needs attention. Open the app to review it.",
  transfer_reversed: "A transfer was reversed. Open the app to review the details.",
};

export async function notifyPaymentEvent(
  rawBody: unknown,
  dependencies: {
    suppressions: SuppressionRegistry;
    sender?: SmsSender;
    audit: AuditSink;
    now?: () => Date;
  },
): Promise<NotificationDecision> {
  const event = paymentEventBody.parse(rawBody);
  const risk = event.kind === "payment_settled" ? "routine" : "attention";
  const reason = !event.smsConsent
    ? "no_consent"
    : dependencies.suppressions.has(event.phone)
      ? "suppression_list"
      : "eligible";
  const decision: NotificationDecision = {
    eventId: event.eventId,
    decision: reason === "eligible" ? "sent" : "suppressed",
    reason,
    risk,
    decidedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  };

  if (decision.decision === "sent") {
    const messages = [{ to: event.phone, text: messageByKind[event.kind] }];
    const idempotencyKey = `payment-notification-${event.eventId}`;
    if (dependencies.sender) {
      await dependencies.sender.send(messages, idempotencyKey);
    } else {
      await infrai.sms.batch.send(messages, idempotencyKey);
    }
  }
  dependencies.audit.record(decision);
  return decision;
}
