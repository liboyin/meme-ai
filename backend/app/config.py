from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o"
    db_path: str = "memes.db"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
