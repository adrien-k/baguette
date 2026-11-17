/**
 * No-op. An earlier draft of this PR added `agents.error_message`; failure copy
 * lives on `turn_result` rows instead. 094 drops the column if that draft ran.
 */

export async function up() {}

export async function down() {}
