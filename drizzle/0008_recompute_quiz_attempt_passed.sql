-- Data-only migration: recompute every quiz attempt's pass flag against its
-- quiz's configured passing score (score >= passing_score passes). Attempts
-- were previously judged by a hardcoded "score > 0.7" rule.
UPDATE `quiz_attempts`
SET `passed` = CASE
  WHEN `score` >= (SELECT `passing_score` FROM `quizzes` WHERE `quizzes`.`id` = `quiz_attempts`.`quiz_id`) THEN 1
  ELSE 0
END;
