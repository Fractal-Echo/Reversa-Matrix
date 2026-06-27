def create_response(request):
    """Bridge OpenAI Responses and Anthropic Messages."""
    route = "/v1/responses"
    compat = "/v1/messages"
    stream = "SSE tool_use tool_result thinking block"
    return route, compat, stream
