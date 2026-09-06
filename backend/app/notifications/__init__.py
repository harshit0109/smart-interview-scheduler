"""Booking-confirmation email (FR-030).

Confirmation only — reminders, decline/cancel notices and SMS/WhatsApp are out of
scope. Triggered internally by the booking service after the Postgres commit; a
failure here never rolls back or affects booking success. Every successful
booking produces exactly one `notification_logs` row (SENT / FAILED / SIMULATED).
"""
