/** Cursor cube mark (light asset on light UI, dark asset on dark UI). */
export default function CursorIcon({ className }) {
  const imgClass = `${className ?? ''} object-contain`;
  return (
    <>
      <img
        src="/cursor-cube-light.png"
        alt=""
        className={`${imgClass} dark:hidden`}
        aria-hidden="true"
      />
      <img
        src="/cursor-cube-dark.png"
        alt=""
        className={`${imgClass} hidden dark:block`}
        aria-hidden="true"
      />
    </>
  );
}
