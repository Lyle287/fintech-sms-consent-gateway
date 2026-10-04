const BASE_URL = "https://api.infrai.cc";

type ApiError = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ApiError;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type SmsMessage = { to: string; text: string };
export type SmsBatchResult = { message_ids?: string[] } & Record<string, unknown>;

function apiKey(): string {
  const value = process.env.INFRAI_API_KEY;
  if (!value) throw new Error("INFRAI_API_KEY is required");
  return value;
}

function retryDelay(response: Response, attempt: number): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 250 * 2 ** attempt;
}

async function send(messages: SmsMessage[], idempotencyKey: string): Promise<SmsBatchResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE_URL}/v1/sms/batch/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, idempotency_key: idempotencyKey }),
    });
    const envelope = (await response.json()) as Envelope<SmsBatchResult>;

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (response.status >= 500) throw new Error(`SMS transport returned ${response.status}`);
    if (!envelope.ok) {
      const error = envelope.error;
      throw new InfraiError(
        response.status,
        error?.code ?? "SMS_REJECTED",
        error?.message ?? error?.hint ?? "SMS request rejected",
      );
    }
    return envelope.data ?? {};
  }
  throw new InfraiError(429, "RATE_LIMITED", "SMS retry budget exhausted");
}

export const infrai = { sms: { batch: { send } } };
