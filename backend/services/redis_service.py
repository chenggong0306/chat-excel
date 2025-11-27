"""
Redis 缓存服务 - 替代内存缓存，支持多进程共享
"""
import os
import pickle
import hashlib
from typing import Optional
import redis.asyncio as redis
from dotenv import load_dotenv

load_dotenv()

# Redis 配置
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)
REDIS_DB = int(os.getenv("REDIS_DB", 0))

# 创建 Redis 连接池
redis_pool = redis.ConnectionPool(
    host=REDIS_HOST,
    port=REDIS_PORT,
    password=REDIS_PASSWORD,
    db=REDIS_DB,
    max_connections=50,
    decode_responses=False,  # 二进制模式，支持 pickle
)

# Redis 客户端
redis_client = redis.Redis(connection_pool=redis_pool)

# 缓存过期时间（秒）
CACHE_TTL = 3600  # 1小时


async def get_cached_dataframe(file_id: str) -> Optional[bytes]:
    """
    从 Redis 获取缓存的 DataFrame（pickle 序列化后的二进制）
    """
    try:
        data = await redis_client.get(f"df:{file_id}")
        return data
    except Exception as e:
        print(f"Redis get error: {e}")
        return None


async def set_cached_dataframe(file_id: str, df_bytes: bytes, ttl: int = CACHE_TTL):
    """
    缓存 DataFrame 到 Redis
    """
    try:
        await redis_client.setex(f"df:{file_id}", ttl, df_bytes)
    except Exception as e:
        print(f"Redis set error: {e}")


async def delete_cached_dataframe(file_id: str):
    """
    删除缓存的 DataFrame
    """
    try:
        await redis_client.delete(f"df:{file_id}")
    except Exception as e:
        print(f"Redis delete error: {e}")


async def get_cached_session_messages(session_id: str) -> Optional[list]:
    """
    从 Redis 获取缓存的会话消息
    """
    try:
        data = await redis_client.get(f"session:{session_id}:messages")
        if data:
            return pickle.loads(data)
        return None
    except Exception as e:
        print(f"Redis get session error: {e}")
        return None


async def set_cached_session_messages(session_id: str, messages: list, ttl: int = 1800):
    """
    缓存会话消息到 Redis（30分钟过期）
    """
    try:
        await redis_client.setex(f"session:{session_id}:messages", ttl, pickle.dumps(messages))
    except Exception as e:
        print(f"Redis set session error: {e}")


async def invalidate_session_cache(session_id: str):
    """
    使会话缓存失效
    """
    try:
        await redis_client.delete(f"session:{session_id}:messages")
    except Exception as e:
        print(f"Redis invalidate error: {e}")


async def check_redis_connection() -> bool:
    """
    检查 Redis 连接是否正常
    """
    try:
        await redis_client.ping()
        return True
    except Exception as e:
        print(f"Redis connection error: {e}")
        return False


async def close_redis():
    """
    关闭 Redis 连接
    """
    await redis_client.close()

