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
        <button type="button" onClick={onBack} style={{ marginRight: 8 }}>
          首页
        </button>
        / <span className="topnav-file">{fileName}</span>
      </div>
      <button type="button" className="topnav-export" onClick={onExport}>
        {exportLabel}
      </button>
    </header>
  );
};

