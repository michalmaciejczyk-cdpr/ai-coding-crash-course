// The pass rule lives here rather than in quizScoringService so that the seed
// script can import it without pulling in the shared database instance.
// drizzle/0008_recompute_quiz_attempt_passed.sql applies the same rule in SQL.

/** An attempt passes when its score reaches the quiz's passing score (inclusive). */
export function isPassingScore(score: number, passingScore: number): boolean {
  return score >= passingScore;
}
