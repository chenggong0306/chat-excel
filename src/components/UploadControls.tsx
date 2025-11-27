import React, { useRef } from "react";

type UploadControlsProps = {
  onFilesChange: (files: File[]) => void;
  multiple?: boolean;
};

export const UploadControls: React.FC<UploadControlsProps> = ({
  onFilesChange,
  multiple = true,
}) => {
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (fileList && fileList.length > 0) {
      const filesArray = Array.from(fileList);
      onFilesChange(filesArray);
    }
    // 清空 input，允许再次选择相同文件
    event.target.value = "";
  };

  const handleExcelClick = () => {
    excelInputRef.current?.click();
  };

  const handleCsvClick = () => {
    csvInputRef.current?.click();
  };

  return (
    <div className="upload-row">
      <button
        type="button"
        className="upload-pill primary"
        onClick={handleExcelClick}
      >
        上传 Excel
      </button>
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        multiple={multiple}
        hidden
        onChange={handleFileChange}
      />

      <button
        type="button"
        className="upload-pill"
        onClick={handleCsvClick}
      >
        上传 CSV
      </button>
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv"
        multiple={multiple}
        hidden
        onChange={handleFileChange}
      />
    </div>
  );
};
