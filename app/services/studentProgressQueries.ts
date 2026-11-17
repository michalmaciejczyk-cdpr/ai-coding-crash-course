import { and, count, countDistinct, eq, max, min, sql, type SQL } from "drizzle-orm";
import { db } from "~/db";
import {
  LessonProgressStatus,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  quizAttempts,
  quizzes,
} from "~/db/schema";

// ─── Student Progress Queries ───
// The one definition of completion, progress and activity, shared by the
// instructor analytics page and the course roster so their numbers agree.
// (The learner-facing percentage in progressService is computed separately.)
//
// - Progress: completed lessons ÷ lessons currently in the course (null when
//   the course has no lessons). Only lessons still in the course count.
// - Completed: every lesson currently in the course is completed — adding a
//   lesson un-completes it. `enrollments.completedAt` is not used.
// - Quiz results: per (student, quiz), the best score and whether any attempt
//   passed. Never-attempted quizzes are left out.
// - Active: completed at least one lesson in the course within the 30 days
//   before `now`. Quiz attempts, video events and in-progress lessons don't count.
//
// Only enrolled students appear; duplicate enrollment rows collapse to one.
// Uses positional parameters (project convention).

const ACTIVE_WINDOW_DAYS = 30;

/**
 * A subquery with one row per (course, enrolled student) for courses matching
 * `courseFilter` (which may reference the `courses` table). Aggregate over it
 * to get course- or instructor-level numbers.
 */
export function studentCourseProgress(courseFilter: SQL | undefined, now: Date) {
  const windowStart = new Date(
    now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const enrolled = db
    .select({
      courseId: enrollments.courseId,
      userId: enrollments.userId,
      enrolledAt: min(enrollments.enrolledAt).as("enrolled_at"),
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(courseFilter)
    .groupBy(enrollments.courseId, enrollments.userId)
    .as("enrolled");

  const lessonTotals = db
    .select({
      courseId: modules.courseId,
      totalLessons: count(lessons.id).as("total_lessons"),
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .groupBy(modules.courseId)
    .as("lesson_totals");

  const completions = db
    .select({
      courseId: modules.courseId,
      userId: lessonProgress.userId,
      completedLessons: countDistinct(lessonProgress.lessonId).as(
        "completed_lessons"
      ),
      lastCompletedAt: max(lessonProgress.completedAt).as("last_completed_at"),
      isActive: sql<number>`max(${lessonProgress.completedAt} >= ${windowStart} and ${lessonProgress.completedAt} <= ${now.toISOString()})`.as(
        "is_active"
      ),
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(lessonProgress.status, LessonProgressStatus.Completed))
    .groupBy(modules.courseId, lessonProgress.userId)
    .as("completions");

  const total = sql<number>`coalesce(${lessonTotals.totalLessons}, 0)`;
  const completed = sql<number>`coalesce(${completions.completedLessons}, 0)`;

  return db
    .select({
      courseId: enrolled.courseId,
      userId: enrolled.userId,
      enrolledAt: enrolled.enrolledAt,
      totalLessons: total.as("total_lessons"),
      completedLessons: completed.as("completed_lessons"),
      /** 0–1, or null when the course has no lessons. */
      progress: sql<
        number | null
      >`case when ${total} > 0 then ${completed} * 1.0 / ${total} end`.as(
        "progress"
      ),
      /** 1 when every current lesson is completed; 0 otherwise (incl. no lessons). */
      isCompleted: sql<number>`case when ${total} > 0 and ${completed} >= ${total} then 1 else 0 end`.as(
        "is_completed"
      ),
      lastCompletedAt: completions.lastCompletedAt,
      isActive: sql<number>`coalesce(${completions.isActive}, 0)`.as(
        "is_active"
      ),
    })
    .from(enrolled)
    .leftJoin(lessonTotals, eq(lessonTotals.courseId, enrolled.courseId))
    .leftJoin(
      completions,
      and(
        eq(completions.courseId, enrolled.courseId),
        eq(completions.userId, enrolled.userId)
      )
    )
    .as("student_course_progress");
}

/**
 * A subquery with one row per (course, enrolled student, quiz) the student has
 * attempted, for courses matching `courseFilter` (which may reference the
 * `courses` table): their best score (0–1) and whether any attempt passed.
 * Never-attempted quizzes have no row.
 */
export function bestQuizAttempts(courseFilter: SQL | undefined) {
  return db
    .select({
      courseId: courses.id,
      userId: quizAttempts.userId,
      quizId: quizAttempts.quizId,
      bestScore: max(quizAttempts.score).as("best_score"),
      passed: sql<number>`max(${quizAttempts.passed})`.as("passed"),
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    // Only enrolled students count; duplicate enrollments don't change a max.
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, quizAttempts.userId),
        eq(enrollments.courseId, courses.id)
      )
    )
    .where(courseFilter)
    .groupBy(courses.id, quizAttempts.userId, quizAttempts.quizId)
    .as("best_quiz_attempts");
}
