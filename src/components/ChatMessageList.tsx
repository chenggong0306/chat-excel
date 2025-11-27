import { useRef, useEffect, useImperativeHandle, forwardRef, memo, useCallback } from "react";
import * as echarts from "echarts";
import ReactMarkdown from "react-markdown";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chartConfig?: Record<string, unknown>; // 可选的图表配置
  isLoading?: boolean; // 是否显示 loading 动画
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

// 单条消息中的图表组件 - 使用 memo 防止不必要的重新渲染
const MessageChart = memo<{
  config: Record<string, unknown>;
  messageId: string;
  onInstanceReady?: (instance: echarts.ECharts) => void;
  onInstanceDestroy?: () => void;
}>(({ config, messageId, onInstanceReady, onInstanceDestroy }) => {
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

    // 确保 grid.top 足够大，避免标题/图例与图表重叠
    const safeConfig = { ...config } as Record<string, unknown>;
    const hasTitle = !!(safeConfig.title as Record<string, unknown>)?.text;
    const hasLegend = !!(safeConfig.legend as Record<string, unknown>)?.data;
    const isRadarChart = !!(safeConfig.radar);

    // 雷达图特殊处理：确保图例垂直排列
    if (isRadarChart && hasLegend) {
      const legend = safeConfig.legend as Record<string, unknown>;
      const legendData = legend?.data as unknown[];
      // 如果图例项超过3个，强制垂直布局
      if (legendData && legendData.length > 3) {
        safeConfig.legend = {
          ...legend,
          orient: "vertical",
          left: 10,
          top: 50,
        };
        // 调整雷达图中心位置
        const radar = safeConfig.radar as Record<string, unknown>;
        safeConfig.radar = {
          ...radar,
          center: radar.center || ["60%", "55%"],
          radius: radar.radius || "55%",
        };
      }
    }

    // 根据是否有标题和图例设置最小 top 值
    let minTop = 60;
    if (hasTitle && hasLegend) minTop = 80;
    if (hasTitle) minTop = Math.max(minTop, 50);
    if (hasLegend && !isRadarChart) {
      const legendData = (safeConfig.legend as Record<string, unknown>)?.data as unknown[];
      if (legendData && legendData.length > 4) minTop = 100; // 多图例需要更多空间
    }

    // 确保 grid 配置存在且 top 足够大（非雷达图）
    if (!isRadarChart) {
      if (!safeConfig.grid) {
        safeConfig.grid = { top: minTop, left: 60, right: 30, bottom: 60 };
      } else {
        const grid = safeConfig.grid as Record<string, unknown>;
        const currentTop = typeof grid.top === 'number' ? grid.top :
                           typeof grid.top === 'string' ? parseInt(grid.top) : 0;
        if (currentTop < minTop) {
          safeConfig.grid = { ...grid, top: minTop };
        }
      }
    }

    chartInstanceRef.current.setOption(safeConfig as echarts.EChartsOption);

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
});

MessageChart.displayName = "MessageChart";

// 移除消息中的 JSON 代码块（只保留文字说明）
const removeJsonCodeBlock = (content: string): string => {
  // 移除 ```json ... ``` 代码块
  return content.replace(/```json[\s\S]*?```/g, "").trim();
};

// 单条消息组件 - 使用 memo + 自定义比较函数防止不必要的重新渲染
const ChatMessageItem = memo<{
  message: ChatMessage;
  onInstanceReady: (messageId: string, instance: echarts.ECharts, config: Record<string, unknown>) => void;
  onInstanceDestroy: (messageId: string) => void;
}>(({ message: m, onInstanceReady, onInstanceDestroy }) => {
  // 如果有图表配置，移除消息中的 JSON 代码块
  const displayContent = m.chartConfig
    ? removeJsonCodeBlock(m.content)
    : m.content;

  // AI 消息为空 或 显式标记 isLoading 时显示 loading 动画
  const showLoading = m.role === "assistant" && (m.isLoading || !m.content.trim());

  return (
    <div
      className={`chat-bubble ${m.role === "assistant" ? "assistant" : "user"}`}
    >
      {showLoading ? (
        <>
          {m.content && (
            <div className="message-content markdown-body">
              <ReactMarkdown>{displayContent}</ReactMarkdown>
            </div>
          )}
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </>
      ) : (
        <div className="message-content markdown-body">
          {m.role === "assistant" ? (
            <ReactMarkdown>{displayContent}</ReactMarkdown>
          ) : (
            displayContent
          )}
        </div>
      )}
      {m.chartConfig && (
        <MessageChart
          config={m.chartConfig}
          messageId={m.id}
          onInstanceReady={(instance) =>
            onInstanceReady(m.id, instance, m.chartConfig!)
          }
          onInstanceDestroy={() => onInstanceDestroy(m.id)}
        />
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // 只比较消息内容是否变化，忽略回调函数
  const prevMsg = prevProps.message;
  const nextMsg = nextProps.message;
  return (
    prevMsg.id === nextMsg.id &&
    prevMsg.content === nextMsg.content &&
    prevMsg.isLoading === nextMsg.isLoading &&
    prevMsg.chartConfig === nextMsg.chartConfig
  );
});

ChatMessageItem.displayName = "ChatMessageItem";

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

    // 注册图表实例 - 使用 useCallback 稳定引用
    const handleInstanceReady = useCallback((
      messageId: string,
      instance: echarts.ECharts,
      config: Record<string, unknown>
    ) => {
      const title =
        (config as { title?: { text?: string } })?.title?.text || "图表";
      chartInstancesRef.current.set(messageId, { messageId, instance, title });
      onChartInstancesChange?.(Array.from(chartInstancesRef.current.values()));
    }, [onChartInstancesChange]);

    // 注销图表实例 - 使用 useCallback 稳定引用
    const handleInstanceDestroy = useCallback((messageId: string) => {
      chartInstancesRef.current.delete(messageId);
      onChartInstancesChange?.(Array.from(chartInstancesRef.current.values()));
    }, [onChartInstancesChange]);

    return (
      <div className="chat-messages">
        {messages.map((m) => (
          <ChatMessageItem
            key={m.id}
            message={m}
            onInstanceReady={handleInstanceReady}
            onInstanceDestroy={handleInstanceDestroy}
          />
        ))}
      </div>
    );
  }
);

ChatMessageList.displayName = "ChatMessageList";
