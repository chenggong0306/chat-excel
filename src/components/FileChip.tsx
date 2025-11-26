import React from "react";

type FileChipProps = {
  file: File;
  onClear: () => void;
};

export const FileChip: React.FC<FileChipProps> = ({ file, onClear }) => {
  const sizeInKb = (file.size / 1024).toFixed(1);

  return (
    <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-slate-100 text-xs gap-2">
      <span className="font-medium">{file.name}</span>
      <span className="text-slate-400">{sizeInKb} KB</span>
      <button
        type="button"
        onClick={onClear}
        className="text-slate-400 hover:text-red-500"
      >
        ✕
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
