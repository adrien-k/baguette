import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { usersService } from '../feathers.js';
import { showGitHubBadCredentialsToast } from '../utils/githubBadCredentialsToast.jsx';

export default function GitHubBadCredentialsListener() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const onBadCredentials = () => {
      const redirectTo = `${window.location.pathname}${window.location.search}`;
      showGitHubBadCredentialsToast(redirectTo);
    };
    usersService.on('github:bad-credentials', onBadCredentials);
    return () => usersService.off('github:bad-credentials', onBadCredentials);
  }, [user]);

  return null;
}
