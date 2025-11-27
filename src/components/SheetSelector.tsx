import React from "react";

// 单选模式
type SingleSelectProps = {
  sheets: string[];
  selectedSheet: string;
  onChange: (sheet: string) => void;
  disabled?: boolean;
  multiple?: false;
};

// 多选模式
type MultiSelectProps = {
  sheets: string[];
  selectedSheets: string[];
  onChange: (sheets: string[]) => void;
  disabled?: boolean;
  multiple: true;
};

type SheetSelectorProps = SingleSelectProps | MultiSelectProps;

export const SheetSelector: React.FC<SheetSelectorProps> = (props) => {
  const { sheets, disabled = false, multiple } = props;

  if (sheets.length <= 1) {
    return null;
  }

  // 多选模式
  if (multiple) {
    const { selectedSheets, onChange } = props as MultiSelectProps;

    const handleCheckboxChange = (sheet: string, checked: boolean) => {
      if (checked) {
        onChange([...selectedSheets, sheet]);
      } else {
        // 至少保留一个选中
        if (selectedSheets.length > 1) {
          onChange(selectedSheets.filter((s) => s !== sheet));
        }
      }
    };

    return (
      <div className="sheet-multi-selector">
        <label className="sheet-label">选择 Sheet：</label>
        <div className="sheet-checkbox-list">
          {sheets.map((sheet) => (
            <label key={sheet} className="sheet-checkbox-item">
              <input
                type="checkbox"
                checked={selectedSheets.includes(sheet)}
                onChange={(e) => handleCheckboxChange(sheet, e.target.checked)}
                disabled={disabled}
              />
              <span className="sheet-checkbox-label">{sheet}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  // 单选模式
  const { selectedSheet, onChange } = props as SingleSelectProps;

  return (
    <div className="sheet-selector">
      <label className="sheet-label">Sheet：</label>
      <select
        className="sheet-select"
        value={selectedSheet}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {sheets.map((sheet) => (
          <option key={sheet} value={sheet}>
            {sheet}
          </option>
        ))}
      </select>
    </div>
  );
};

