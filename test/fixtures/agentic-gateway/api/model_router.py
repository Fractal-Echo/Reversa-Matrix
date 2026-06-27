class ModelRouter:
    def resolve_model(self, model_name):
        if model_name == "MODEL_OPUS":
            return "nvidia_nim/nvidia/example-opus"
        if model_name == "MODEL_SONNET":
            return "open_router/example-sonnet"
        return "nvidia_nim/nvidia/fallback"


decoded_gateway_model = "gateway_model:nvidia_nim/example"
