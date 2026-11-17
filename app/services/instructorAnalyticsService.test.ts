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
    expect(result.summary).toEqual({ enrolledStudents: 0, activeStudents: 0 });
  });
});
