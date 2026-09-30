/** Docker Moby mark (`docker-mark-ocean-blue.svg` in repo root → `public/docker-mark.svg`). */
export default function DockerIcon({ className, title }) {
  const imgClass = `${className ?? ''} object-contain`;
  if (title) {
    return <img src="/docker-mark.svg" alt={title} className={imgClass} />;
  }
  return <img src="/docker-mark.svg" alt="" className={imgClass} aria-hidden="true" />;
}
