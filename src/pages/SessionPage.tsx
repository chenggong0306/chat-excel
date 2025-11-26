import React, { useState, useEffect, useRef } from "react";
import { TopNav } from "../components/TopNav";
import {
  ChatMessage,
  ChatMessageList,
  ChatMessageListHandle,
} from "../components/ChatMessageList";
import { ChatInput } from "../components/ChatInput";
import { getSessionDetail, sendChatMessageStream, SessionDetail } from "../services/api";

type SessionPageProps = {
  sessionId: string;
  onBack: () => void;
};

export const SessionPage: React.FC<SessionPageProps> = ({
  sessionId,
  onBack,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [chartCount, setChartCount] = useState(0);
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

        // 转换消息格式，每条消息关联自己的图表配置
        const chatMessages: ChatMessage[] = detail.messages.map((msg) => ({
          id: `msg-${msg.id}`,
          role: msg.role as "user" | "assistant",
          content: msg.content,
          chartConfig: msg.chart_config || undefined,
        }));

        setMessages(chatMessages);
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

  // 处理用户发送新消息（流式）
  const handleSend = async (text: string) => {
    if (!sessionDetail || loading) return;

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
          file_ids: sessionDetail.file_ids || undefined,
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

  const fileName = sessionDetail?.title || "历史会话";

  return (
    <div className="app-layout">
      <div className="workspace-main">
        <TopNav
          fileName={fileName}
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
