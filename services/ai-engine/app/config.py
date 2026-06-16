"""Environment configuration via pydantic-settings.

All knobs come from the process environment (see project .env.example). Nothing
is hardcoded; missing provider keys are tolerated and handled gracefully at
runtime by the relevant provider (log + fallback).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- HTTP control API ----
    ai_engine_port: int = Field(default=8080, alias="AI_ENGINE_PORT")
    ai_engine_host: str = Field(default="0.0.0.0", alias="AI_ENGINE_HOST")

    # ---- AudioSocket TCP server ----
    audiosocket_host: str = Field(default="0.0.0.0", alias="AUDIOSOCKET_HOST")
    audiosocket_port: int = Field(default=9092, alias="AUDIOSOCKET_PORT")

    # ---- Datastores ----
    database_url: str = Field(default="", alias="DATABASE_URL")
    redis_url: str = Field(default="", alias="REDIS_URL")

    # Shared secret for the internal control API. When set, mutating routes
    # require header `x-internal-key`. The engine also has no published ports
    # (reached only over the private docker network), so this is defense-in-depth.
    internal_api_key: str = Field(default="", alias="INTERNAL_API_KEY")

    # ---- LLM (Claude) ----
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    llm_model: str = Field(default="claude-opus-4-8", alias="LLM_MODEL")
    # effort favors latency for voice turns by default
    llm_effort: Literal["low", "medium", "high", "max"] = Field(
        default="low", alias="LLM_EFFORT"
    )
    llm_max_tokens: int = Field(default=1024, alias="LLM_MAX_TOKENS")

    # ---- STT ----
    stt_provider: Literal["deepgram", "openai", "whisper-local"] = Field(
        default="deepgram", alias="STT_PROVIDER"
    )
    deepgram_api_key: str = Field(default="", alias="DEEPGRAM_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    # ---- TTS ----
    tts_provider: Literal["elevenlabs", "openai", "azure", "piper-local"] = Field(
        default="elevenlabs", alias="TTS_PROVIDER"
    )
    elevenlabs_api_key: str = Field(default="", alias="ELEVENLABS_API_KEY")
    elevenlabs_voice_id: str = Field(
        default="21m00Tcm4TlvDq8ikWAM", alias="ELEVENLABS_VOICE_ID"
    )
    azure_tts_key: str = Field(default="", alias="AZURE_TTS_KEY")
    azure_tts_region: str = Field(default="", alias="AZURE_TTS_REGION")

    # ---- Object storage (DO Spaces / S3) ----
    s3_endpoint: str = Field(default="", alias="S3_ENDPOINT")
    s3_region: str = Field(default="", alias="S3_REGION")
    s3_bucket: str = Field(default="", alias="S3_BUCKET")
    s3_access_key: str = Field(default="", alias="S3_ACCESS_KEY")
    s3_secret_key: str = Field(default="", alias="S3_SECRET_KEY")
    s3_force_path_style: bool = Field(default=False, alias="S3_FORCE_PATH_STYLE")

    # ---- Audio constants ----
    # Asterisk AudioSocket carries 8kHz mono signed-linear 16-bit PCM (slin).
    asterisk_sample_rate: int = 8000
    # Most cloud STT/TTS providers work best at 16kHz.
    provider_sample_rate: int = 16000
    # 20ms frame @ 8kHz mono 16-bit = 160 samples * 2 bytes = 320 bytes.
    out_frame_bytes: int = 320

    @property
    def llm_configured(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()
