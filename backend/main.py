from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from contextlib import asynccontextmanager
import pandas as pd
import pickle
import io
import uuid
import json
import warnings

# 抑制 openpyxl 的扩展警告
warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from services.llm_service import chat_with_context_multi_files, stream_chat_multi_files, extract_chart_config
from services.database import init_db, MessageRole
from services.chat_history_service import ChatHistoryService, FileStorageService, ChartService
from services.redis_service import (
    get_cached_dataframe,
    set_cached_dataframe,
    delete_cached_dataframe,
    check_redis_connection,
    close_redis,
)

# API 限流器
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化数据库
    await init_db()
    # 检查 Redis 连接
    redis_ok = await check_redis_connection()
    if redis_ok:
        print("✓ Redis 连接成功")
    else:
        print("⚠ Redis 连接失败，将使用本地缓存")
    yield
    # 关闭时清理资源
    await close_redis()


app = FastAPI(title="ChatExcel API", version="1.0.0", lifespan=lifespan)

# 添加限流异常处理
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 本地内存缓存（Redis 不可用时的降级方案）
local_file_cache: dict[str, pd.DataFrame] = {}


# 多轮对话相关模型
class ChatRequest(BaseModel):
    session_id: str
    message: str
    file_ids: Optional[List[str]] = None  # 改为支持多个文件


class ChatMessageResponse(BaseModel):
    role: str
    content: str
    chart_config: Optional[dict] = None


class ChatResponse(BaseModel):
    session_id: str
    message: ChatMessageResponse


class CreateSessionRequest(BaseModel):
    title: Optional[str] = None
    file_ids: Optional[List[str]] = None  # 改为支持多个文件


class SessionResponse(BaseModel):
    id: str
    title: Optional[str]
    file_ids: Optional[List[str]]  # 改为文件ID数组
    created_at: str
    updated_at: str


@app.get("/")
async def root():
    return {"message": "ChatExcel API is running"}


