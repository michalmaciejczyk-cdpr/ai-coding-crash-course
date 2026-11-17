import { useState } from "react";
import { Link, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { requireInstructor } from "~/lib/access.server";
import {
  getInstructorAnalytics,
  type InstructorAnalytics,
} from "~/services/instructorAnalyticsService";
import { CourseStatus } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Users,
} from "lucide-react";
import { cn } from "~/lib/utils";

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "Student and activity numbers for your courses" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId } = await requireInstructor(request);
  return getInstructorAnalytics(userId, new Date());
}

type CourseRow = InstructorAnalytics["courses"][number];
type SortKey = "title" | "enrolledStudents" | "activeStudents";
type SortDirection = "asc" | "desc";

function sortRows(rows: CourseRow[], key: SortKey, direction: SortDirection) {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const result =
      key === "title"
        ? a.title.localeCompare(b.title)
        : a[key] - b[key];
    return result * sign;
  });
}

function StatusBadge({ status }: { status: CourseStatus }) {
  const styles =
    status === CourseStatus.Archived
      ? "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
      : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
        styles
      )}
    >
      {status}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function SortableHeader({
  label,
  column,
  sortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  direction: SortDirection;
  onSort: (column: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === column;
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn("px-4 py-3 font-medium", align === "right" && "text-right")}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground"
        )}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
    </th>
  );
}

export default function InstructorAnalyticsPage({
  loaderData,
}: Route.ComponentProps) {
  const { summary, courses } = loaderData;
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [direction, setDirection] = useState<SortDirection>("asc");

  function handleSort(column: SortKey) {
    if (column === sortKey) {
      setDirection(direction === "asc" ? "desc" : "asc");
    } else {
      setSortKey(column);
      // Numbers are most useful biggest-first; titles alphabetically.
      setDirection(column === "title" ? "asc" : "desc");
    }
  }

  const sorted = sortRows(courses, sortKey, direction);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          Students and activity across your published and archived courses
        </p>
      </div>

      <div className="mb-8 grid gap-6 sm:grid-cols-2">
        <SummaryCard
          label="Enrolled students"
          value={summary.enrolledStudents}
          hint="Distinct students across all your courses"
          icon={<Users className="size-4 text-muted-foreground" />}
        />
        <SummaryCard
          label="Active students"
          value={summary.activeStudents}
          hint="Completed a lesson in the last 30 days"
          icon={<Activity className="size-4 text-muted-foreground" />}
        />
      </div>

      {courses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No published courses yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analytics appear once you publish a course.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-muted-foreground">
              <tr>
                <SortableHeader
                  label="Course"
                  column="title"
                  sortKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Enrolled"
                  column="enrolledStudents"
                  sortKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                  align="right"
                />
                <SortableHeader
                  label="Active"
                  column="activeStudents"
                  sortKey={sortKey}
                  direction={direction}
                  onSort={handleSort}
                  align="right"
                />
                <th className="px-4 py-3">
                  <span className="sr-only">Roster</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((course) => (
                <tr key={course.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{course.title}</span>
                      <StatusBadge status={course.status} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {course.enrolledStudents}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {course.activeStudents}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/instructor/${course.id}/students`}
                      className="font-medium text-primary hover:underline"
                    >
                      Students →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
