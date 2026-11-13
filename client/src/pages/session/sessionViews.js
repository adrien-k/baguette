import {
  MessageSquare,
  ClipboardCheck,
  FolderOpen,
  FileText,
  ListTodo,
  MonitorPlay,
} from 'lucide-react';

const BASE_VIEWS = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'review', label: 'Issues', Icon: ClipboardCheck },
  { id: 'diff', label: 'Diff', Icon: FolderOpen },
];
const DETAILS_VIEW = { id: 'details', label: 'Details', Icon: FileText };
const PLAN_VIEW = { id: 'plan', label: 'Plan', Icon: ListTodo };
const PREVIEW_VIEW = { id: 'preview', label: 'Preview', Icon: MonitorPlay };

export const GLOBAL_SESSION_VIEW_DISABLED_TOOLTIP = 'Not available for global sessions.';

export function isGlobalSessionDisabledView(viewId) {
  return viewId === 'review' || viewId === 'diff' || viewId === 'preview';
}

export const SESSION_VIEWS = [...BASE_VIEWS, PREVIEW_VIEW, PLAN_VIEW, DETAILS_VIEW];
