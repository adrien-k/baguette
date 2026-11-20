import { createContext, useContext } from 'react';

const PushApprovalUiContext = createContext({
  pushModalOpen: false,
  openAgentPushApproval: () => {},
});

export function PushApprovalUiProvider({ pushModalOpen, openAgentPushApproval, children }) {
  return (
    <PushApprovalUiContext.Provider value={{ pushModalOpen, openAgentPushApproval }}>
      {children}
    </PushApprovalUiContext.Provider>
  );
}

export function usePushApprovalUi() {
  return useContext(PushApprovalUiContext);
}
