"""Booking & conflict prevention (requirements.md §10 — the MVP acceptance gate).

Redis lock -> revalidate -> conflict check -> create Calendar event OUTSIDE any DB
transaction -> Postgres-only persist -> commit -> release lock. Calendar-vs-DB
consistency is a compensating-action sequence, never a distributed transaction.
"""
