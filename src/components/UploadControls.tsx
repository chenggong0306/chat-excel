import React, { useRef } from "react";

type UploadControlsProps = {
  onFilesChange: (files: File[]) => void;
  multiple?: boolean;
};

export const UploadControls: React.FC<UploadControlsProps> = ({
  onFilesChange,
  multiple = true,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const triggerSelect = (accept: string) => {
    if (!inputRef.current) return;
    inputRef.current.accept = accept;
    inputRef.current.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList);
      onFilesChange(filesArray);
    }
    // 清空 input，允许再次选择相同文件
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="upload-row">
      <button
        type="button"
        className="upload-pill primary"
        onClick={() => triggerSelect(".xlsx,.xls")}
      >
        上传 Excel
      </button>
      <button
        type="button"
        className="upload-pill"
        onClick={() => triggerSelect(".csv")}
      >
        上传 CSV
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>
  );
};
