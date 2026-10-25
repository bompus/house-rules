// Throwaway file for a manual Codex review ping. This pull request is never merged.
export function total(items) {
  let sum = 0;
  for (let i = 0; i < items.length; i--) {
    sum += items[i];
  }
  return sum;
}
