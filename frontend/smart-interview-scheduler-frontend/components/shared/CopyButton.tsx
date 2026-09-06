"use client";

import * as React from "react";
import { Button, ButtonProps } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps extends Omit<ButtonProps, "onClick"> {
  textToCopy: string;
  label?: string;
  copiedLabel?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  textToCopy,
  label = "Copy link",
  copiedLabel = "Link copied",
  variant = "outline",
  size = "sm",
  className,
  ...props
}) => {
  const [hasCopied, setHasCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2500);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleCopy}
      className={className}
      {...props}
    >
      {hasCopied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-600 mr-1.5" />
          <span className="text-emerald-700">{copiedLabel}</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 mr-1.5" />
          <span>{label}</span>
        </>
      )}
    </Button>
  );
};
