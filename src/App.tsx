import React, { useState } from "react";
import { HomePage } from "./pages/HomePage";
import { GeneratePage } from "./pages/GeneratePage";
import { HistoryPage } from "./pages/HistoryPage";
import { SessionPage } from "./pages/SessionPage";

type PageType = "home" | "generate" | "history" | "session";

export const App: React.FC = () => {
  const [page, setPage] = useState<PageType>("home");
  const [files, setFiles] = useState<File[]>([]);  // 改为支持多文件
  const [prompt, setPrompt] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const handleHomeSubmit = (f: File[], p: string) => {
    setFiles(f);
    setPrompt(p);
    setPage("generate");
  };

  const handleNavigate = (target: "home" | "history") => {
    setPage(target);
  };

  const handleOpenSession = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setPage("session");
  };

  const handleBackToHome = () => {
    setPage("home");
  };

  // 历史任务页面
  if (page === "history") {
    return (
      <HistoryPage
        onNavigate={handleNavigate}
        onOpenSession={handleOpenSession}
      />
    );
  }

  // 会话详情页面（从历史任务进入）
  if (page === "session" && currentSessionId) {
    return (
      <SessionPage
        sessionId={currentSessionId}
        onBack={() => setPage("history")}
      />
    );
  }

  // 生成页面（支持多文件）
  if (page === "generate" && files.length > 0) {
    return (
      <GeneratePage
        files={files}
        initialPrompt={prompt}
        onBack={handleBackToHome}
      />
    );
  }

  // 首页
  return (
    <HomePage
      onSubmit={handleHomeSubmit}
      onNavigate={handleNavigate}
    />
  );
};
