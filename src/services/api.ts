// 使用相对路径，通过 Nginx 代理 API 请求
// 本地开发时需要修改为 "http://localhost:8000"
const API_BASE = "";

/**
 * 生成 UUID v4（兼容所有浏览器）
 */
function generateUUID(): string {
  // 使用 crypto.getRandomValues 生成随机数，兼容性更好
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  // 设置版本号 (4) 和变体位
  array[6] = (array[6] & 0x0f) | 0x40;
  array[8] = (array[8] & 0x3f) | 0x80;
  // 转换为 UUID 字符串格式
  const hex = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 获取或生成客户端唯一标识
 * 用于简单的用户隔离，同一浏览器的数据保持一致
 */
function getClientId(): string {
  const storageKey = "chat_excel_client_id";
  let clientId = localStorage.getItem(storageKey);
  if (!clientId) {
    clientId = generateUUID();
    localStorage.setItem(storageKey, clientId);
  }
  return clientId;
}

/**
 * 获取带 client_id 的请求头
 */
function getHeaders(includeContentType = false): HeadersInit {
  const headers: HeadersInit = {
    "X-Client-ID": getClientId(),
  };
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export interface UploadResponse {
  file_id: string;
  filename: string;
  columns: string[];
  rows: number;
  preview: Record<string, unknown>[];
  sheet_names?: string[];  // Excel 文件的所有 sheet 名称
  selected_sheet?: string;  // 当前选择的 sheet
}

// 会话相关接口
// 文件元信息
export interface FileMetadataInfo {
  file_id: string;
  filename: string;
  sheet_names?: string[] | null;
  selected_sheets: string[];
}

export interface SessionInfo {
  id: string;
  title: string | null;
  file_ids: string[] | null;  // 支持多文件
  file_metadata?: FileMetadataInfo[] | null;  // 文件元信息
  created_at: string;
  updated_at: string;
}

export interface ChatMessageInfo {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  chart_config: Record<string, unknown> | null;
  created_at: string;
}

export interface SessionDetail extends SessionInfo {
  messages: ChatMessageInfo[];
}

export interface ChatRequestPayload {
  session_id: string;
  message: string;
  file_ids?: string[];  // 支持多文件
}

/**
 * 上传 Excel/CSV 文件
 */
export async function uploadFile(file: File, sheetName?: string): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  let url = `${API_BASE}/api/upload`;
  if (sheetName) {
    url += `?sheet_name=${encodeURIComponent(sheetName)}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Client-ID": getClientId(),
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "上传失败");
  }

  return response.json();
}

/**
 * 切换 Excel 文件的 sheet
 */
export async function switchSheet(fileId: string, sheetName: string): Promise<UploadResponse> {
  const response = await fetch(`${API_BASE}/api/files/${fileId}/switch-sheet?sheet_name=${encodeURIComponent(sheetName)}`, {
    method: "POST",
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "切换 Sheet 失败");
  }

  return response.json();
}

/**
 * 选择多个 sheet 的响应
 */
export interface SheetData {
  data_source_id: string;
  file_id: string;
  sheet_name: string;
  columns: string[];
  rows: number;
  preview: Record<string, unknown>[];
}

export interface MultiSheetResponse {
  file_id: string;
  filename: string;
  sheet_names: string[];
  selected_sheets: SheetData[];
}

/**
 * 选择 Excel 文件的多个 sheet
 */
export async function selectMultipleSheets(fileId: string, sheetNames: string[]): Promise<MultiSheetResponse> {
  const response = await fetch(`${API_BASE}/api/files/${fileId}/select-sheets`, {
    method: "POST",
    headers: getHeaders(true),
    body: JSON.stringify({ sheet_names: sheetNames }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "选择 Sheet 失败");
  }

  return response.json();
}

// ==================== 会话管理 API ====================

/**
 * 分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

/**
 * 获取会话列表（支持分页和搜索）
 */
export async function getSessions(
  page: number = 1,
  limit: number = 9,
  search?: string
): Promise<PaginatedResponse<SessionInfo>> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  if (search) {
    params.append("search", search);
  }
  const response = await fetch(`${API_BASE}/api/sessions?${params}`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "获取会话列表失败");
  }
  return response.json();
}

/**
 * 创建新会话（支持多文件和文件元信息）
 */
export async function createSession(
  title?: string,
  fileIds?: string[],
  fileMetadata?: FileMetadataInfo[]
): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: getHeaders(true),
    body: JSON.stringify({
      title,
      file_ids: fileIds,
      file_metadata: fileMetadata,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "创建会话失败");
  }
  return response.json();
}

/**
 * 获取会话详情
 */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "获取会话详情失败");
  }
  return response.json();
}

/**
 * 删除会话
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "删除会话失败");
  }
}

/**
 * 删除所有会话
 */
export async function deleteAllSessions(): Promise<{ deleted_count: number }> {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "删除所有会话失败");
  }
  return response.json();
}

/**
 * 更新会话的文件元信息
 */
export async function updateSessionFileMetadata(
  sessionId: string,
  fileMetadata: FileMetadataInfo[]
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/file-metadata`, {
    method: "PUT",
    headers: getHeaders(true),
    body: JSON.stringify({ file_metadata: fileMetadata }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "更新文件元信息失败");
  }
}

/**
 * 流式消息事件类型
 */
export interface StreamEvent {
  type: "chunk" | "done" | "error";
  content?: string;
  chart_config?: Record<string, unknown> | null;
  message?: string;
}

/**
 * 流式多轮对话
 */
export async function sendChatMessageStream(
  payload: ChatRequestPayload,
  onChunk: (content: string) => void,
  onDone: (chartConfig: Record<string, unknown> | null) => void,
  onError: (error: string) => void
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: getHeaders(true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "发送消息失败");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法读取响应流");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 数据
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 保留未完成的行

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          if (jsonStr.trim()) {
            try {
              const event: StreamEvent = JSON.parse(jsonStr);
              if (event.type === "chunk" && event.content) {
                onChunk(event.content);
              } else if (event.type === "done") {
                onDone(event.chart_config || null);
              } else if (event.type === "error") {
                onError(event.message || "未知错误");
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ==================== 图表管理 API ====================

/**
 * 图表信息
 */
export interface ChartInfo {
  id: number;
  session_id: string;
  session_title: string;
  chart_config: Record<string, unknown>;
  created_at: string;
}

/**
 * 获取图表列表
 */
export async function getCharts(
  page: number = 1,
  limit: number = 9
): Promise<PaginatedResponse<ChartInfo>> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  const response = await fetch(`${API_BASE}/api/charts?${params}`, {
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "获取图表列表失败");
  }
  return response.json();
}

/**
 * 删除图表
 */
export async function deleteChart(messageId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/api/charts/${messageId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "删除图表失败");
  }
}
