from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderDescriptor:
    provider_id: str
    credential_env: str
    capabilities: tuple[str, ...]


PROVIDER_CATALOG = {
    "nvidia_nim": ProviderDescriptor(
        provider_id="nvidia_nim",
        credential_env="NVIDIA_NIM_API_KEY",
        capabilities=("chat", "streaming", "tools", "thinking"),
    ),
    "open_router": ProviderDescriptor(
        provider_id="open_router",
        credential_env="OPENROUTER_API_KEY",
        capabilities=("chat", "streaming", "tools"),
    ),
}
