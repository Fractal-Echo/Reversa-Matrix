# Voice Companion Lane

VOICE_TRANSCRIPTION_LOCAL_ONLY=true
VOICE_RETENTION_POLICY=metadata-only
TRANSCRIPTION_BACKEND=faster-whisper
STT_ENGINE=Whisper
TTS_ENGINE=disabled
AUDIO_CAPTURE=consent-gated

Voice note intake stores metadata, duration, language detection, and redacted
transcript text. Raw audio capture must stay local and must not be committed.
The transcription queue uses a bounded local worker and writes evidence hashes
instead of message audio.

