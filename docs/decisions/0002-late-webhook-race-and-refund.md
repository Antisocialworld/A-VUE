# ADR 0002: Late Webhook Race Condition and Ledger Auto-Refund

## Status
Accepted

## Context
When a user begins checkout for cinema seats, A VUE reserves the seats with a 600-second (10-minute) Redis hold. The customer is redirected to Flutterwave to authorize payment. Under normal conditions, the payment is confirmed within 60–120 seconds, and the webhook confirms the booking.

However, edge cases occur:
1. A customer delays entering their card details or experiences network issues, authorizing payment after 605 seconds (after the hold has expired).
2. As soon as the hold expires, the seats become free and another customer reserves and immediately pays for the same seats.
3. The original customer's webhook then arrives, confirming that payment was collected for seats that are now occupied.

Because database uniqueness `uq_bookings_showtime_seat` strictly forbids double-booking the same seat, the second insert will fail.

## Decision
1. **Late Contention Resolution**:
   When the webhook processor receives a successful payment event, it attempts to insert rows into `bookings`.
   - If the insert fails with Postgres error code `23505` (`uq_bookings_showtime_seat`), the system detects that the original hold expired and the seats were claimed by an on-time buyer.
2. **Automated Refund & Immutable Ledger**:
   - The original payment is immediately updated to `status = 'refunded'`.
   - A record is inserted into the `refunds` table with unique reference `refund_late_race_{paymentId}`.
   - A debit movement `entry_type = 'refund_out'` is inserted into the append-only `ledger` table.
   - The user is notified via email of the seat conflict and immediate refund.

## Consequences
- **Positive**: Zero possibility of a double-sold seat. Mathematical ledger auditability guarantees every kobo collected is accounted for or refunded.
- **Negative**: The customer who authorized payment late does not receive tickets and must reselect available seats.

