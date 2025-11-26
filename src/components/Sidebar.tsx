import React from "react";

type SidebarProps = {
  active: "home" | "history";
  onNavigate?: (page: "home" | "history") => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ active, onNavigate }) => {
  const itemClass = (key: "home" | "history") =>
    `sidebar-item ${active === key ? "sidebar-item--active" : ""}`;

  const handleClick = (page: "home" | "history") => {
    if (onNavigate) {
      onNavigate(page);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span>Chat</span>Excel
      </div>
      <nav className="sidebar-menu">
        <button className={itemClass("home")} onClick={() => handleClick("home")}>
          <span className="sidebar-item-icon">⚡</span>
          快速开始
        </button>
        <button className={itemClass("history")} onClick={() => handleClick("history")}>
          <span className="sidebar-item-icon">⏱</span>
          历史任务
        </button>
      </nav>
    </aside>
  );
};

