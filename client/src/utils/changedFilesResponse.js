export function mapChangedFilesFromApi(files) {
  return (files ?? []).map((f) => ({
    oldPath: f.old_path,
    newPath: f.new_path,
    addedCount: f.added_count,
    removedCount: f.removed_count,
  }));
}

/** @throws {Error} when the API returned `{ error }` with HTTP 200 */
export function parseChangedFilesResponse(res) {
  if (res?.error) throw new Error(res.error);
  return mapChangedFilesFromApi(res.files);
}
