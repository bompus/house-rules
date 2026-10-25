// Throwaway file for checking automatic code review. This pull request is never merged.
export function average(values) {
  let sum = 0;
  for (let i = 0; i <= values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}
