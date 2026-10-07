/** Pi mark — https://pi.dev/favicon.svg */
export default function PiIcon({ className }) {
  const fill = 'fill-[#111111] dark:fill-[#f6f6f6]';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 560 560"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path className={fill} d="M420 280H280V140H0V0H420V280Z" />
      <path className={fill} d="M560 560H420V280H560V560Z" />
      <path className={fill} d="M140 560H0V140H140V280H280V420H140V560Z" />
    </svg>
  );
}
