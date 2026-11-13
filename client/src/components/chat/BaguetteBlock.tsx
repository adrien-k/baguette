import InjectedUserTurnBlock from './InjectedUserTurnBlock.jsx';

/**
 * A `user` message Baguette wrote on the session's behalf — typed rows carry a
 * flat `content` string.
 */
export default function BaguetteBlock({
  message,
}: {
  message: {
    title?: string | null;
    content?: string;
    created_at?: string | null;
    model?: string | null;
    model_params?: unknown;
    agent_config_id?: number | null;
  };
}) {
  return <InjectedUserTurnBlock label="Baguette" defaultTitle="Baguette" message={message} />;
}