@app.post("/api/upload")
@limiter.limit("10/minute")  # 每分钟最多上传 10 个文件
async def upload_file(request: Request, file: UploadFile = File(...)):
    """
    上传 Excel 或 CSV 文件，存储到 MySQL
    返回文件ID、列名、行数、数据预览
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 检查文件类型
    allowed_extensions = [".xlsx", ".xls", ".csv"]
    file_ext = "." + file.filename.split(".")[-1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="只支持 Excel (.xlsx, .xls) 和 CSV (.csv) 文件")

    try:
        content = await file.read()

        # 解析文件
        if file_ext == ".csv":
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content))

        # 处理 NaN 值，替换为 None（JSON 可序列化）
        df = df.fillna("")

        # 生成文件ID
        file_id = str(uuid.uuid4())

        # 存储到 MySQL
        await FileStorageService.save_file(
            file_id=file_id,
            filename=file.filename,
            data=content,  # 存储原始文件内容
            columns=df.columns.tolist(),
            rows=len(df),
            file_type=file_ext.lstrip(".")
        )

        # 缓存 DataFrame 到 Redis（优先）或本地
        try:
            await set_cached_dataframe(file_id, pickle.dumps(df))
        except Exception:
            local_file_cache[file_id] = df

        # 预览数据
        preview_df = df.head(5).copy()
        preview = preview_df.to_dict(orient="records")

        return {
            "file_id": file_id,
            "filename": file.filename,
            "columns": df.columns.tolist(),
            "rows": len(df),
            "preview": preview
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件解析失败: {str(e)}")


async def get_dataframe(file_id: str) -> pd.DataFrame:
    """从缓存或数据库获取 DataFrame（优先 Redis，降级到本地缓存）"""
    # 1. 先检查本地缓存
    if file_id in local_file_cache:
        return local_file_cache[file_id]

    # 2. 检查 Redis 缓存
    try:
        cached_data = await get_cached_dataframe(file_id)
        if cached_data:
            df = pickle.loads(cached_data)
            return df
    except Exception:
        pass

    # 3. 从数据库加载
    uploaded_file = await FileStorageService.get_file(file_id)
    if not uploaded_file:
        raise HTTPException(status_code=404, detail=f"文件 {file_id} 不存在")

    # 解析文件
    if uploaded_file.file_type == "csv":
        df = pd.read_csv(io.BytesIO(uploaded_file.data))
    else:
        df = pd.read_excel(io.BytesIO(uploaded_file.data))

    df = df.fillna("")

    # 4. 写入缓存（优先 Redis）
    try:
        await set_cached_dataframe(file_id, pickle.dumps(df))
    except Exception:
        local_file_cache[file_id] = df

    return df


@app.get("/api/files/{file_id}")
async def get_file_info(file_id: str):
    """
    获取已上传文件的信息
    """
    df = await get_dataframe(file_id)
    preview_df = df.head(10).fillna("")

    # 获取文件元信息
    uploaded_file = await FileStorageService.get_file(file_id)

    return {
        "file_id": file_id,
        "filename": uploaded_file.filename if uploaded_file else None,
        "columns": df.columns.tolist(),
        "rows": len(df),
        "preview": preview_df.to_dict(orient="records")
    }


# ==================== 多轮对话 API ====================

@app.post("/api/sessions", response_model=SessionResponse)
async def create_session(req: CreateSessionRequest):
    """创建新的对话会话"""
    session = await ChatHistoryService.create_session(
        file_ids=req.file_ids,
        title=req.title
    )
    return SessionResponse(
        id=session.id,
        title=session.title,
        file_ids=session.file_ids,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat()
    )


@app.get("/api/sessions")
async def list_sessions(
    page: int = 1,
    limit: int = 9,
    search: Optional[str] = None
):
    """获取会话列表（支持分页和搜索）"""
    sessions, total = await ChatHistoryService.get_sessions_paginated(
        page=page,
        limit=limit,
        search=search
    )
    return {
        "items": [
            {
                "id": s.id,
                "title": s.title,
                "file_ids": s.file_ids,
                "created_at": s.created_at.isoformat(),
                "updated_at": s.updated_at.isoformat()
            }
            for s in sessions
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "has_more": page * limit < total
    }


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """获取会话详情及历史消息"""
    session = await ChatHistoryService.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    return {
        "id": session.id,
        "title": session.title,
        "file_ids": session.file_ids,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "messages": [
            {
                "id": m.id,
                "role": m.role.value,
                "content": m.content,
                "chart_config": json.loads(m.chart_config) if m.chart_config else None,
                "created_at": m.created_at.isoformat()
            }
            for m in session.messages
        ]
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """删除会话"""
    success = await ChatHistoryService.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"message": "会话已删除"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """多轮对话接口 - 支持多文件"""
    # 获取会话
    session = await ChatHistoryService.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 确定要使用的文件ID列表
    file_ids = req.file_ids or session.file_ids or []

    # 如果提供了新的文件，更新会话
    if req.file_ids and req.file_ids != session.file_ids:
        await ChatHistoryService.update_session_files(req.session_id, req.file_ids)

    # 获取多个文件的数据
    files_data = []
    for file_id in file_ids:
        try:
            df = await get_dataframe(file_id)
            uploaded_file = await FileStorageService.get_file(file_id)
            files_data.append({
                "file_id": file_id,
                "filename": uploaded_file.filename if uploaded_file else file_id,
                "columns": df.columns.tolist(),
                "data": df.to_string(index=False)
            })
        except Exception:
            continue  # 跳过无法加载的文件

    # 获取历史消息
    history_messages = [
        {"role": m.role.value, "content": m.content}
        for m in session.messages
    ]

    # 保存用户消息
    await ChatHistoryService.add_message(
        session_id=req.session_id,
        role=MessageRole.USER,
        content=req.message
    )

    try:
        # 调用 LLM（支持多文件）
        result = chat_with_context_multi_files(
            files_data=files_data,
            user_prompt=req.message,
            history_messages=history_messages
        )

        # 保存助手回复
        await ChatHistoryService.add_message(
            session_id=req.session_id,
            role=MessageRole.ASSISTANT,
            content=result["content"],
            chart_config=result.get("chart_config")
        )

        # 如果是第一条消息，更新会话标题
        if len(session.messages) == 0:
            title = req.message[:50] + ("..." if len(req.message) > 50 else "")
            await ChatHistoryService.update_session_title(req.session_id, title)

        return ChatResponse(
            session_id=req.session_id,
            message=ChatMessageResponse(
                role="assistant",
                content=result["content"],
                chart_config=result.get("chart_config")
            )
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"对话失败: {str(e)}")


@app.post("/api/chat/stream")
@limiter.limit("20/minute")  # 每分钟最多 20 次对话请求
async def chat_stream(request: Request, req: ChatRequest):
    """流式多轮对话接口 - 使用 SSE"""
    # 获取会话
    session = await ChatHistoryService.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 确定要使用的文件ID列表
    file_ids = req.file_ids or session.file_ids or []

    # 如果提供了新的文件，更新会话
    if req.file_ids and req.file_ids != session.file_ids:
        await ChatHistoryService.update_session_files(req.session_id, req.file_ids)

    # 获取多个文件的数据
    files_data = []
    for file_id in file_ids:
        try:
            df = await get_dataframe(file_id)
            uploaded_file = await FileStorageService.get_file(file_id)
            files_data.append({
                "file_id": file_id,
                "filename": uploaded_file.filename if uploaded_file else file_id,
                "columns": df.columns.tolist(),
                "data": df.to_string(index=False)
            })
        except Exception:
            continue

    # 获取历史消息
    history_messages = [
        {"role": m.role.value, "content": m.content}
        for m in session.messages
    ]

    # 保存用户消息
    await ChatHistoryService.add_message(
        session_id=req.session_id,
        role=MessageRole.USER,
        content=req.message
    )

    async def generate():
        full_content = ""
        try:
            async for chunk in stream_chat_multi_files(
                files_data=files_data,
                user_prompt=req.message,
                history_messages=history_messages
            ):
                full_content += chunk
                # SSE 格式: data: {json}\n\n
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk}, ensure_ascii=False)}\n\n"

            # 流式结束后，提取图表配置
            chart_config = extract_chart_config(full_content)

            # 保存助手回复
            await ChatHistoryService.add_message(
                session_id=req.session_id,
                role=MessageRole.ASSISTANT,
                content=full_content,
                chart_config=chart_config
            )

            # 如果是第一条消息，更新会话标题
            if len(session.messages) == 0:
                title = req.message[:50] + ("..." if len(req.message) > 50 else "")
                await ChatHistoryService.update_session_title(req.session_id, title)

            # 发送完成事件
            yield f"data: {json.dumps({'type': 'done', 'chart_config': chart_config}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ==================== 图表管理 API ====================

@app.get("/api/charts")
async def list_charts(page: int = 1, limit: int = 9):
    """获取所有保存的图表"""
    charts, total = await ChartService.get_all_charts(page=page, limit=limit)
    return {
        "items": charts,
        "total": total,
        "page": page,
        "limit": limit,
        "has_more": page * limit < total
    }


@app.delete("/api/charts/{message_id}")
async def delete_chart(message_id: int):
    """删除图表"""
    success = await ChartService.delete_chart(message_id)
    if not success:
        raise HTTPException(status_code=404, detail="图表不存在")
    return {"message": "图表已删除"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

