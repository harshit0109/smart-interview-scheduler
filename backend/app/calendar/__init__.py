"""Google Calendar connection + free/busy retrieval.

Entirely separate from the identity-login OAuth in `app/auth/`: its own OAuth
client config, Calendar-only scopes, encrypted token storage. All outbound
Google HTTP goes through the single seam in `client.py` so tests can mock it.
"""
