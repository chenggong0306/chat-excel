import React, { useState } from "react";
import { Sidebar } from "../components/Sidebar";
import { UploadControls } from "../components/UploadControls";
import { FileChipList } from "../components/FileChip";

type HomePageProps = {
  onSubmit: (files: File[], prompt: string) => void;
  onNavigate?: (page: "home" | "history") => void;
};

export const HomePage: React.FC<HomePageProps> = ({ onSubmit, onNavigate }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");

  // 只要上传了文件就可以发送，输入框不是必填
  const canSubmit = files.length > 0;

  const handleFilesChange = (newFiles: File[]) => {
    // 追加新文件到列表（去重）
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const uniqueNewFiles = newFiles.filter((f) => !existingNames.has(f.name));
      return [...prev, ...uniqueNewFiles];
    });
  };

  const handleRemoveFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (!canSubmit) return;
    onSubmit(files, prompt.trim());
  };

  return (
    <div className="app-layout">
      <Sidebar active="home" onNavigate={onNavigate} />
      <main className="main-shell">
        <section className="home-card">
          <h1 className="home-title">你想处理什么数据？</h1>
          <UploadControls onFilesChange={handleFilesChange} multiple={true} />
          <FileChipList files={files} onRemove={handleRemoveFile} />
          <div style={{ height: 16 }} />
          <div className="big-input-row">
            <input
              className="big-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="请输入对于上传文件的任何分析处理需求"
            />
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSend}
              className="send-btn"
            >
              ➜
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
