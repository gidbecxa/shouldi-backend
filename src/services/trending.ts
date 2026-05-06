export function calculateTrendingScore(totalVotes: number, hoursSincePosted: number) {
  const age = Math.max(hoursSincePosted, 1);
  return totalVotes / Math.pow(age, 1.5);
}
