import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import * as echarts from "echarts";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chartConfig?: Record<string, unknown>; // 可选的图表配置
};

// 图表实例引用，用于导出
export type ChartInstanceRef = {
  messageId: string;
  instance: echarts.ECharts;
  title: string;
};

type ChatMessageListProps = {
  messages: ChatMessage[];
  onChartInstancesChange?: (instances: ChartInstanceRef[]) => void;
};

// 单条消息中的图表组件
const MessageChart: React.FC<{
  config: Record<string, unknown>;
  messageId: string;
  onInstanceReady?: (instance: echarts.ECharts) => void;
  onInstanceDestroy?: () => void;
}> = ({ config, messageId, onInstanceReady, onInstanceDestroy }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  // 导出单个图表
  const handleExport = () => {
    if (!chartInstanceRef.current) return;

    const url = chartInstanceRef.current.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#fff",
    });

    const link = document.createElement("a");
    const title =
      (config as { title?: { text?: string } })?.title?.text || "图表";
    link.download = `${title}-${Date.now()}.png`;
    link.href = url;
    link.click();
  };

  useEffect(() => {
    if (!chartRef.current || !config) return;

    // 初始化或获取已有实例
    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
      onInstanceReady?.(chartInstanceRef.current);
    }

    chartInstanceRef.current.setOption(config as echarts.EChartsOption);

    // 响应式调整
    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [config, messageId, onInstanceReady]);

  // 组件卸载时销毁实例
  useEffect(() => {
    return () => {
      onInstanceDestroy?.();
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, [onInstanceDestroy]);

  return (
    <div className="message-chart-container">
      <div ref={chartRef} className="message-chart" />
      <button className="chart-export-btn" onClick={handleExport} title="导出图表">
        📥 导出
      </button>
    </div>
  );
};

// 移除消息中的 JSON 代码块（只保留文字说明）
const removeJsonCodeBlock = (content: string): string => {
  // 移除 ```json ... ``` 代码块
  return content.replace(/```json[\s\S]*?```/g, "").trim();
};

// 导出 handle 类型
export type ChatMessageListHandle = {
  exportAllCharts: () => void;
  getChartCount: () => number;
};

export const ChatMessageList = forwardRef<ChatMessageListHandle, ChatMessageListProps>(
  ({ messages, onChartInstancesChange }, ref) => {
    const chartInstancesRef = useRef<Map<string, ChartInstanceRef>>(new Map());

    // 暴露导出所有图表的方法
    useImperativeHandle(ref, () => ({
      exportAllCharts: () => {
        const instances = Array.from(chartInstancesRef.current.values());
        if (instances.length === 0) {
          alert("当前没有可导出的图表");
          return;
        }

        instances.forEach((item, index) => {
          setTimeout(() => {
            const url = item.instance.getDataURL({
              type: "png",
              pixelRatio: 2,
              backgroundColor: "#fff",
            });

            const link = document.createElement("a");
            link.download = `${item.title}-${Date.now()}.png`;
            link.href = url;
            link.click();
          }, index * 300); // 间隔300ms逐个下载，避免浏览器阻止
        });
      },
      getChartCount: () => chartInstancesRef.current.size,
    }));

    // 注册图表实例
    const handleInstanceReady = (
      messageId: string,
      instance: echarts.ECharts,
      config: Record<string, unknown>
    ) => {
      const title =
        (config as { title?: { text?: string } })?.title?.text || "图表";
      chartInstancesRef.current.set(messageId, { messageId, instance, title });
      onChartInstancesChange?.(Array.from(chartInstancesRef.current.values()));
    };

    // 注销图表实例
    const handleInstanceDestroy = (messageId: string) => {
      chartInstancesRef.current.delete(messageId);
      onChartInstancesChange?.(Array.from(chartInstancesRef.current.values()));
    };

    return (
      <div className="chat-messages">
        {messages.map((m) => {
          // 如果有图表配置，移除消息中的 JSON 代码块
          const displayContent = m.chartConfig
            ? removeJsonCodeBlock(m.content)
            : m.content;

          return (
            <div
              key={m.id}
              className={`chat-bubble ${
                m.role === "assistant" ? "assistant" : "user"
              }`}
            >
              <div className="message-content">{displayContent}</div>
              {m.chartConfig && (
                <MessageChart
                  config={m.chartConfig}
                  messageId={m.id}
                  onInstanceReady={(instance) =>
                    handleInstanceReady(m.id, instance, m.chartConfig!)
                  }
                  onInstanceDestroy={() => handleInstanceDestroy(m.id)}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }
);

ChatMessageList.displayName = "ChatMessageList";
