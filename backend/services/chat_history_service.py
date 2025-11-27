import uuid
import json
import pickle
from typing import Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from sqlalchemy.orm import selectinload

from .database import ChatSession, ChatMessage, MessageRole, UploadedFile, async_session_maker
from .redis_service import redis_client

# 缓存过期时间
SESSIONS_CACHE_TTL = 60  # 会话列表缓存 60 秒
SESSION_DETAIL_CACHE_TTL = 300  # 会话详情缓存 5 分钟


class ChatHistoryService:
    """对话历史服务"""

    @staticmethod
    async def create_session(file_ids: Optional[List[str]] = None, title: Optional[str] = None) -> ChatSession:
        """创建新的对话会话"""
        async with async_session_maker() as session:
            chat_session = ChatSession(
                id=str(uuid.uuid4()),
                file_ids=file_ids or [],
                title=title or "新对话"
            )
            session.add(chat_session)
            await session.commit()
            await session.refresh(chat_session)

            # 使会话列表缓存失效
            await ChatHistoryService._invalidate_sessions_cache()

            return chat_session

    @staticmethod
    async def _invalidate_sessions_cache():
        """使所有会话列表缓存失效"""
        try:
            # 删除所有以 sessions:list: 开头的缓存
            async for key in redis_client.scan_iter(match="sessions:list:*"):
                await redis_client.delete(key)
        except Exception:
            pass

    @staticmethod
    async def get_session(session_id: str) -> Optional[ChatSession]:
        """获取会话信息（带 Redis 缓存）"""
        cache_key = f"session:detail:{session_id}"

        # 尝试从 Redis 获取缓存
        try:
            cached = await redis_client.get(cache_key)
            if cached:
                return pickle.loads(cached)
        except Exception:
            pass

        # 从数据库查询
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatSession)
                .options(selectinload(ChatSession.messages))
                .where(ChatSession.id == session_id)
            )
            chat_session = result.scalar_one_or_none()

            # 写入 Redis 缓存
            if chat_session:
                try:
                    await redis_client.setex(
                        cache_key,
                        SESSION_DETAIL_CACHE_TTL,
                        pickle.dumps(chat_session)
                    )
                except Exception:
                    pass

            return chat_session

    @staticmethod
    async def get_all_sessions() -> List[ChatSession]:
        """获取所有会话列表"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatSession).order_by(desc(ChatSession.updated_at))
            )
            return result.scalars().all()

    @staticmethod
    async def get_sessions_paginated(
        page: int = 1,
        limit: int = 9,
        search: Optional[str] = None
    ) -> Tuple[List[ChatSession], int]:
        """分页获取会话列表，支持搜索（带 Redis 缓存）"""
        # 构建缓存 key
        cache_key = f"sessions:list:{page}:{limit}:{search or ''}"

        # 尝试从 Redis 获取缓存
        try:
            cached = await redis_client.get(cache_key)
            if cached:
                data = pickle.loads(cached)
                return data["sessions"], data["total"]
        except Exception:
            pass

        # 从数据库查询
        async with async_session_maker() as session:
            # 基础查询
            query = select(ChatSession)
            count_query = select(func.count(ChatSession.id))

            # 搜索过滤
            if search:
                search_pattern = f"%{search}%"
                query = query.where(ChatSession.title.ilike(search_pattern))
                count_query = count_query.where(ChatSession.title.ilike(search_pattern))

            # 获取总数
            total_result = await session.execute(count_query)
            total = total_result.scalar() or 0

            # 分页查询
            offset = (page - 1) * limit
            query = query.order_by(desc(ChatSession.updated_at)).offset(offset).limit(limit)

            result = await session.execute(query)
            sessions = list(result.scalars().all())

            # 写入 Redis 缓存
            try:
                await redis_client.setex(
                    cache_key,
                    SESSIONS_CACHE_TTL,
                    pickle.dumps({"sessions": sessions, "total": total})
                )
            except Exception:
                pass

            return sessions, total

    @staticmethod
    async def get_session_with_message_count(session_id: str) -> Optional[dict]:
        """获取会话信息及消息数量"""
        async with async_session_maker() as session:
            # 获取会话
            result = await session.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            chat_session = result.scalar_one_or_none()
            if not chat_session:
                return None

            # 获取消息数量
            count_result = await session.execute(
                select(func.count(ChatMessage.id)).where(ChatMessage.session_id == session_id)
            )
            message_count = count_result.scalar() or 0

            return {
                "session": chat_session,
                "message_count": message_count
            }

    @staticmethod
    async def delete_session(session_id: str) -> bool:
        """删除会话"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            chat_session = result.scalar_one_or_none()
            if chat_session:
                await session.delete(chat_session)
                await session.commit()

                # 使缓存失效
                try:
                    await redis_client.delete(f"session:detail:{session_id}")
                    await ChatHistoryService._invalidate_sessions_cache()
                except Exception:
                    pass

                return True
            return False

    @staticmethod
    async def add_message(
        session_id: str,
        role: MessageRole,
        content: str,
        chart_config: Optional[dict] = None,
        thinking: Optional[str] = None
    ) -> ChatMessage:
        """添加消息到会话"""
        async with async_session_maker() as session:
            message = ChatMessage(
                session_id=session_id,
                role=role,
                content=content,
                chart_config=json.dumps(chart_config) if chart_config else None,
                thinking=thinking
            )
            session.add(message)
            await session.commit()
            await session.refresh(message)

            # 使会话详情缓存失效
            try:
                await redis_client.delete(f"session:detail:{session_id}")
            except Exception:
                pass

            return message

    @staticmethod
    async def get_session_messages(session_id: str, limit: int = 20) -> List[ChatMessage]:
        """获取会话的历史消息"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at)
                .limit(limit)
            )
            return result.scalars().all()

    @staticmethod
    async def update_session_title(session_id: str, title: str) -> bool:
        """更新会话标题"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            chat_session = result.scalar_one_or_none()
            if chat_session:
                chat_session.title = title
                await session.commit()
                return True
            return False

    @staticmethod
    async def update_session_files(session_id: str, file_ids: List[str]) -> bool:
        """更新会话关联的文件列表"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            chat_session = result.scalar_one_or_none()
            if chat_session:
                chat_session.file_ids = file_ids
                await session.commit()
                return True
            return False

    @staticmethod
    async def add_session_file(session_id: str, file_id: str) -> bool:
        """向会话添加一个文件"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            chat_session = result.scalar_one_or_none()
            if chat_session:
                current_files = chat_session.file_ids or []
                if file_id not in current_files:
                    current_files.append(file_id)
                    chat_session.file_ids = current_files
                    await session.commit()
                return True
            return False


