import React from "react";

type Props = {
  size?: number;
  className?: string;
};

export default function Spinner({ size = 18, className = "" }: Props) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderWidth: Math.max(2, Math.round(size / 9)),
  };
  return (
    <span
      className={`inline-block rounded-full border-current 
        border-solid border-t-transparent animate-spin ${className}`}
      style={style}
      aria-label="Loading"
      role="status"
    />
  );
}
