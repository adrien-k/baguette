import TaskLogModal from '../../components/TaskLogModal.jsx';
import BaguetteConfigModal from '../../components/BaguetteConfigModal.jsx';
import PushConfirmModal from '../../components/PushConfirmModal.jsx';
import SwitchAgentSdkConfirmModal from '../../components/SwitchAgentSdkConfirmModal.jsx';
import TaskConfirmModal from '../../components/TaskConfirmModal.jsx';

export default function SessionWorkspaceModals({
  pendingAgentConfigId,
  session,
  configOptions,
  switchingAgentSdk,
  onAgentSdkSwitchConfirm,
  onAgentSdkSwitchCancel,
  pendingTaskConfirm,
  onTaskConfirmCancel,
  onTaskConfirm,
  showPushModal,
  repos,
  commitsToPush,
  pushRequest,
  sessionAutoPushOn,
  sessionIsLocalRepo,
  onAutoPushChange,
  onPushConfirmed,
  onPushCancel,
  activeTaskModal,
  tasks,
  onTaskKill,
  onTaskRetry,
  onCloseTaskLog,
  showBaguetteConfigModal,
  onCloseBaguetteConfig,
}) {
  return (
    <>
      {pendingAgentConfigId && session && (
        <SwitchAgentSdkConfirmModal
          fromSdk={session.agent_sdk || 'claude'}
          toSdk={configOptions.find((c) => c.key === String(pendingAgentConfigId))?.sdk ?? 'claude'}
          fromLabel={
            configOptions.find((c) => c.key === String(session.agent_config_id))?.label ??
            session.agent_sdk
          }
          toLabel={configOptions.find((c) => c.key === String(pendingAgentConfigId))?.label}
          loading={switchingAgentSdk}
          onConfirm={onAgentSdkSwitchConfirm}
          onCancel={onAgentSdkSwitchCancel}
        />
      )}
      {pendingTaskConfirm && (
        <TaskConfirmModal
          taskLabel={pendingTaskConfirm.taskKey}
          description={pendingTaskConfirm.description}
          runPreview={pendingTaskConfirm.runPreview}
          onCancel={onTaskConfirmCancel}
          onConfirm={onTaskConfirm}
        />
      )}
      {showPushModal && (
        <PushConfirmModal
          sessionId={session?.id}
          repo={repos.find((r) => r.full_name === session?.repo_full_name) ?? null}
          commitsToPush={commitsToPush}
          initialBranch={pushRequest?.branch || session?.remote_branch || session?.local_branch}
          initialForceMode={pushRequest?.forceMode || null}
          autoPush={sessionAutoPushOn}
          autoPushDisabled={sessionIsLocalRepo}
          onAutoPushChange={onAutoPushChange}
          onConfirm={onPushConfirmed}
          onCancel={onPushCancel}
        />
      )}
      {activeTaskModal != null && session && (
        <TaskLogModal
          task={tasks.find((t) => t.id === activeTaskModal)}
          session={{
            id: session.id,
            label: session.label,
            repo_full_name: session.repo_full_name,
          }}
          onKill={onTaskKill}
          onRetry={onTaskRetry}
          onClose={onCloseTaskLog}
        />
      )}
      {showBaguetteConfigModal && session?.id && (
        <BaguetteConfigModal sessionId={session.id} onClose={onCloseBaguetteConfig} />
      )}
    </>
  );
}
