/** POST GitHub’s App Manifest form (leaves this origin). */
export function submitGithubManifestForm(githubFormUrl, manifest) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = githubFormUrl;
  form.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
