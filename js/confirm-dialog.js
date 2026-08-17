/**
 * A modal confirmation with more than two answers.
 *
 * The browser's own confirm() is OK/Cancel, which cannot express "save this
 * first", "throw it away" and "never mind" at once — the three answers the
 * account page needs when you leave one abstract's editor for another. A native
 * <dialog> gives focus trapping, Escape handling and the backdrop for free, so
 * this is only the wiring and the promise.
 *
 * Every route out of the dialog resolves it directly rather than going through
 * the `close` event: that event was observed not to fire on this site's pages,
 * and a confirmation that never resolves silently wedges the caller mid-flow.
 * `settle` is therefore the single exit, guarded so the first answer wins.
 *
 * Resolves with the chosen value, or "cancel" if the dialog is dismissed with
 * Escape or by clicking the backdrop. Callers must treat "cancel" as "do
 * nothing", never as consent.
 */
export function confirmChoice({ title, message, choices }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm";

    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };

    const heading = document.createElement("h2");
    heading.textContent = title;

    const text = document.createElement("p");
    text.textContent = message;

    const actions = document.createElement("div");
    actions.className = "actions";

    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.label;
      if (choice.className) button.className = choice.className;
      button.addEventListener("click", () => settle(choice.value));
      actions.append(button);
    }

    // Escape, handled on keydown rather than through the `cancel` event: like
    // `close`, `cancel` was observed not to fire here, and Escape must never be
    // the one exit that leaves the promise pending. preventDefault stops the
    // browser dismissing it behind our back; settle does the closing.
    dialog.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      settle("cancel");
    });

    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle("cancel");
    });

    // Clicking the backdrop lands on the dialog element itself, never on its
    // children, so this is a dismiss and not a stray click inside the box.
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) settle("cancel");
    });

    // Belt and braces for any other route the platform takes to close it.
    dialog.addEventListener("close", () => settle("cancel"));

    dialog.append(heading, text, actions);
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("button")?.focus();
  });
}
