import {
  and,
  avg,
  count,
  countDistinct,
  eq,
  inArray,
  isNull,
  max,
  sql,
  sum,
} from "drizzle-orm";
import { db } from "~/db";
import { CourseStatus, coupons, courses, purchases } from "~/db/schema";
import {
  bestQuizAttempts,
  studentCourseProgress,
} from "./studentProgressQueries";

// ─── Instructor Analytics Service ───
// Aggregate numbers for an instructor's own courses, computed live.
// Completion, progress and activity come from studentProgressQueries so they
// match the course roster. Rates are 0–1, or null when they can't be computed.
// Money is in cents.
// Uses positional parameters (project convention).

// Drafts have no students yet; archived courses still carry their history.
const INCLUDED_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

function includedCourses(instructorId: number) {
  return and(
    eq(courses.instructorId, instructorId),
    inArray(courses.status, INCLUDED_STATUSES)
  );
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function byCourseId<T extends { courseId: number }>(rows: T[]) {
  return new Map(rows.map((row) => [row.courseId, row]));
}

export type InstructorAnalytics = ReturnType<typeof getInstructorAnalytics>;

export function getInstructorAnalytics(instructorId: number, now: Date) {
  const included = includedCourses(instructorId);

  const courseList = db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(included)
    .orderBy(courses.title)
    .all();

  const progress = studentCourseProgress(included, now);

  const studentsByCourse = byCourseId(
    db
      .select({
        courseId: progress.courseId,
        enrolledStudents: count(),
        activeStudents: sum(progress.isActive).mapWith(Number),
        completedStudents: sum(progress.isCompleted).mapWith(Number),
        totalLessons: max(progress.totalLessons).mapWith(Number),
        averageProgress: avg(progress.progress).mapWith(Number),
      })
      .from(progress)
      .groupBy(progress.courseId)
      .all()
  );

  // A student in several courses counts once.
  const distinctStudents = db
    .select({
      enrolled: countDistinct(progress.userId),
      active: countDistinct(
        sql`case when ${progress.isActive} = 1 then ${progress.userId} end`
      ),
    })
    .from(progress)
    .get();

  const revenueByCourse = byCourseId(
    db
      .select({
        courseId: purchases.courseId,
        purchases: count(purchases.id),
        grossRevenue: sum(purchases.amountPaid).mapWith(Number),
      })
      .from(purchases)
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(included)
      .groupBy(purchases.courseId)
      .all()
  );

  // Seats bought in a team purchase that nobody has redeemed yet.
  const unredeemedByCourse = byCourseId(
    db
      .select({ courseId: coupons.courseId, seats: count(coupons.id) })
      .from(coupons)
      .innerJoin(courses, eq(coupons.courseId, courses.id))
      .where(and(included, isNull(coupons.redeemedByUserId)))
      .groupBy(coupons.courseId)
      .all()
  );

  // Averaged over attempted (student, quiz) pairs, so a pair with no attempts
  // never drags the numbers down.
  const quizResults = bestQuizAttempts(included);
  const quizzesByCourse = byCourseId(
    db
      .select({
        courseId: quizResults.courseId,
        averageBestScore: avg(quizResults.bestScore).mapWith(Number),
        passRate: avg(quizResults.passed).mapWith(Number),
      })
      .from(quizResults)
      .groupBy(quizResults.courseId)
      .all()
  );

  const courseRows = courseList.map((course) => {
    const students = studentsByCourse.get(course.id);
    const revenue = revenueByCourse.get(course.id);
    const quiz = quizzesByCourse.get(course.id);
    const enrolledStudents = students?.enrolledStudents ?? 0;
    const hasLessons = (students?.totalLessons ?? 0) > 0;
    return {
      ...course,
      enrolledStudents,
      activeStudents: students?.activeStudents ?? 0,
      completedStudents: students?.completedStudents ?? 0,
      completionRate: hasLessons
        ? ratio(students?.completedStudents ?? 0, enrolledStudents)
        : null,
      averageProgress: hasLessons ? (students?.averageProgress ?? null) : null,
      averageBestQuizScore: quiz?.averageBestScore ?? null,
      quizPassRate: quiz?.passRate ?? null,
      purchases: revenue?.purchases ?? 0,
      grossRevenue: revenue?.grossRevenue ?? 0,
      unredeemedSeats: unredeemedByCourse.get(course.id)?.seats ?? 0,
    };
  });

  const total = (pick: (row: (typeof courseRows)[number]) => number) =>
    courseRows.reduce((acc, row) => acc + pick(row), 0);

  return {
    summary: {
      enrolledStudents: distinctStudents?.enrolled ?? 0,
      activeStudents: distinctStudents?.active ?? 0,
      grossRevenue: total((row) => row.grossRevenue),
      /** Pooled over every enrollment, not an average of course rates. */
      completionRate: ratio(
        total((row) => row.completedStudents),
        total((row) => row.enrolledStudents)
      ),
    },
    courses: courseRows,
  };
}
