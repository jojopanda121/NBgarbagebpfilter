import React from "react";

export default function LogoE({ size = 32, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="40" height="40" rx="6" fill="#1B4FD8" />
      <circle cx="10" cy="10" r="4.5" fill="white" opacity="0.2" />
      <circle cx="30" cy="10" r="4.5" fill="white" opacity="0.2" />
      <circle cx="10" cy="30" r="4.5" fill="white" opacity="0.2" />
      <circle cx="30" cy="30" r="4.5" fill="white" opacity="0.2" />
      <line x1="10" y1="10" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
      <line x1="30" y1="10" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
      <line x1="10" y1="30" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
      <line x1="30" y1="30" x2="20" y2="20" stroke="white" strokeWidth="1.4" opacity="0.28" />
      <rect x="5" y="6.5" width="30" height="3.5" rx="1.75" fill="white" opacity="0.88" />
      <rect x="8" y="18" width="24" height="3.5" rx="1.75" fill="white" opacity="0.88" />
      <rect x="12" y="29.5" width="16" height="3.5" rx="1.75" fill="white" opacity="0.88" />
      <circle cx="20" cy="20" r="3" fill="#C9A84C" />
    </svg>
  );
}
