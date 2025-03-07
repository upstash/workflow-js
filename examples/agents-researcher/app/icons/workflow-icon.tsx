const DEFAULT_ICON_SIZE = 32;

export const WorkflowIcon = ({ size = DEFAULT_ICON_SIZE, ...props }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect width="32" height="32" rx="7" fill="#9333EA" />
      <path
        d="M7 7H25L7 16H25L7 25H25"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
