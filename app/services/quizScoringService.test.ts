import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import { computeResult } from "./quizScoringService";

type QuizFixture = {
  quizId: number;
  // For each question (in position order), the correct and a wrong option id
  questions: { questionId: number; correctOptionId: number; wrongOptionId: number }[];
};

// Creates a quiz with `questionCount` true/false questions and the given passing score
function createQuiz(passingScore: number, questionCount: number): QuizFixture {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  const lesson = testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
  const quiz = testDb
    .insert(schema.quizzes)
    .values({ lessonId: lesson.id, title: "Quiz", passingScore })
    .returning()
    .get();

  const questions = [];
  for (let i = 0; i < questionCount; i++) {
    const question = testDb
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: `Question ${i + 1}`,
        questionType: schema.QuestionType.TrueFalse,
        position: i + 1,
      })
      .returning()
      .get();
    const correct = testDb
      .insert(schema.quizOptions)
      .values({ questionId: question.id, optionText: "True", isCorrect: true })
      .returning()
      .get();
    const wrong = testDb
      .insert(schema.quizOptions)
      .values({ questionId: question.id, optionText: "False", isCorrect: false })
      .returning()
      .get();
    questions.push({
      questionId: question.id,
      correctOptionId: correct.id,
      wrongOptionId: wrong.id,
    });
  }

  return { quizId: quiz.id, questions };
}

// Answers the first `correctCount` questions correctly and the rest wrongly
function selectionsWithCorrect(fixture: QuizFixture, correctCount: number) {
  const selected: Record<number, number> = {};
  fixture.questions.forEach((q, i) => {
    selected[q.questionId] = i < correctCount ? q.correctOptionId : q.wrongOptionId;
  });
  return selected;
}

describe("computeResult", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("pass threshold", () => {
    it("passes an attempt whose score equals the quiz's passing score", () => {
      const quiz = createQuiz(0.5, 4);

      const result = computeResult(base.user.id, quiz.quizId, selectionsWithCorrect(quiz, 2));

      expect(result.score).toBe(0.5);
      expect(result.passed).toBe(true);
    });

    it("passes an attempt whose score is above the quiz's passing score", () => {
      const quiz = createQuiz(0.5, 5);

      const result = computeResult(base.user.id, quiz.quizId, selectionsWithCorrect(quiz, 3));

      expect(result.score).toBe(0.6);
      expect(result.passed).toBe(true);
    });

    it("fails an attempt whose score is below the quiz's passing score", () => {
      const quiz = createQuiz(0.8, 4);

      const result = computeResult(base.user.id, quiz.quizId, selectionsWithCorrect(quiz, 3));

      expect(result.score).toBe(0.75);
      expect(result.passed).toBe(false);
    });
  });
});
