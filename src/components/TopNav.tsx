import React from "react";

type TopNavProps = {
  fileName: string;
  onBack: () => void;
  onExport?: () => void;
  exportLabel?: string;
};

export const TopNav: React.FC<TopNavProps> = ({
  fileName,
  onBack,
  onExport,
  exportLabel = "导出图表",
}) => {
  return (
    <header className="topnav">
      <div className="topnav-breadcrumb">
        <button type="button" className="topnav-home-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 8L8 2L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 7V13C4 13.5523 4.44772 14 5 14H11C11.5523 14 12 13.5523 12 13V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>首页</span>
        </button>
        <span className="topnav-separator">/</span>
        <span className="topnav-file">{fileName}</span>
      </div>
      <button type="button" className="topnav-export" onClick={onExport}>
        {exportLabel}
      </button>
    </header>
  );
};

