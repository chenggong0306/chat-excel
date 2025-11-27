import React from "react";

type FileChipProps = {
  file: File;
  onClear: () => void;
};

export const FileChip: React.FC<FileChipProps> = ({ file, onClear }) => {
  const sizeInKb = (file.size / 1024).toFixed(1);

  return (
    <div className="file-chip">
      <span className="file-chip-name">{file.name}</span>
      <span className="file-chip-size">{sizeInKb} KB</span>
      <button
        type="button"
        onClick={onClear}
        className="file-chip-remove"
        title="移除文件"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
};

// 多文件展示组件
type FileChipListProps = {
  files: File[];
  onRemove: (index: number) => void;
};

export const FileChipList: React.FC<FileChipListProps> = ({ files, onRemove }) => {
  if (files.length === 0) return null;

  return (
    <div className="file-chip-list">
      {files.map((file, index) => (
        <FileChip
          key={`${file.name}-${index}`}
          file={file}
          onClear={() => onRemove(index)}
        />
      ))}
    </div>
  );
};
