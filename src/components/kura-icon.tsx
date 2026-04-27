type KuraIconProps = {
  className?: string;
  size?: number;
  title?: string;
};

export function KuraIcon({ className, size = 22, title }: KuraIconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={className}
      fill="none"
      height={size}
      role={title ? "img" : undefined}
      viewBox="0 0 32 32"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <rect
        height="24"
        rx="7"
        stroke="currentColor"
        strokeOpacity="0.8"
        strokeWidth="2"
        width="24"
        x="4"
        y="4"
      />
      <path
        d="M10 11.25C10 10.56 10.56 10 11.25 10H20.75C21.44 10 22 10.56 22 11.25V20.75C22 21.44 21.44 22 20.75 22H11.25C10.56 22 10 21.44 10 20.75V11.25Z"
        stroke="currentColor"
        strokeOpacity="0.38"
        strokeWidth="1.5"
      />
      <path
        d="M14 12.7V19.3C14 19.78 14.53 20.07 14.93 19.8L19.83 16.5C20.19 16.26 20.19 15.74 19.83 15.5L14.93 12.2C14.53 11.93 14 12.22 14 12.7Z"
        fill="#00D492"
      />
      <path
        d="M9 25H23"
        stroke="currentColor"
        strokeLinecap="round"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      <path
        d="M8 7L12 11M24 7L20 11"
        stroke="#FDC700"
        strokeLinecap="round"
        strokeOpacity="0.95"
        strokeWidth="2"
      />
    </svg>
  );
}
