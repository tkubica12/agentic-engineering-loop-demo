# Intentionally vulnerable CodeQL branch

This branch contains a deliberate command-injection sink for a live CodeQL
demonstration.

- It is not imported by the application.
- It is not present on `main`.
- The pull request must remain open or be closed without merge.
- CodeQL should identify attacker-controlled input flowing into `exec`.

The remediation is to avoid a shell entirely and pass validated values through
an argument array to a non-shell API.
