import React from 'react';

interface BrandLogoProps {
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = 'h-7 w-7' }) => {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="28" height="28" rx="7" className="fill-slate-900 stroke-slate-700" strokeWidth="1.5" />
      <path
        d="M8 10V8H10M22 8H24V10M24 22V24H22M10 24H8V22"
        className="stroke-emerald-400"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.25 10.5H17.75V14.25H21.5V17.75H17.75V21.5H14.25V17.75H10.5V14.25H14.25V10.5Z"
        className="fill-emerald-500"
      />
    </svg>
  );
};
