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
import { getInstructorAnalytics } from "./instructorAnalyticsService";
import { createPurchase, createTeamPurchase } from "./purchaseService";
import { redeemCoupon } from "./couponService";

const NOW = new Date("2026-06-15T12:00:00.000Z");

let slugCounter = 0;
function addCourse(
  instructorId: number,
  status: schema.CourseStatus,
  title = "Course"
) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: `course-${++slugCounter}`,
      description: "d",
      salesCopy: "s",
      instructorId,
      categoryId: base.category.id,
      status,
    })
    .returning()
    .get();
}

let emailCounter = 0;
function addStudent() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Student",
      email: `student${++emailCounter}@example.com`,
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  testDb.insert(schema.enrollments).values({ userId, courseId }).run();
}

function addLesson(courseId: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson", position: 1 })
    .returning()
    .get();
}

function recordProgress(
  userId: number,
  lessonId: number,
  status: schema.LessonProgressStatus,
  completedAt: Date | null
) {
  testDb
    .insert(schema.lessonProgress)
    .values({
      userId,
      lessonId,
      status,
      completedAt: completedAt?.toISOString() ?? null,
    })
    .run();
}

function completeLesson(userId: number, lessonId: number) {
  recordProgress(
    userId,
    lessonId,
    schema.LessonProgressStatus.Completed,
    new Date(NOW.getTime() - 60 * 60 * 1000)
  );
}

function rowFor(
  result: ReturnType<typeof getInstructorAnalytics>,
  courseId: number
) {
  return result.courses.find((c) => c.id === courseId);
}

