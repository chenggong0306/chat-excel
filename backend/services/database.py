import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey, Enum as SQLEnum, JSON, LargeBinary, text
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

load_dotenv()

# 数据库连接配置
DATABASE_URL = os.getenv("CHAT_HISTORY_DB_URL", "mysql+aiomysql://root:YKHCQ1w2e3!@192.168.132.104:3307/nai_dx")

# 创建异步引擎 - 生产级连接池配置
engine = create_async_engine(
    DATABASE_URL,
    echo=False,  # 生产环境关闭 SQL 日志
    pool_pre_ping=True,  # 连接前检测是否可用
    pool_size=20,  # 常驻连接数
    max_overflow=30,  # 峰值额外连接（总共最多 50 连接）
    pool_recycle=3600,  # 1小时回收连接，防止 MySQL 超时断开
    pool_timeout=30,  # 获取连接超时时间
)

# 创建异步会话工厂
async_session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class MessageRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class UploadedFile(Base):
    """上传文件表 - 存储文件数据到 MySQL"""
    __tablename__ = "uploaded_files"

    id = Column(String(36), primary_key=True, comment="文件ID")
    filename = Column(String(255), nullable=False, comment="原始文件名")
    columns = Column(JSON, nullable=True, comment="列名数组")
    rows = Column(Integer, nullable=True, comment="数据行数")
    data = Column(LargeBinary(length=16777215), nullable=True, comment="文件二进制数据(MEDIUMBLOB)")
    file_type = Column(String(10), nullable=True, comment="文件类型: xlsx/xls/csv")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")


class ChatSession(Base):
    """对话会话表"""
    __tablename__ = "chat_sessions"

    id = Column(String(36), primary_key=True)
    title = Column(String(255), nullable=True, comment="会话标题")
    file_ids = Column(JSON, nullable=True, comment="关联的文件ID数组")
    file_metadata = Column(JSON, nullable=True, comment="文件元信息：[{file_id, filename, sheet_names, selected_sheets}]")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, comment="更新时间")

    # 关联消息
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    """对话消息表"""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(SQLEnum(MessageRole), nullable=False, comment="消息角色: user/assistant/system")
    content = Column(Text, nullable=False, comment="消息内容")
    chart_config = Column(Text, nullable=True, comment="图表配置JSON")
    thinking = Column(Text, nullable=True, comment="思考过程")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")

    # 关联会话
    session = relationship("ChatSession", back_populates="messages")


async def init_db():
    """初始化数据库，创建所有表"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 执行数据库迁移
    await run_migrations()


async def run_migrations():
    """执行数据库迁移 - 添加缺失的列"""
    async with async_session_maker() as session:
        try:
            # 检查 file_metadata 列是否存在
            result = await session.execute(
                text("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'chat_sessions' AND COLUMN_NAME = 'file_metadata'")
            )
            exists = result.scalar()

            if not exists:
                # 添加 file_metadata 列
                await session.execute(
                    text("ALTER TABLE chat_sessions ADD COLUMN file_metadata JSON NULL COMMENT '文件元信息'")
                )
                await session.commit()
                print("Migration: Added 'file_metadata' column to chat_sessions table")
            else:
                print("Migration: 'file_metadata' column already exists")
        except Exception as e:
            print(f"Migration error: {e}")
            await session.rollback()


async def get_session() -> AsyncSession:
    """获取数据库会话"""
    async with async_session_maker() as session:
        yield session

