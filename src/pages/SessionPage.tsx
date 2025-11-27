import React, { useState, useEffect, useRef } from "react";
import { TopNav } from "../components/TopNav";
import {
  ChatMessage,
  ChatMessageList,
  ChatMessageListHandle,
} from "../components/ChatMessageList";
import { ChatInput } from "../components/ChatInput";
import { SheetSelector } from "../components/SheetSelector";
import {
  getSessionDetail,
  sendChatMessageStream,
  selectMultipleSheets,
  updateSessionFileMetadata,
  SessionDetail,
  FileMetadataInfo,
} from "../services/api";

type SessionPageProps = {
  sessionId: string;
  onBack: () => void;
};

// 文件信息（恢复后的）
interface RestoredFileInfo {
  file_id: string;
  filename: string;
  sheet_names: string[];
  selectedSheets: string[];
}

export const SessionPage: React.FC<SessionPageProps> = ({
  sessionId,
  onBack,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true); // 加载历史消息
  const [isStreaming, setIsStreaming] = useState(false); // 是否正在流式输出（禁用输入框）
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [chartCount, setChartCount] = useState(0);
  const [fileInfos, setFileInfos] = useState<RestoredFileInfo[]>([]);
  const [dataSourceIds, setDataSourceIds] = useState<string[]>([]);
  const [sheetSelectorExpanded, setSheetSelectorExpanded] = useState(true);
  const chatListRef = useRef<ChatMessageListHandle>(null);

  // 加载历史会话消息
  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      setLoading(true);
      try {
        const detail = await getSessionDetail(sessionId);
        if (cancelled) return;

        setSessionDetail(detail);

        // 恢复文件信息
        if (detail.file_metadata && detail.file_metadata.length > 0) {
          const infos: RestoredFileInfo[] = detail.file_metadata.map((fm) => ({
            file_id: fm.file_id,
            filename: fm.filename,
            sheet_names: fm.sheet_names || [],
            selectedSheets: fm.selected_sheets || [],
          }));
          setFileInfos(infos);

          // 构建数据源 ID
          const dsIds: string[] = [];
          infos.forEach((info) => {
            if (info.selectedSheets.length > 0) {
              info.selectedSheets.forEach((sheet) => {
                dsIds.push(`${info.file_id}:${sheet}`);
              });
            } else {
              dsIds.push(info.file_id);
            }
          });
          setDataSourceIds(dsIds);
        }

        // 构建文件信息消息（和 GeneratePage 保持一致）
        const fileMessages: ChatMessage[] = [];
        if (detail.file_metadata && detail.file_metadata.length > 0) {
          // 添加"已上传 X 个文件"消息
          fileMessages.push({
            id: "file-count",
            role: "assistant",
            content: `已上传 ${detail.file_metadata.length} 个文件`,
          });

          // 添加每个文件的详细信息消息
          detail.file_metadata.forEach((fm, index) => {
            let content = `文件「${fm.filename}」已加载`;
            if (fm.sheet_names && fm.sheet_names.length > 1) {
              content += `\n📊 包含 ${fm.sheet_names.length} 个 Sheet：${fm.sheet_names.join(", ")}`;
              if (fm.selected_sheets && fm.selected_sheets.length > 0) {
                content += `\n✅ 当前选择：${fm.selected_sheets.join(", ")}`;
              }
              content += `\n💡 提示：可以在上方选择多个 Sheet 进行联合分析`;
            }
            fileMessages.push({
              id: `file-info-${index}`,
              role: "assistant",
              content,
            });
          });
        }

        // 转换消息格式，每条消息关联自己的图表配置
        const chatMessages: ChatMessage[] = detail.messages.map((msg) => ({
          id: `msg-${msg.id}`,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          chartConfig: msg.chart_config || undefined,
        }));

        // 合并：文件信息消息 + 历史对话消息
        setMessages([...fileMessages, ...chatMessages]);
      } catch (error) {
        setMessages([
          {
            id: "error",
            role: "assistant",
            content: `加载会话失败：${error instanceof Error ? error.message : "未知错误"}`,
          },
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSession();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 处理 Sheet 选择变化
  const handleSheetsChange = async (fileIndex: number, newSheets: string[]) => {
    const updatedInfos = [...fileInfos];
    updatedInfos[fileIndex] = {
      ...updatedInfos[fileIndex],
      selectedSheets: newSheets,
    };
    setFileInfos(updatedInfos);

    // 重新计算数据源 ID
    const newDataSourceIds: string[] = [];
    updatedInfos.forEach((info) => {
      if (info.selectedSheets.length > 0) {
        info.selectedSheets.forEach((sheet) => {
          newDataSourceIds.push(`${info.file_id}:${sheet}`);
        });
      } else {
        newDataSourceIds.push(info.file_id);
      }
    });
    setDataSourceIds(newDataSourceIds);

    // 如果选择了多个 sheet，需要调用后端加载数据
    if (newSheets.length > 0) {
      const info = updatedInfos[fileIndex];
      try {
        const result = await selectMultipleSheets(info.file_id, newSheets);
        // 添加提示消息
        const sheetsInfo = result.selected_sheets
          .map((s) => `「${s.sheet_name}」(${s.rows}行)`)
          .join(", ");
        setMessages((prev) => [
          ...prev,
          {
            id: `sheet-change-${Date.now()}`,
            role: "assistant",
            content: `已选择 ${newSheets.length} 个 Sheet：${sheetsInfo} 💡 现在可以基于这些数据进行联合分析`,
          },
        ]);
      } catch (error) {
        console.error("切换 Sheet 失败:", error);
      }
    }

    // 更新会话的文件元信息
    const fileMetadata: FileMetadataInfo[] = updatedInfos.map((info) => ({
      file_id: info.file_id,
      filename: info.filename,
      sheet_names: info.sheet_names,
      selected_sheets: info.selectedSheets,
    }));
    try {
      await updateSessionFileMetadata(sessionId, fileMetadata);
    } catch (error) {
      console.error("更新文件元信息失败:", error);
    }
  };

  // 处理用户发送新消息（流式）
  const handleSend = async (text: string) => {
    if (!sessionDetail || loading || isStreaming) return;

    const assistantMsgId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text },
      { id: assistantMsgId, role: "assistant", content: "" },
    ]);

    setIsStreaming(true);
    let streamContent = "";

    // 使用 dataSourceIds（包含 sheet 信息）而不是 file_ids
    const fileIdsToUse = dataSourceIds.length > 0 ? dataSourceIds : sessionDetail.file_ids || [];

    try {
      await sendChatMessageStream(
        {
          session_id: sessionId,
          message: text,
          file_ids: fileIdsToUse,
        },
        // onChunk - 流式更新内容
        (chunk) => {
          streamContent += chunk;
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { id: assistantMsgId, role: "assistant", content: streamContent },
          ]);
        },
        // onDone - 完成时将图表配置存入消息
        (chartConfig) => {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              id: assistantMsgId,
              role: "assistant",
              content: streamContent,
              chartConfig: chartConfig || undefined,
            },
          ]);
        },
        // onError
        (error) => {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              id: assistantMsgId,
              role: "assistant",
              content: `生成失败：${error}`,
            },
          ]);
        }
      );
    } catch (error) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          id: assistantMsgId,
          role: "assistant",
          content: `生成失败：${error instanceof Error ? error.message : "未知错误"}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  };

  // 导出所有图表
  const handleExportAll = () => {
    chatListRef.current?.exportAllCharts();
  };

  const fileName = sessionDetail?.title || "历史会话";

  // 检查是否有多 sheet 文件
  const hasMultipleSheets = fileInfos.some((info) => info.sheet_names.length > 1);

  // 计算文件名显示
  const fileNames = fileInfos.map((f) => f.filename).join(", ");

  return (
    <div className="app-layout">
      <div className="workspace-main">
        <TopNav
          fileName={fileNames || fileName}
          onBack={onBack}
          onExport={handleExportAll}
          exportLabel={chartCount > 1 ? `导出全部图表 (${chartCount})` : "导出图表"}
        />
        {/* Sheet 多选区域（可折叠） */}
        {hasMultipleSheets && (
          <div className={`sheet-selector-panel ${sheetSelectorExpanded ? 'expanded' : 'collapsed'}`}>
            <div
              className="sheet-selector-header"
              onClick={() => setSheetSelectorExpanded(!sheetSelectorExpanded)}
            >
              <span className="sheet-selector-title">
                📊 Sheet 选择
                <span className="sheet-selector-count">
                  （已选 {fileInfos.reduce((acc, info) => acc + info.selectedSheets.length, 0)} 个）
                </span>
              </span>
              <button className="sheet-selector-toggle">
                {sheetSelectorExpanded ? '收起 ▲' : '展开 ▼'}
              </button>
            </div>
            {sheetSelectorExpanded && (
              <div className="sheet-selector-content">
                {fileInfos.map((info, index) => {
                  if (info.sheet_names.length <= 1) return null;
                  return (
                    <div key={info.file_id} className="sheet-multi-file-item">
                      <span className="sheet-file-name">{info.filename}</span>
                      <SheetSelector
                        multiple
                        sheets={info.sheet_names}
                        selectedSheets={info.selectedSheets}
                        onChange={(sheets) => handleSheetsChange(index, sheets)}
                        disabled={loading || isStreaming}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <main className="workspace-inner">
          <section className="chat-panel">
            {loading && messages.length === 0 ? (
              <div className="chat-skeleton">
                {[1, 2, 3].map((i) => (
                  <div key={i} className={`skeleton-message ${i % 2 === 0 ? 'user' : 'assistant'}`}>
                    <div className="skeleton-bubble"></div>
                  </div>
                ))}
              </div>
            ) : (
              <ChatMessageList
                ref={chatListRef}
                messages={messages}
                onChartInstancesChange={(instances) => setChartCount(instances.length)}
              />
            )}
          </section>
        </main>
        <ChatInput onSend={handleSend} disabled={loading || isStreaming} />
      </div>
    </div>
  );
};