describe("getInstructorAnalytics", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("only includes courses owned by the instructor", () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const othersCourse = addCourse(other.id, schema.CourseStatus.Published);
    enroll(base.user.id, othersCourse.id);

    const result = getInstructorAnalytics(base.instructor.id, NOW);

    expect(result.courses.map((c) => c.id)).toEqual([base.course.id]);
    expect(result.summary.enrolledStudents).toBe(0);
  });

  it("excludes draft courses and includes archived ones", () => {
    const draft = addCourse(base.instructor.id, schema.CourseStatus.Draft);
    const archived = addCourse(
      base.instructor.id,
      schema.CourseStatus.Archived
    );

    const result = getInstructorAnalytics(base.instructor.id, NOW);

    expect(rowFor(result, draft.id)).toBeUndefined();
    expect(rowFor(result, base.course.id)?.status).toBe(
      schema.CourseStatus.Published
    );
    expect(rowFor(result, archived.id)?.status).toBe(
      schema.CourseStatus.Archived
    );
  });

  it("counts a student in two courses once in the summary and once per course", () => {
    const second = addCourse(base.instructor.id, schema.CourseStatus.Published);
    const other = addStudent();
    enroll(base.user.id, base.course.id);
    enroll(base.user.id, second.id);
    enroll(other.id, second.id);

    const result = getInstructorAnalytics(base.instructor.id, NOW);

    expect(result.summary.enrolledStudents).toBe(2);
    expect(rowFor(result, base.course.id)?.enrolledStudents).toBe(1);
    expect(rowFor(result, second.id)?.enrolledStudents).toBe(2);
  });

  it("collapses duplicate enrollment rows for the same student and course", () => {
    enroll(base.user.id, base.course.id);
    enroll(base.user.id, base.course.id);

    const result = getInstructorAnalytics(base.instructor.id, NOW);

    expect(result.summary.enrolledStudents).toBe(1);
    expect(rowFor(result, base.course.id)?.enrolledStudents).toBe(1);
  });

  describe("active students", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const JUST_INSIDE = new Date(NOW.getTime() - 30 * DAY + 1000);
    const JUST_OUTSIDE = new Date(NOW.getTime() - 30 * DAY - 1000);

    it("counts a lesson completed just inside the 30-day window", () => {
      const lesson = addLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      recordProgress(
        base.user.id,
        lesson.id,
        schema.LessonProgressStatus.Completed,
        JUST_INSIDE
      );

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.activeStudents).toBe(1);
      expect(rowFor(result, base.course.id)?.activeStudents).toBe(1);
    });

    it("ignores a lesson completed just outside the 30-day window", () => {
      const lesson = addLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      recordProgress(
        base.user.id,
        lesson.id,
        schema.LessonProgressStatus.Completed,
        JUST_OUTSIDE
      );

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.activeStudents).toBe(0);
      expect(rowFor(result, base.course.id)?.activeStudents).toBe(0);
    });

    it("ignores in-progress lessons", () => {
      const lesson = addLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      recordProgress(
        base.user.id,
        lesson.id,
        schema.LessonProgressStatus.InProgress,
        null
      );

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.activeStudents).toBe(0);
    });

    it("ignores completions by someone not enrolled in the course", () => {
      const lesson = addLesson(base.course.id);
      recordProgress(
        base.user.id,
        lesson.id,
        schema.LessonProgressStatus.Completed,
        JUST_INSIDE
      );

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.activeStudents).toBe(0);
      expect(rowFor(result, base.course.id)?.activeStudents).toBe(0);
    });

    it("counts a student active in two courses once in the summary", () => {
      const second = addCourse(
        base.instructor.id,
        schema.CourseStatus.Published
      );
      const lessonA = addLesson(base.course.id);
      const lessonB = addLesson(second.id);
      enroll(base.user.id, base.course.id);
      enroll(base.user.id, second.id);
      for (const lesson of [lessonA, lessonB, lessonB]) {
        recordProgress(
          base.user.id,
          lesson.id,
          schema.LessonProgressStatus.Completed,
          JUST_INSIDE
        );
      }

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.activeStudents).toBe(1);
      expect(rowFor(result, base.course.id)?.activeStudents).toBe(1);
      expect(rowFor(result, second.id)?.activeStudents).toBe(1);
    });

    it("ignores completions in draft courses", () => {
      const draft = addCourse(base.instructor.id, schema.CourseStatus.Draft);
      const lesson = addLesson(draft.id);
      enroll(base.user.id, draft.id);
      recordProgress(
        base.user.id,
        lesson.id,
        schema.LessonProgressStatus.Completed,
        JUST_INSIDE
      );

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.activeStudents).toBe(0);
    });
  });

  it("lists a course with no enrollments with zeros", () => {
    const result = getInstructorAnalytics(base.instructor.id, NOW);

    expect(rowFor(result, base.course.id)).toMatchObject({
      enrolledStudents: 0,
      activeStudents: 0,
    });
    expect(result.summary).toEqual({
      enrolledStudents: 0,
      activeStudents: 0,
      grossRevenue: 0,
      completionRate: null,
    });
  });

  describe("revenue", () => {
    it("counts an individual purchase's amount as gross revenue", () => {
      const other = addStudent();
      createPurchase(base.user.id, base.course.id, 4999, "US");
      createPurchase(other.id, base.course.id, 2500, "IN");

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(rowFor(result, base.course.id)).toMatchObject({
        purchases: 2,
        grossRevenue: 7499,
        unredeemedSeats: 0,
      });
      expect(result.summary.grossRevenue).toBe(7499);
    });

    it("counts a team purchase's full amount and its unredeemed seats", () => {
      const { coupons } = createTeamPurchase(
        base.user.id,
        base.course.id,
        15000,
        "US",
        3
      );
      const redeemer = addStudent();
      expect(redeemCoupon(coupons[0].code, redeemer.id, "US").ok).toBe(true);

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(rowFor(result, base.course.id)).toMatchObject({
        purchases: 1,
        grossRevenue: 15000,
        unredeemedSeats: 2,
        enrolledStudents: 1,
      });
    });

    it("counts a free enrollment as enrolled with no revenue", () => {
      enroll(base.user.id, base.course.id);

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(rowFor(result, base.course.id)).toMatchObject({
        purchases: 0,
        grossRevenue: 0,
        enrolledStudents: 1,
      });
      expect(result.summary.grossRevenue).toBe(0);
    });

    it("sums gross revenue across included courses only", () => {
      const archived = addCourse(
        base.instructor.id,
        schema.CourseStatus.Archived
      );
      const draft = addCourse(base.instructor.id, schema.CourseStatus.Draft);
      createPurchase(base.user.id, base.course.id, 1000, "US");
      createPurchase(base.user.id, archived.id, 2000, "US");
      createPurchase(base.user.id, draft.id, 4000, "US");

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      expect(result.summary.grossRevenue).toBe(3000);
    });
  });

  describe("completion and progress", () => {
    it("separates full from partial completion", () => {
      const [lessonA, lessonB] = [
        addLesson(base.course.id),
        addLesson(base.course.id),
      ];
      const partial = addStudent();
      const none = addStudent();
      for (const student of [base.user, partial, none]) {
        enroll(student.id, base.course.id);
      }
      completeLesson(base.user.id, lessonA.id);
      completeLesson(base.user.id, lessonB.id);
      completeLesson(partial.id, lessonA.id);
      completeLesson(partial.id, lessonA.id); // duplicate row counts once
      recordProgress(
        none.id,
        lessonA.id,
        schema.LessonProgressStatus.InProgress,
        null
      );

      const result = getInstructorAnalytics(base.instructor.id, NOW);
      const row = rowFor(result, base.course.id)!;

      // 1 of 3 completed; progress (1 + 0.5 + 0) / 3
      expect(row.completionRate).toBeCloseTo(1 / 3);
      expect(row.averageProgress).toBeCloseTo(0.5);
    });

    it("lowers completion when a lesson is added to the course", () => {
      const [lessonA, lessonB] = [
        addLesson(base.course.id),
        addLesson(base.course.id),
      ];
      enroll(base.user.id, base.course.id);
      completeLesson(base.user.id, lessonA.id);
      completeLesson(base.user.id, lessonB.id);
      addLesson(base.course.id);

      const row = rowFor(
        getInstructorAnalytics(base.instructor.id, NOW),
        base.course.id
      )!;

      expect(row.completionRate).toBe(0);
      expect(row.averageProgress).toBeCloseTo(2 / 3);
    });

    it("returns null rates for a course with no lessons", () => {
      enroll(base.user.id, base.course.id);

      const row = rowFor(
        getInstructorAnalytics(base.instructor.id, NOW),
        base.course.id
      )!;

      expect(row.completionRate).toBeNull();
      expect(row.averageProgress).toBeNull();
    });

    it("returns null rates for a course with no enrollments", () => {
      addLesson(base.course.id);

      const result = getInstructorAnalytics(base.instructor.id, NOW);
      const row = rowFor(result, base.course.id)!;

      expect(row.completionRate).toBeNull();
      expect(row.averageProgress).toBeNull();
      expect(result.summary.completionRate).toBeNull();
    });

    it("pools the summary completion rate across all enrollments", () => {
      const second = addCourse(
        base.instructor.id,
        schema.CourseStatus.Published
      );
      const lessonA = addLesson(base.course.id);
      const lessonB = addLesson(second.id);
      const other = addStudent();
      enroll(base.user.id, base.course.id);
      enroll(other.id, base.course.id);
      enroll(base.user.id, second.id);
      completeLesson(base.user.id, lessonA.id);
      completeLesson(base.user.id, lessonB.id);

      const result = getInstructorAnalytics(base.instructor.id, NOW);

      // 2 of 3 enrollments completed (per-course rates would average 0.75)
      expect(result.summary.completionRate).toBeCloseTo(2 / 3);
    });
  });

  describe("quizzes", () => {
    function addQuiz(courseId: number) {
      return testDb
        .insert(schema.quizzes)
        .values({
          lessonId: addLesson(courseId).id,
          title: "Quiz",
          passingScore: 0.7,
        })
        .returning()
        .get();
    }

    function attempt(
      userId: number,
      quizId: number,
      score: number,
      passed: boolean
    ) {
      testDb
        .insert(schema.quizAttempts)
        .values({ userId, quizId, score, passed })
        .run();
    }

    it("averages each student's best score per quiz", () => {
      const quiz1 = addQuiz(base.course.id);
      const quiz2 = addQuiz(base.course.id);
      const other = addStudent();
      enroll(base.user.id, base.course.id);
      enroll(other.id, base.course.id);
      attempt(base.user.id, quiz1.id, 0.4, false);
      attempt(base.user.id, quiz1.id, 0.8, true);
      attempt(other.id, quiz1.id, 0.6, false);
      attempt(base.user.id, quiz2.id, 1.0, true);

      const row = rowFor(
        getInstructorAnalytics(base.instructor.id, NOW),
        base.course.id
      )!;

      // best scores per (student, quiz): 0.8, 0.6, 1.0
      expect(row.averageBestQuizScore).toBeCloseTo(0.8);
    });

    it("passes a pair if any attempt passed and skips never-attempted pairs", () => {
      const quiz = addQuiz(base.course.id);
      const failed = addStudent();
      const neverAttempted = addStudent();
      for (const student of [base.user, failed, neverAttempted]) {
        enroll(student.id, base.course.id);
      }
      attempt(base.user.id, quiz.id, 0.9, true);
      attempt(base.user.id, quiz.id, 0.5, false);
      attempt(failed.id, quiz.id, 0.5, false);
      attempt(failed.id, quiz.id, 0.6, false);

      const row = rowFor(
        getInstructorAnalytics(base.instructor.id, NOW),
        base.course.id
      )!;

      expect(row.quizPassRate).toBeCloseTo(0.5);
    });

    it("ignores attempts by someone not enrolled in the course", () => {
      const quiz = addQuiz(base.course.id);
      const outsider = addStudent();
      enroll(base.user.id, base.course.id);
      attempt(base.user.id, quiz.id, 0.9, true);
      attempt(outsider.id, quiz.id, 0.1, false);

      const row = rowFor(
        getInstructorAnalytics(base.instructor.id, NOW),
        base.course.id
      )!;

      expect(row.averageBestQuizScore).toBeCloseTo(0.9);
      expect(row.quizPassRate).toBe(1);
    });

    it("returns null quiz metrics when nobody has attempted a quiz", () => {
      addQuiz(base.course.id);
      enroll(base.user.id, base.course.id);

      const row = rowFor(
        getInstructorAnalytics(base.instructor.id, NOW),
        base.course.id
      )!;

      expect(row.averageBestQuizScore).toBeNull();
      expect(row.quizPassRate).toBeNull();
    });
  });
});
