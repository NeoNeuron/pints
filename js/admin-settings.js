// Replaced in Phase 3.
export async function mountSettingsTab(host) {
  host.innerHTML = `<p class="msg warn">The settings editor lands in Phase 3. Until then,
    open or close submissions by editing <code>config/site</code> in the Firebase console:
    set <code>submissionsOpen</code> and <code>submissionDeadline</code>.</p>`;
}
