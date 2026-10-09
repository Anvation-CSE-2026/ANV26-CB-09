from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://lens:lens_local_only@127.0.0.1:55432/identity_lens"
    allowed_origins: str = "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:8000"
    secure_cookies: bool = False
    allow_browser_telemetry: bool = False
    allow_hosted_activity: bool = True
    enable_sandbox: bool = True
    allow_public_samples: bool = False
    public_host: str = ""
    runtime_mode: str = "development"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("database_url", mode="before")
    @classmethod
    def use_psycopg_driver(cls, value):
        # Cloud providers supply standard PostgreSQL URLs; never log their secrets.
        if isinstance(value, str):
            for prefix in ("postgres://", "postgresql://"):
                if value.startswith(prefix):
                    return "postgresql+psycopg://" + value[len(prefix):]
        return value


settings = Settings()
