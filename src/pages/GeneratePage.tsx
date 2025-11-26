import React, { useState, useEffect, useRef } from "react";
import { TopNav } from "../components/TopNav";
import {
  ChatMessage,
  ChatMessageList,
  ChatMessageListHandle,
} from "../components/ChatMessageList";
import { ChatInput } from "../components/ChatInput";
import { uploadFile, createSession, sendChatMessageStream } from "../services/api";

type GeneratePageProps = {
  files: File[];  // 改为支持多文件
  initialPrompt: string;
  onBack: () => void;
};

export const GeneratePage: React.FC<GeneratePageProps> = ({
  files,
  initialPrompt,
  onBack,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chartCount, setChartCount] = useState(0);
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
        },
      ]);

      try {
        // 并行上传所有文件
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadResults = await Promise.all(uploadPromises);
        if (cancelled) return;

        const uploadedFileIds = uploadResults.map((res) => res.file_id);
        setFileIds(uploadedFileIds);

        // 生成上传成功消息
        const uploadMessages = uploadResults.map((res, index) => ({
          id: `upload-${index}`,
          role: "assistant" as const,
          content: `文件「${files[index].name}」上传成功！共 ${res.rows} 行数据，列：${res.columns.join(", ")}`,
        }));

        setMessages([
          {
            id: "m1",
            role: "assistant",
            content: `正在上传 ${files.length} 个文件...`,
          },
          ...uploadMessages,
        ]);

        // 创建会话（使用多个 file_ids）
        const session = await createSession(initialPrompt || fileNames, uploadedFileIds);
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
              file_ids: uploadedFileIds,
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

  return (
    <div className="app-layout">
      <div className="workspace-main">
        <TopNav
          fileName={fileNames}
          onBack={onBack}
          onExport={handleExportAll}
          exportLabel={chartCount > 1 ? `导出全部图表 (${chartCount})` : "导出图表"}
        />
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
