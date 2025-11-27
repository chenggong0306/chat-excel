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
  uploadFile,
  createSession,
  sendChatMessageStream,
  selectMultipleSheets,
  updateSessionFileMetadata,
  UploadResponse,
  FileMetadataInfo,
} from "../services/api";

type GeneratePageProps = {
  files: File[];  // 改为支持多文件
  initialPrompt: string;
  onBack: () => void;
};

// 文件信息（包含 sheet 数据）
interface FileInfo {
  file: File;
  uploadResult: UploadResponse;
  selectedSheets: string[];  // 改为支持多选
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  files,
  initialPrompt,
  onBack,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileIds, setFileIds] = useState<string[]>([]);  // 现在存储 file_id:sheet_name 格式
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chartCount, setChartCount] = useState(0);
  const [fileInfos, setFileInfos] = useState<FileInfo[]>([]);
  const [sheetSelectorExpanded, setSheetSelectorExpanded] = useState(true);
  const chatListRef = useRef<ChatMessageListHandle>(null);

  // 文件名显示
  const fileNames = files.map((f) => f.name).join(", ");

  // 初始化：上传多个文件、创建会话并生成图表
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setLoading(true);
      setMessages([
        {
          id: "m1",
          role: "assistant",
          content: `正在上传 ${files.length} 个文件...`,
          isLoading: true,
        },
      ]);

      try {
        // 并行上传所有文件
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadResults = await Promise.all(uploadPromises);
        if (cancelled) return;

        // 构建数据源 ID（对于有多个 sheet 的文件，使用 file_id:sheet_name 格式）
        const dataSourceIds: string[] = [];
        uploadResults.forEach((res) => {
          if (res.selected_sheet) {
            dataSourceIds.push(`${res.file_id}:${res.selected_sheet}`);
          } else {
            dataSourceIds.push(res.file_id);
          }
        });
        setFileIds(dataSourceIds);

        // 保存文件信息（包含 sheet 数据）
        const infos: FileInfo[] = files.map((file, index) => ({
          file,
          uploadResult: uploadResults[index],
          selectedSheets: uploadResults[index].selected_sheet
            ? [uploadResults[index].selected_sheet!]
            : [],
        }));
        setFileInfos(infos);

        // 生成上传成功消息（包含 sheet 信息）
        const uploadMessages = uploadResults.map((res, index) => {
          let content = `文件「${files[index].name}」上传成功！共 ${res.rows} 行数据，列：${res.columns.join(", ")}`;
          if (res.sheet_names && res.sheet_names.length > 1) {
            content += `\n📊 包含 ${res.sheet_names.length} 个 Sheet：${res.sheet_names.join(", ")}`;
            content += `\n💡 提示：可以在上方选择多个 Sheet 进行联合分析`;
          }
          return {
            id: `upload-${index}`,
            role: "assistant" as const,
            content,
          };
        });

        setMessages([
          {
            id: "m1",
            role: "assistant",
            content: `已上传 ${files.length} 个文件`,
            isLoading: false,
          },
          ...uploadMessages,
        ]);

        // 构建文件元信息
        const fileMetadata: FileMetadataInfo[] = infos.map((info) => ({
          file_id: info.uploadResult.file_id,
          filename: info.uploadResult.filename,
          sheet_names: info.uploadResult.sheet_names || null,
          selected_sheets: info.selectedSheets,
        }));

        // 创建会话（使用数据源 IDs 和文件元信息）
        const session = await createSession(initialPrompt || fileNames, dataSourceIds, fileMetadata);
        if (cancelled) return;
        setSessionId(session.id);

        // 生成图表（流式）
        if (initialPrompt) {
          setMessages((prev) => [
            ...prev,
            { id: "m3", role: "user", content: initialPrompt },
            { id: "m4", role: "assistant", content: "" },
          ]);

          let streamContent = "";
          await sendChatMessageStream(
            {
              session_id: session.id,
              message: initialPrompt,
              file_ids: dataSourceIds,
            },
            // onChunk - 流式更新内容
            (chunk) => {
              if (cancelled) return;
              streamContent += chunk;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { id: "m4", role: "assistant", content: streamContent },
              ]);
            },
            // onDone - 完成时将图表配置存入消息
            (chartConfig) => {
              if (cancelled) return;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                {
                  id: "m4",
                  role: "assistant",
                  content: streamContent,
                  chartConfig: chartConfig || undefined,
                },
              ]);
            },
            // onError
            (error) => {
              if (cancelled) return;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { id: "m4", role: "assistant", content: `错误：${error}` },
              ]);
            }
          );
        }
      } catch (error) {
        if (cancelled) return;
        setMessages((prev) => [
          ...prev,
          {
            id: "error",
            role: "assistant",
            content: `错误：${error instanceof Error ? error.message : "未知错误"}`,
          },
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [files, initialPrompt, fileNames]);

  // 处理用户发送新消息（流式）
  const handleSend = async (text: string) => {
    if (fileIds.length === 0 || !sessionId || loading) return;

    const assistantMsgId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", content: text },
      { id: assistantMsgId, role: "assistant", content: "" },
    ]);

    setLoading(true);
    let streamContent = "";

    try {
      await sendChatMessageStream(
        {
          session_id: sessionId,
          message: text,
          file_ids: fileIds,
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
      setLoading(false);
    }
  };

  // 导出所有图表
  const handleExportAll = () => {
    chatListRef.current?.exportAllCharts();
  };

  // 多 Sheet 选择变化处理
  const handleSheetsChange = async (fileIndex: number, newSelectedSheets: string[]) => {
    const info = fileInfos[fileIndex];
    if (!info || newSelectedSheets.length === 0) return;

    setLoading(true);
    try {
      // 调用多 sheet 选择 API
      const result = await selectMultipleSheets(info.uploadResult.file_id, newSelectedSheets);

      // 更新文件信息
      const newInfos = [...fileInfos];
      newInfos[fileIndex] = {
        ...info,
        selectedSheets: newSelectedSheets,
      };
      setFileInfos(newInfos);

      // 更新数据源 IDs（所有选中的 sheet 都作为独立数据源）
      const newDataSourceIds: string[] = [];
      newInfos.forEach((fi) => {
        if (fi.selectedSheets.length > 0) {
          fi.selectedSheets.forEach((sheet) => {
            newDataSourceIds.push(`${fi.uploadResult.file_id}:${sheet}`);
          });
        } else {
          newDataSourceIds.push(fi.uploadResult.file_id);
        }
      });
      setFileIds(newDataSourceIds);

      // 生成切换成功消息
      const sheetInfos = result.selected_sheets
        .map((s) => `「${s.sheet_name}」(${s.rows}行)`)
        .join(", ");

      setMessages((prev) => [
        ...prev,
        {
          id: `sheet-switch-${Date.now()}`,
          role: "assistant",
          content: `已选择 ${newSelectedSheets.length} 个 Sheet：${sheetInfos}\n💡 现在可以基于这些数据进行联合分析`,
        },
      ]);

      // 更新会话的文件元信息
      if (sessionId) {
        const fileMetadata: FileMetadataInfo[] = newInfos.map((fi) => ({
          file_id: fi.uploadResult.file_id,
          filename: fi.uploadResult.filename,
          sheet_names: fi.uploadResult.sheet_names || null,
          selected_sheets: fi.selectedSheets,
        }));
        try {
          await updateSessionFileMetadata(sessionId, fileMetadata);
        } catch (e) {
          console.error("更新文件元信息失败:", e);
        }
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `sheet-error-${Date.now()}`,
          role: "assistant",
          content: `选择 Sheet 失败：${error instanceof Error ? error.message : "未知错误"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 检查是否有多 sheet 文件
  const hasMultipleSheets = fileInfos.some(
    (info) => info.uploadResult.sheet_names && info.uploadResult.sheet_names.length > 1
  );

  return (
    <div className="app-layout">
      <div className="workspace-main">
        <TopNav
          fileName={fileNames}
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
                  const sheets = info.uploadResult.sheet_names || [];
                  if (sheets.length <= 1) return null;
                  return (
                    <div key={info.uploadResult.file_id} className="sheet-multi-file-item">
                      <span className="sheet-file-name">{info.file.name}</span>
                      <SheetSelector
                        multiple
                        sheets={sheets}
                        selectedSheets={info.selectedSheets}
                        onChange={(sheets) => handleSheetsChange(index, sheets)}
                        disabled={loading}
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
            <ChatMessageList
              ref={chatListRef}
              messages={messages}
              onChartInstancesChange={(instances) => setChartCount(instances.length)}
            />
          </section>
        </main>
        <ChatInput onSend={handleSend} disabled={loading} />
      </div>
    </div>
  );
};
