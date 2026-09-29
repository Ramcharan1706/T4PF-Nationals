from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Speech Therapy API"
    environment: str = "development"
    demo_mode: bool = False  # test-only in this build; runtime uses SQLite by default
    database_backend: str = "sqlite"
    local_db_path: str | None = None
    audio_storage_path: str | None = None
    jwt_secret: str = "sound-buddy-dev-secret-change-me"
    access_token_minutes: int = 720
    seed_password: str = "SoundBuddy@2026!"
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    supabase_service_role_key: str | None = None
    gemini_api_key: str | None = None
    azure_speech_key: str | None = None
    azure_speech_region: str | None = None
    azure_speech_language: str = "en-US"
    whisper_model: str = "base"
    cors_origins: str = "http://localhost:5173"
    cors_origin_regex: str | None = r"^https://([a-z0-9-]+\.)?ngrok(-free)?\.(dev|app)$"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.casefold() in {"production", "prod"}

    def validate_runtime(self) -> None:
        if self.database_backend.casefold() not in {"sqlite", "supabase", "memory"}:
            raise RuntimeError("DATABASE_BACKEND must be sqlite, supabase, or memory")
        if self.is_production and self.demo_mode:
            raise RuntimeError("DEMO_MODE must be false in production")
        if self.is_production and (not self.jwt_secret or self.jwt_secret.startswith("sound-buddy-")):
            raise RuntimeError("JWT_SECRET must be explicitly configured in production")
        if self.is_production and self.database_backend.casefold() != "supabase":
            raise RuntimeError("Production deployments must use DATABASE_BACKEND=supabase")
        if self.is_production and not all((self.supabase_url, self.supabase_anon_key, self.supabase_service_role_key)):
            raise RuntimeError("Production deployments require SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY")
        if self.is_production and not any(origin.startswith("https://") for origin in self.cors_origin_list):
            raise RuntimeError("Production CORS_ORIGINS must include an HTTPS origin")


settings = Settings()
