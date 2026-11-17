import { and, countDistinct, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  LessonProgressStatus,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
} from "~/db/schema";

// ─── Instructor Analytics Service ───
// Aggregate numbers for an instructor's own courses, computed live.
// Uses positional parameters (project convention).

// Drafts have no students yet; archived courses still carry their history.
const INCLUDED_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function includedCourses(instructorId: number) {
  return and(
    eq(courses.instructorId, instructorId),
    inArray(courses.status, INCLUDED_STATUSES)
  );
}

/**
 * Lesson completions in the instructor's included courses within the 30 days
 * before `now`. Only completed lessons count — not quiz attempts, video
 * events, or lessons still in progress.
 */
function recentCompletions(instructorId: number, now: Date) {
  const windowStart = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  return db
    .select({
      courseId: courses.id,
      activeStudents: countDistinct(lessonProgress.userId),
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        includedCourses(instructorId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        gte(lessonProgress.completedAt, windowStart.toISOString()),
        lte(lessonProgress.completedAt, now.toISOString())
      )
    )
    .$dynamic();
}

export type InstructorAnalytics = ReturnType<typeof getInstructorAnalytics>;

export function getInstructorAnalytics(instructorId: number, now: Date) {
  const rows = db
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      enrolledStudents: countDistinct(enrollments.userId),
    })
    .from(courses)
    .leftJoin(enrollments, eq(enrollments.courseId, courses.id))
    .where(includedCourses(instructorId))
    .groupBy(courses.id)
    .orderBy(courses.title)
    .all();

  const enrolled = db
    .select({ count: countDistinct(enrollments.userId) })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(includedCourses(instructorId))
    .get();

  const activeByCourse = new Map(
    recentCompletions(instructorId, now)
      .groupBy(courses.id)
      .all()
      .map((row) => [row.courseId, row.activeStudents])
  );

  const active = recentCompletions(instructorId, now).get();

  return {
    summary: {
      enrolledStudents: enrolled?.count ?? 0,
      activeStudents: active?.activeStudents ?? 0,
    },
    courses: rows.map((row) => ({
      ...row,
      activeStudents: activeByCourse.get(row.id) ?? 0,
    })),
  };
}
