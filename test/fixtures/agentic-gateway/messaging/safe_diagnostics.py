def redact(value):
    if "TOKEN" in value or "SECRET" in value or "AUTH" in value:
        return "<redacted>"
    return value


MESSAGING_PLATFORM = "discord"
TELEGRAM_BOT_TOKEN = "example-redacted"
