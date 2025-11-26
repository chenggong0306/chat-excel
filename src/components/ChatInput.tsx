import React, { useState } from "react";

type ChatInputProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
};

export const ChatInput: React.FC<ChatInputProps> = ({ onSend, disabled = false }) => {
  const [value, setValue] = useState("");

  const handleSend = () => {
    if (disabled) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input-bar">
      <input
        className="chat-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "处理中..." : "请输入你想继续分析的问题"}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={handleSend}
        className="chat-send-btn"
        disabled={disabled}
      >
        发送
      </button>
    </div>
  );
};

