import React, { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "../components/Sidebar";
import {
  getSessions,
  deleteSession,
  getCharts,
  deleteChart,
  SessionInfo,
  ChartInfo,
} from "../services/api";
import * as echarts from "echarts";

type HistoryPageProps = {
  onNavigate: (page: "home" | "history") => void;
  onOpenSession: (sessionId: string) => void;
};

type ViewMode = "grid" | "list";

export const HistoryPage: React.FC<HistoryPageProps> = ({ onNavigate, onOpenSession }) => {
  // 会话相关状态
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [sessionViewMode, setSessionViewMode] = useState<ViewMode>("grid");

  // 图表相关状态
  const [charts, setCharts] = useState<ChartInfo[]>([]);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [chartsPage, setChartsPage] = useState(1);
  const [chartsTotal, setChartsTotal] = useState(0);
  const [chartsHasMore, setChartsHasMore] = useState(false);
  const [chartViewMode, setChartViewMode] = useState<ViewMode>("grid");

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 加载会话
  const loadSessions = useCallback(async (page: number, append: boolean = false) => {
    try {
      setSessionsLoading(true);
      const data = await getSessions(page, 9, searchQuery || undefined);
      setSessions((prev) => (append ? [...prev, ...data.items] : data.items));
      setSessionsTotal(data.total);
      setSessionsHasMore(data.has_more);
      setSessionsPage(page);
    } catch (error) {
      console.error("加载会话失败:", error);
    } finally {
      setSessionsLoading(false);
    }
  }, [searchQuery]);

  // 加载图表
  const loadCharts = useCallback(async (page: number, append: boolean = false) => {
    try {
      setChartsLoading(true);
      const data = await getCharts(page, 9);
      setCharts((prev) => (append ? [...prev, ...data.items] : data.items));
      setChartsTotal(data.total);
      setChartsHasMore(data.has_more);
      setChartsPage(page);
    } catch (error) {
      console.error("加载图表失败:", error);
    } finally {
      setChartsLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadSessions(1);
    loadCharts(1);
  }, [loadSessions, loadCharts]);

  // 搜索处理（防抖）
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      loadSessions(1);
    }, 300);
  };

  // 删除会话
  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个对话吗？")) return;
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSessionsTotal((prev) => prev - 1);
    } catch (error) {
      console.error("删除失败:", error);
    }
  };

  // 删除图表
  const handleDeleteChart = async (e: React.MouseEvent, messageId: number) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个图表吗？")) return;
    try {
      await deleteChart(messageId);
      setCharts((prev) => prev.filter((c) => c.id !== messageId));
      setChartsTotal((prev) => prev - 1);
    } catch (error) {
      console.error("删除失败:", error);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  return (
    <div className="app-layout">
      <Sidebar active="history" onNavigate={onNavigate} />
      <main className="history-main">
        <header className="history-header">
          <h1 className="history-title">工作区</h1>
          <div className="history-actions">
            <div className="history-search">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="搜索任务、图表、模板..."
                className="search-input"
                value={searchQuery}
                onChange={handleSearchChange}
              />
            </div>
            <button className="new-btn" onClick={() => onNavigate("home")}>
              + 新建
            </button>
          </div>
        </header>

        {/* 历史对话区域 */}
        <section className="history-section">
          <div className="section-header">
            <h2 className="section-title">
              历史对话 {sessionsTotal > 0 && <span className="count-badge">({sessionsTotal})</span>}
            </h2>
            <div className="view-toggle">
              <button
                className={`toggle-btn ${sessionViewMode === "grid" ? "active" : ""}`}
                onClick={() => setSessionViewMode("grid")}
                title="网格视图"
              >
                ⊞
              </button>
              <button
                className={`toggle-btn ${sessionViewMode === "list" ? "active" : ""}`}
                onClick={() => setSessionViewMode("list")}
                title="列表视图"
              >
                ☰
              </button>
            </div>
          </div>

          {sessionsLoading && sessions.length === 0 ? (
            <div className="loading-state">加载中...</div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">
              {searchQuery ? `未找到包含 "${searchQuery}" 的对话` : "暂无历史对话"}
            </div>
          ) : sessionViewMode === "grid" ? (
            <div className="session-grid">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="session-card"
                  onClick={() => onOpenSession(session.id)}
                >
                  <div className="card-icon">📊</div>
                  <h3 className="card-title">{session.title || "未命名对话"}</h3>
                  <div className="card-meta">
                    <span className="meta-date">🕐 {formatDate(session.updated_at)}</span>
                    <span className="meta-source">
                      📁 {session.file_ids?.length || 0} 个文件
                    </span>
                  </div>
                  <button
                    className="card-delete"
                    onClick={(e) => handleDeleteSession(e, session.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="session-list">
              <div className="list-header">
                <span className="list-col col-title">标题</span>
                <span className="list-col col-files">文件数</span>
                <span className="list-col col-date">更新时间</span>
                <span className="list-col col-action">操作</span>
              </div>
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="list-row"
                  onClick={() => onOpenSession(session.id)}
                >
                  <span className="list-col col-title">
                    <span className="row-icon">📊</span>
                    {session.title || "未命名对话"}
                  </span>
                  <span className="list-col col-files">{session.file_ids?.length || 0}</span>
                  <span className="list-col col-date">{formatDate(session.updated_at)}</span>
                  <span className="list-col col-action">
                    <button
                      className="list-delete-btn"
                      onClick={(e) => handleDeleteSession(e, session.id)}
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {sessionsHasMore && (
            <div className="load-more">
              <button
                className="load-more-btn"
                onClick={() => loadSessions(sessionsPage + 1, true)}
                disabled={sessionsLoading}
              >
                {sessionsLoading ? "加载中..." : `加载更多 (${sessions.length}/${sessionsTotal})`}
              </button>
            </div>
          )}
        </section>

        {/* 我的图表区域 */}
        <section className="history-section">
          <div className="section-header">
            <h2 className="section-title">
              我的图表 {chartsTotal > 0 && <span className="count-badge">({chartsTotal})</span>}
            </h2>
            <div className="view-toggle">
              <button
                className={`toggle-btn ${chartViewMode === "grid" ? "active" : ""}`}
                onClick={() => setChartViewMode("grid")}
                title="网格视图"
              >
                ⊞
              </button>
              <button
                className={`toggle-btn ${chartViewMode === "list" ? "active" : ""}`}
                onClick={() => setChartViewMode("list")}
                title="列表视图"
              >
                ☰
              </button>
            </div>
          </div>

          {chartsLoading && charts.length === 0 ? (
            <div className="loading-state">加载中...</div>
          ) : charts.length === 0 ? (
            <div className="empty-state">暂无图表</div>
          ) : chartViewMode === "grid" ? (
            <div className="chart-grid">
              {charts.map((chart) => (
                <ChartPreviewCard
                  key={chart.id}
                  chart={chart}
                  onDelete={(e) => handleDeleteChart(e, chart.id)}
                  onOpenSession={() => onOpenSession(chart.session_id)}
                />
              ))}
            </div>
          ) : (
            <div className="session-list">
              <div className="list-header">
                <span className="list-col col-title">图表标题</span>
                <span className="list-col col-source">来源对话</span>
                <span className="list-col col-date">创建时间</span>
                <span className="list-col col-action">操作</span>
              </div>
              {charts.map((chart) => (
                <div
                  key={chart.id}
                  className="list-row"
                  onClick={() => onOpenSession(chart.session_id)}
                >
                  <span className="list-col col-title">
                    <span className="row-icon">📈</span>
                    {(chart.chart_config as { title?: { text?: string } })?.title?.text || "未命名图表"}
                  </span>
                  <span className="list-col col-source">{chart.session_title}</span>
                  <span className="list-col col-date">{formatDate(chart.created_at)}</span>
                  <span className="list-col col-action">
                    <button
                      className="list-delete-btn"
                      onClick={(e) => handleDeleteChart(e, chart.id)}
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {chartsHasMore && (
            <div className="load-more">
              <button
                className="load-more-btn"
                onClick={() => loadCharts(chartsPage + 1, true)}
                disabled={chartsLoading}
              >
                {chartsLoading ? "加载中..." : `加载更多 (${charts.length}/${chartsTotal})`}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

// 图表预览卡片组件
const ChartPreviewCard: React.FC<{
  chart: ChartInfo;
  onDelete: (e: React.MouseEvent) => void;
  onOpenSession: () => void;
}> = ({ chart, onDelete, onOpenSession }) => {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !chart.chart_config) return;

    const instance = echarts.init(chartRef.current);

    // 简化配置用于预览
    const previewConfig = {
      ...chart.chart_config,
      animation: false,
      tooltip: { show: false },
      legend: { show: false },
      toolbox: { show: false },
    };

    instance.setOption(previewConfig as echarts.EChartsOption);

    return () => {
      instance.dispose();
    };
  }, [chart.chart_config]);

  const chartTitle =
    (chart.chart_config as { title?: { text?: string } })?.title?.text || "未命名图表";

  return (
    <div className="chart-card" onClick={onOpenSession}>
      <div className="chart-preview" ref={chartRef}></div>
      <h3 className="card-title">{chartTitle}</h3>
      <div className="card-meta">
        <span className="meta-source">📂 {chart.session_title}</span>
      </div>
      <button className="card-delete" onClick={onDelete}>
        ✕
      </button>
    </div>
  );
};

