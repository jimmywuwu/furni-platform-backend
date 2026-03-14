import os


def get_env(*keys: str, default: str | None = None) -> str | None:
    for key in keys:
        value = os.getenv(key)
        if value is None:
            continue
        value = value.strip()
        if value:
            return value
    return default


def require_env(*keys: str) -> str:
    value = get_env(*keys)
    if value:
        return value
    raise RuntimeError(f"Missing required environment variable: {' / '.join(keys)}")
