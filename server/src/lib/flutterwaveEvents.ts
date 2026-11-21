/**
 * A VUE Flutterwave webhook-event persistence helper.
 * Shared by the webhook route and the pending-payment verify fallback so both
 * derive the same event_id and use the same background processing path.
 */

import { runInBackground } from './background.js';
import { writerPool } from './db.js';
import { processWebhookEvent } from './jobs.js';

export interface FlutterwaveEventRecordResult {
  inserted: boolean;
  eventId: string;
}

export function deriveFlutterwaveEventId(payload: any): string {
  return (
    payload?.id?.toString() ||
    payload?.data?.id?.toString() ||
    `evt_${payload?.data?.tx_ref}_${Date.now()}`
  );
}

function deriveFlutterwaveEventType(payload: any): string {
  return payload?.event || payload?.['event.type'] || 'charge.completed';
}

export async function recordAndQueueFlutterwaveEvent(
  payload: any,
): Promise<FlutterwaveEventRecordResult> {
  const eventId = deriveFlutterwaveEventId(payload);
  const eventType = deriveFlutterwaveEventType(payload);

  const insertRes = await writerPool.query(
    `INSERT INTO webhook_events (provider, event_id, event_type, payload, status)
     VALUES ('flutterwave', $1, $2, $3, 'received')
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType, JSON.stringify(payload)],
  );

  if (insertRes.rows.length === 0) {
    return { inserted: false, eventId };
  }

  runInBackground('webhook-process', async () => {
    await processWebhookEvent(eventId);
  });

  return { inserted: true, eventId };
}
