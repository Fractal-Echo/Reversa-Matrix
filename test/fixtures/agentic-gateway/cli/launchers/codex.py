FCC_CODEX_API_KEY = "example-redacted"


def build_codex_config():
    stripped = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"]
    return {
        "model_provider": "fcc",
        "model_catalog_json": "~/.fcc/codex-models.json",
        "stripped": stripped,
    }
