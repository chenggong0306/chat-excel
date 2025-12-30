"""
数据库迁移脚本 - 将 file_id 改为 file_ids，并创建 uploaded_files 表
"""
import asyncio
import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv()


DATABASE_URL = os.getenv("CHAT_HISTORY_DB_URL")
if not DATABASE_URL:
    raise ValueError("CHAT_HISTORY_DB_URL environment variable is required")

engine = create_async_engine(DATABASE_URL, echo=True)


async def migrate():
    async with engine.begin() as conn:
        # 1. 创建 uploaded_files 表（如果不存在）
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                id VARCHAR(36) PRIMARY KEY COMMENT '文件ID',
                filename VARCHAR(255) NOT NULL COMMENT '原始文件名',
                columns JSON COMMENT '列名数组',
                `rows` INT COMMENT '数据行数',
                data MEDIUMBLOB COMMENT '文件二进制数据',
                file_type VARCHAR(10) COMMENT '文件类型: xlsx/xls/csv',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        """))
        print("✓ uploaded_files 表已创建/确认存在")

        # 2. 检查 chat_sessions 表是否有 file_id 列
        result = await conn.execute(text("""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'chat_sessions' 
            AND COLUMN_NAME = 'file_id'
        """))
        has_file_id = result.fetchone() is not None

        # 3. 检查是否已有 file_ids 列
        result = await conn.execute(text("""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'chat_sessions' 
            AND COLUMN_NAME = 'file_ids'
        """))
        has_file_ids = result.fetchone() is not None

        if has_file_id and not has_file_ids:
            # 添加新列 file_ids
            await conn.execute(text("""
                ALTER TABLE chat_sessions 
                ADD COLUMN file_ids JSON COMMENT '关联的文件ID数组' AFTER title
            """))
            print("✓ 已添加 file_ids 列")

            # 迁移数据：将 file_id 转换为 file_ids 数组
            await conn.execute(text("""
                UPDATE chat_sessions 
                SET file_ids = JSON_ARRAY(file_id) 
                WHERE file_id IS NOT NULL AND file_id != ''
            """))
            print("✓ 已迁移 file_id 数据到 file_ids")

            # 删除旧列 file_id
            await conn.execute(text("""
                ALTER TABLE chat_sessions DROP COLUMN file_id
            """))
            print("✓ 已删除旧的 file_id 列")

        elif has_file_ids:
            print("✓ file_ids 列已存在，无需迁移")
        else:
            # 表结构不符合预期，可能需要手动处理
            print("⚠ 表结构异常，请手动检查")

    print("\n迁移完成！")


if __name__ == "__main__":
    asyncio.run(migrate())

