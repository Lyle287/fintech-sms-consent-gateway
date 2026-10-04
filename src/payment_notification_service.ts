import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiError } from "./infrai_sms.js";
import {
  notifyPaymentEvent,
  SuppressionRegistry,
  type AuditSink,
} from "./payment_notifications.js";

const suppressions = new SuppressionRegistry();
const auditLog: unknown[] = [];
const audit: AuditSink = { record: (entry) => auditLog.push(entry) };
const optOutBody = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) });

async function readJson(request: AsyncIterable<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/sms-opt-outs") {
      const { phone } = optOutBody.parse(await readJson(request));
      suppressions.add(phone);
      return json(response, 201, { phone, suppressed: true });
    }
    if (request.method === "POST" && request.url === "/payment-events") {
      const result = await notifyPaymentEvent(await readJson(request), { suppressions, audit });
      return json(response, 200, result);
    }
    if (request.method === "GET" && request.url === "/audit-log") {
      return json(response, 200, { entries: auditLog });
    }
    return json(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof z.ZodError) return json(response, 400, { error: "invalid_body", issues: error.issues });
    if (error instanceof SyntaxError) return json(response, 400, { error: "invalid_json" });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.code, message: error.message });
    }
    return json(response, 502, { error: "delivery_error" });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`payment notification service listening on ${port}`));
}
