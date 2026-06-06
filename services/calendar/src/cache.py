import json
import os
from typing import Any, Optional
import redis.asyncio as aioredis

_client: Optional[aioredis.Redis] = None


def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(
            os.environ.get('REDIS_URL', 'redis://localhost:6379'),
            decode_responses=True,
        )
    return _client


def _key(jurisdiction: str, year: int) -> str:
    return f'rrc:windows:{jurisdiction}:{year}'


async def get_windows_cached(jurisdiction: str, year: int) -> Optional[list]:
    r = get_redis()
    data = await r.get(_key(jurisdiction, year))
    if data is None:
        return None
    return json.loads(data)


async def set_windows_cache(jurisdiction: str, year: int, data: list, ttl: int = 86400) -> None:
    r = get_redis()
    await r.set(_key(jurisdiction, year), json.dumps(data, default=str), ex=ttl)


async def invalidate_windows_cache(jurisdiction: str, year: int) -> None:
    r = get_redis()
    await r.delete(_key(jurisdiction, year))
