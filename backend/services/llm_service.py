import os
import json
import re
import asyncio
from typing import List, Optional, AsyncGenerator
from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage, BaseMessage
from langchain_openai import ChatOpenAI

load_dotenv()

# # 初始化 DeepSeek 模型
# model = init_chat_model(
#     "deepseek-chat",
#     model_provider="deepseek",
#     api_key=os.getenv("DEEPSEEK_API_KEY")
# )

model = ChatOpenAI(
        model=os.getenv("LLM_MODEL_NAME", "Qwen3-30B-A3B-Instruct-2507"),
        api_key=os.getenv("LLM_API_KEY", "none"),
        base_url=os.getenv("LLM_BASE_URL", "http://192.168.132.104:8067/v1"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.4")),
)

# LLM 并发限流 - 防止 API 被限流或过载
LLM_MAX_CONCURRENT = int(os.getenv("LLM_MAX_CONCURRENT", 10))
llm_semaphore = asyncio.Semaphore(LLM_MAX_CONCURRENT)

CHART_SYSTEM_PROMPT = """你是一个专业的数据可视化专家和数据分析助手。你可以：
1. 根据用户提供的表格数据和需求描述，生成 ECharts 图表配置
2. 回答用户关于数据的问题
3. 提供数据分析建议
4. 支持同时分析多个数据文件，进行跨文件对比分析


## 图表生成规范

### 基础要求
1. 根据数据特点和用户需求，选择最合适的图表类型（bar/line/pie/scatter/radar 等）
2. 输出合法的 ECharts option JSON 配置，用 ```json 和 ``` 包裹
3. **JSON 中禁止包含 JavaScript 函数！** 所有配置必须是纯 JSON 格式
4. 不要使用 formatter 函数，如需格式化可使用字符串模板如 "{value}"
5. 确保 JSON 格式正确，可直接被 JSON.parse() 解析

### 布局与配色
6. 图表要美观，配色协调，标题清晰
7. 使用清晰的配色方案，推荐颜色：["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272"]

### 图例位置（非常重要）
8. **图例必须放在标题下方、图表上方**，避免遮挡任何内容：
   - 图例位置：`"legend": { "top": 35, "left": "center" }`
   - 禁止将图例放在左侧或右侧，会遮挡坐标轴！

### Grid布局（必须设置）
9. 必须设置 grid 配置，预留足够空间：
   - `"grid": { "top": 80, "left": 80, "right": 40, "bottom": 80 }`
   - 如果X轴标签是长文本（如公司名），增大 bottom 值

### Y轴配置（重要）
10. **Y轴范围必须自适应数据**，不要固定为0-100：
    - 设置 `"yAxis": { "type": "value", "scale": true }` 让Y轴自动调整范围
    - 或使用 `"min": "dataMin"` 从数据最小值开始

### X轴标签处理（非常重要）
11. **当数据点超过10个时**，必须处理X轴标签：
    - 设置标签旋转45度：`"axisLabel": { "rotate": 45, "interval": 0 }`
    - 增大 grid.bottom 到 120

12. **当数据点超过20个时**，标签会严重重叠，必须：
    - 使用 `"axisLabel": { "rotate": 45, "interval": "auto" }` 让ECharts自动间隔显示
    - 或手动设置间隔：`"interval": 2` 表示每隔2个显示一个
    - grid.bottom 设为 150

### 图例处理（多系列时）
13. **当有3个以上系列时**，图例会很长，需要：
    - 使用可滚动图例：`"legend": { "type": "scroll", "top": 35 }`
    - 或增加图例与图表的间距，grid.top 设为 100

### 不同图表类型的特殊要求

#### 饼图/环形图
- 图例放在右侧：`"legend": { "orient": "vertical", "right": 20, "top": "center" }`
- 确保 series.radius 设置合理，如 `["40%", "70%"]`

#### 折线图/面积图
- 必须设置 `"yAxis": { "scale": true }` 让Y轴自适应
- 添加 `"areaStyle": {}` 可变为面积图

#### 堆叠柱状图
- 每个 series 设置相同的 `"stack": "总量"`
- 图例放在顶部，不要放在左侧

#### 雷达图
- **数据必须归一化为 0-100 的评分**
- 每个 indicator 的 max 统一设为 100
- 图例使用垂直布局：`"orient": "vertical", "left": 10`
- 雷达图中心偏右：`"radar": { "center": ["60%", "55%"] }`
- 只选择 5-6 个关键指标

## 输出示例

### 柱状图示例
```json
{
  "title": { "text": "销售数据对比", "left": "center", "top": 10 },
  "tooltip": { "trigger": "axis" },
  "legend": { "data": ["销量", "利润"], "top": 35, "left": "center" },
  "grid": { "top": 80, "left": 80, "right": 40, "bottom": 100 },
  "xAxis": { "type": "category", "data": ["产品A", "产品B", "产品C"], "axisLabel": { "rotate": 30, "interval": 0 } },
  "yAxis": { "type": "value", "scale": true },
  "series": [
    { "name": "销量", "type": "bar", "data": [120, 200, 150] },
    { "name": "利润", "type": "bar", "data": [80, 170, 120] }
  ]
}
```

### 折线图示例（多数据点、多系列）
```json
{
  "title": { "text": "趋势分析", "left": "center", "top": 10 },
  "tooltip": { "trigger": "axis" },
  "legend": { "type": "scroll", "data": ["指标A", "指标B", "指标C"], "top": 35, "left": "center" },
  "grid": { "top": 100, "left": 80, "right": 40, "bottom": 120 },
  "xAxis": { "type": "category", "data": ["Q1", "Q2", "Q3", "Q4"], "axisLabel": { "rotate": 45, "interval": "auto" } },
  "yAxis": { "type": "value", "scale": true },
  "series": [
    { "name": "指标A", "type": "line", "data": [82, 85, 79, 90], "smooth": true },
    { "name": "指标B", "type": "line", "data": [50, 60, 55, 70], "smooth": true },
    { "name": "指标C", "type": "line", "data": [30, 35, 40, 38], "smooth": true }
  ]
}
```

### 饼图示例
```json
{
  "title": { "text": "占比分布", "left": "center", "top": 10 },
  "tooltip": { "trigger": "item" },
  "legend": { "orient": "vertical", "right": 20, "top": "center" },
  "series": [{
    "name": "类型",
    "type": "pie",
    "radius": ["40%", "70%"],
    "center": ["40%", "55%"],
    "data": [
      { "value": 35, "name": "类型A" },
      { "value": 25, "name": "类型B" },
      { "value": 40, "name": "类型C" }
    ]
  }]
}
```

当用户进行普通对话时，直接用自然语言回复即可，不需要生成图表配置。
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
    try:
        response = model.invoke(messages)
        content = str(response.content)
    except Exception as e:
        print(f"LLM调用失败: {str(e)}")
        print(f"LLM配置 - base_url: {model.openai_api_base}")
        print(f"LLM配置 - model: {model.model_name}")
        raise

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

    # 使用 astream 流式输出，带并发限流
    async with llm_semaphore:
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
            # 尝试移除 JavaScript 函数后再解析
            cleaned_json = _remove_js_functions(json_str)
            try:
                return json.loads(cleaned_json)
            except json.JSONDecodeError:
                pass
    return None


def _remove_js_functions(json_str: str) -> str:
    """
    移除 JSON 字符串中的 JavaScript 函数定义，替换为 null
    处理类似: "color": function(params) { ... } 的情况
    """
    # 匹配 function(...) { ... } 模式，包括嵌套大括号
    result = []
    i = 0
    while i < len(json_str):
        # 检查是否是 function 关键字
        if json_str[i:i+8] == 'function':
            # 找到函数开始，需要找到对应的结束大括号
            j = i + 8
            # 跳过参数部分 (...)
            while j < len(json_str) and json_str[j] != '{':
                j += 1
            if j < len(json_str):
                # 找到函数体的结束位置
                brace_count = 1
                j += 1
                while j < len(json_str) and brace_count > 0:
                    if json_str[j] == '{':
                        brace_count += 1
                    elif json_str[j] == '}':
                        brace_count -= 1
                    j += 1
                # 用 null 替换整个函数
                result.append('null')
                i = j
            else:
                result.append(json_str[i])
                i += 1
        else:
            result.append(json_str[i])
            i += 1

    return ''.join(result)
