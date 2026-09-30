import DockerIcon from './svg/DockerIcon.jsx';
import { isDockerTask } from '../utils/isDockerTask.js';

export default function TaskDockerIcon({ task, className = 'w-3.5 h-3.5' }) {
  if (!isDockerTask(task)) return null;
  return <DockerIcon className={`shrink-0 ${className}`} title="Docker container" />;
}
