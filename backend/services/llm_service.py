import os
import json
import re
from typing import List, Optional, AsyncGenerator
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage

load_dotenv()

# 初始化 DeepSeek 模型
model = init_chat_model(
    "deepseek-chat",
    model_provider="deepseek",
    api_key=os.getenv("DEEPSEEK_API_KEY")
)

CHART_SYSTEM_PROMPT = """你是一个专业的数据可视化专家和数据分析助手。你可以：
1. 根据用户提供的表格数据和需求描述，生成 ECharts 图表配置
2. 回答用户关于数据的问题
3. 提供数据分析建议
4. 支持同时分析多个数据文件，进行跨文件对比分析

当用户需要生成图表时，请遵循以下要求：
1. 根据数据特点和用户需求，选择最合适的图表类型（bar/line/pie/scatter/radar 等）
2. 输出合法的 ECharts option JSON 配置，用 ```json 和 ``` 包裹
3. **重要：JSON 中不能包含 JavaScript 函数！**所有配置必须是纯 JSON 格式（字符串、数字、布尔值、数组、对象）
4. 不要使用 formatter 函数，如需格式化可使用字符串模板如 "{value}"
5. 确保 JSON 格式正确，可直接被 JSON.parse() 解析
6. 图表要美观，配色协调，标题清晰
7. 可以添加图例、tooltip、坐标轴标签等
8. 当有多个文件时，可以在同一图表中对比展示不同文件的数据

当用户进行普通对话时，直接用自然语言回复即可，不需要生成图表配置。

图表配置输出格式示例：
```json
{
  "title": { "text": "图表标题" },
  "tooltip": { "trigger": "axis" },
  "legend": { "data": ["系列1", "系列2"] },
  "xAxis": { "type": "category", "data": ["A", "B", "C"] },
  "yAxis": { "type": "value" },
  "series": [{ "name": "系列1", "type": "bar", "data": [10, 20, 30] }]
}
```
"""


def chat_with_context_multi_files(
    files_data: List[dict],
    user_prompt: str,
    history_messages: List[dict]
) -> dict:
    """
    支持多文件的多轮对话函数

    Args:
        files_data: 文件数据列表，格式 [{"file_id": "...", "filename": "...", "columns": [...], "data": "..."}]
        user_prompt: 用户的当前消息
        history_messages: 历史消息列表，格式 [{"role": "user/assistant", "content": "..."}]

    Returns:
        {"content": "回复内容", "chart_config": dict或None}
    """
    # 构建消息列表
    messages: List[BaseMessage] = [SystemMessage(content=CHART_SYSTEM_PROMPT)]

    # 如果有文件数据，添加多文件数据上下文
    if files_data:
        if len(files_data) == 1:
            # 单文件
            file_info = files_data[0]
            data_context = f"""
## 当前表格数据信息

文件名: {file_info['filename']}
列名: {file_info['columns']}

完整数据:
{file_info['data']}

请基于以上数据回答用户问题或生成图表。
"""
        else:
            # 多文件
            data_context = f"""
## 当前有 {len(files_data)} 个数据文件

"""
            for i, file_info in enumerate(files_data, 1):
                data_context += f"""
### 文件{i}: {file_info['filename']}
列名: {file_info['columns']}

数据:
{file_info['data']}

---
"""
            data_context += """
请基于以上多个文件的数据回答用户问题或生成图表。
如果用户需要对比分析，可以将多个文件的数据放在同一图表中展示。
"""
        messages.append(SystemMessage(content=data_context))

    # 添加历史消息
    for msg in history_messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    # 添加当前用户消息
    messages.append(HumanMessage(content=user_prompt))

    # 调用模型
    response = model.invoke(messages)
    content = str(response.content)

    # 尝试提取图表配置
    chart_config = None
    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
    if json_match:
        json_str = json_match.group(1)
        try:
            chart_config = json.loads(json_str)
        except json.JSONDecodeError:
            pass

    return {
        "content": content,
        "chart_config": chart_config
    }


async def stream_chat_multi_files(
    files_data: List[dict],
    user_prompt: str,
    history_messages: List[dict]
) -> AsyncGenerator[str, None]:
    """
    支持多文件的流式对话函数

    Args:
        files_data: 文件数据列表，格式 [{"file_id": "...", "filename": "...", "columns": [...], "data": "..."}]
        user_prompt: 用户的当前消息
        history_messages: 历史消息列表，格式 [{"role": "user/assistant", "content": "..."}]

    Yields:
        流式输出的文本片段
    """
    # 构建消息列表
    messages: List[BaseMessage] = [SystemMessage(content=CHART_SYSTEM_PROMPT)]

    # 如果有文件数据，添加多文件数据上下文
    if files_data:
        if len(files_data) == 1:
            # 单文件
            file_info = files_data[0]
            data_context = f"""
## 当前表格数据信息

文件名: {file_info['filename']}
列名: {file_info['columns']}

完整数据:
{file_info['data']}

请基于以上数据回答用户问题或生成图表。
"""
        else:
            # 多文件
            data_context = f"""
## 当前有 {len(files_data)} 个数据文件

"""
            for i, file_info in enumerate(files_data, 1):
                data_context += f"""
### 文件{i}: {file_info['filename']}
列名: {file_info['columns']}

数据:
{file_info['data']}

---
"""
            data_context += """
请基于以上多个文件的数据回答用户问题或生成图表。
如果用户需要对比分析，可以将多个文件的数据放在同一图表中展示。
"""
        messages.append(SystemMessage(content=data_context))

    # 添加历史消息
    for msg in history_messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    # 添加当前用户消息
    messages.append(HumanMessage(content=user_prompt))

    # 使用 astream 流式输出
    async for chunk in model.astream(messages):
        if hasattr(chunk, 'content') and chunk.content:
            content = chunk.content
            if isinstance(content, str):
                yield content
            elif isinstance(content, list):
                # 处理可能的列表类型内容
                for item in content:
                    if isinstance(item, str):
                        yield item
                    elif isinstance(item, dict) and 'text' in item:
                        yield str(item['text'])


def extract_chart_config(content: str) -> Optional[dict]:
    """
    从回复内容中提取图表配置
    """
    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
    if json_match:
        json_str = json_match.group(1)
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass
    return None
