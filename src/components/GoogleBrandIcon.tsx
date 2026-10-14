interface GoogleBrandIconProps {
  size?: number;
}

export default function GoogleBrandIcon({
  size = 18,
}: GoogleBrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.73 1.22 9.24 3.61l6.89-6.89C35.95 2.48 30.44 0 24 0 14.64 0 6.56 5.38 2.62 13.22l8.01 6.22C12.47 13.44 17.77 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.55c0-1.64-.15-3.21-.43-4.73H24v8.95h12.64c-.55 2.97-2.22 5.49-4.73 7.18l7.65 5.94c4.47-4.12 6.94-10.18 6.94-17.34Z"
      />
      <path
        fill="#FBBC05"
        d="M10.63 28.56A14.5 14.5 0 0 1 9.5 24c0-1.58.28-3.12.8-4.56l-8.01-6.22A24.02 24.02 0 0 0 0 24c0 3.86.92 7.52 2.56 10.78l8.07-6.22Z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.92-2.13 15.89-5.81l-7.65-5.94c-2.13 1.43-4.85 2.25-8.24 2.25-6.23 0-11.53-3.94-13.37-9.94l-8.07 6.22C6.48 42.68 14.61 48 24 48Z"
      />
    </svg>
  );
}