class FileStorageService:
    """文件存储服务 - 使用 MySQL 存储"""

    @staticmethod
    async def save_file(
        file_id: str,
        filename: str,
        data: bytes,
        columns: List[str],
        rows: int,
        file_type: str
    ) -> UploadedFile:
        """保存文件到数据库"""
        async with async_session_maker() as session:
            uploaded_file = UploadedFile(
                id=file_id,
                filename=filename,
                data=data,
                columns=columns,
                rows=rows,
                file_type=file_type
            )
            session.add(uploaded_file)
            await session.commit()
            await session.refresh(uploaded_file)
            return uploaded_file

    @staticmethod
    async def get_file(file_id: str) -> Optional[UploadedFile]:
        """获取文件信息"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(UploadedFile).where(UploadedFile.id == file_id)
            )
            return result.scalar_one_or_none()

    @staticmethod
    async def get_files(file_ids: List[str]) -> List[UploadedFile]:
        """批量获取多个文件"""
        if not file_ids:
            return []
        async with async_session_maker() as session:
            result = await session.execute(
                select(UploadedFile).where(UploadedFile.id.in_(file_ids))
            )
            return result.scalars().all()

    @staticmethod
    async def delete_file(file_id: str) -> bool:
        """删除文件"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(UploadedFile).where(UploadedFile.id == file_id)
            )
            uploaded_file = result.scalar_one_or_none()
            if uploaded_file:
                await session.delete(uploaded_file)
                await session.commit()
                return True
            return False


class ChartService:
    """图表服务"""

    @staticmethod
    async def get_all_charts(
        page: int = 1,
        limit: int = 9
    ) -> Tuple[List[dict], int]:
        """获取所有保存的图表（从消息中提取有 chart_config 的记录）"""
        async with async_session_maker() as session:
            # 查询有图表配置的消息
            query = (
                select(ChatMessage, ChatSession.title)
                .join(ChatSession, ChatMessage.session_id == ChatSession.id)
                .where(ChatMessage.chart_config.isnot(None))
                .where(ChatMessage.role == MessageRole.ASSISTANT)
                .order_by(desc(ChatMessage.created_at))
            )

            # 获取总数
            count_query = (
                select(func.count(ChatMessage.id))
                .where(ChatMessage.chart_config.isnot(None))
                .where(ChatMessage.role == MessageRole.ASSISTANT)
            )
            total_result = await session.execute(count_query)
            total = total_result.scalar() or 0

            # 分页
            offset = (page - 1) * limit
            query = query.offset(offset).limit(limit)

            result = await session.execute(query)
            rows = result.all()

            charts = []
            for msg, session_title in rows:
                chart_config = None
                if msg.chart_config:
                    try:
                        chart_config = json.loads(msg.chart_config)
                    except json.JSONDecodeError:
                        continue

                charts.append({
                    "id": msg.id,
                    "session_id": msg.session_id,
                    "session_title": session_title or "未命名对话",
                    "chart_config": chart_config,
                    "created_at": msg.created_at.isoformat() if msg.created_at else None
                })

            return charts, total

    @staticmethod
    async def delete_chart(message_id: int) -> bool:
        """删除图表（清除消息的 chart_config）"""
        async with async_session_maker() as session:
            result = await session.execute(
                select(ChatMessage).where(ChatMessage.id == message_id)
            )
            message = result.scalar_one_or_none()
            if message:
                message.chart_config = None
                await session.commit()
                return True
            return False
