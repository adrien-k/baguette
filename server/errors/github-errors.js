/** Thrown when GitHub REST/GraphQL returns 401 with `"Bad credentials"`. */
export class GitHubBadCredentialsError extends Error {
  constructor(message = 'GitHub Bad credentials') {
    super(message);
    this.name = 'GitHubBadCredentialsError';
    this.code = 'GITHUB_BAD_CREDENTIALS';
  }
}
