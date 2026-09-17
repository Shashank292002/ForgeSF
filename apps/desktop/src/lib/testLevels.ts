/**
 * Salesforce's deploy test levels, named once.
 *
 * The same enum used to be listed in three places with three different sets of
 * labels — `NoTestRun` read as "No tests" on the deploy form, "No test run" in
 * Settings, and was missing entirely from the Apex test panel. Settings also
 * could not express two of the values the deploy form accepts, so a preference
 * set there could never match what was deployed.
 */

/** `""` leaves the choice to the org. */
export type TestLevelValue =
  | ""
  | "NoTestRun"
  | "RunSpecifiedTests"
  | "RunLocalTests"
  | "RunAllTestsInOrg"
  | "RunRelevantTests";

export interface TestLevelOption {
  value: TestLevelValue;
  label: string;
  hint: string;
}

/**
 * The code coverage Salesforce requires of a production deploy, as a
 * percentage. Used for the deploy panel's bar, the Apex test panel's
 * "low coverage" colouring and the test-level hints below.
 */
export const COVERAGE_TARGET = 75;

export const TEST_LEVELS: TestLevelOption[] = [
  {
    value: "",
    label: "Org default",
    hint: "A validation runs local tests. A deploy runs none in a sandbox; in production, local tests run when it includes Apex.",
  },
  {
    value: "NoTestRun",
    label: "No tests",
    hint: "Sandboxes only. Production and validations always run tests.",
  },
  {
    value: "RunSpecifiedTests",
    label: "Specified tests",
    hint: `Only the test classes you list. Each class and trigger deployed needs ${COVERAGE_TARGET}% coverage.`,
  },
  {
    value: "RunLocalTests",
    label: "Local tests",
    hint: "Every test in the org except those from managed packages.",
  },
  {
    value: "RunAllTestsInOrg",
    label: "All tests",
    hint: "Every test in the org, managed packages included.",
  },
  {
    value: "RunRelevantTests",
    label: "Relevant tests",
    hint: "Tests Salesforce judges relevant to the deployed components.",
  },
];

/** The label for a stored level, falling back to the value itself. */
export function testLevelLabel(value: string): string {
  return TEST_LEVELS.find((item) => item.value === value)?.label ?? value;
}

/** Whether `value` is one of the levels the app and the backend accept. */
export function isTestLevel(value: unknown): value is TestLevelValue {
  return (
    typeof value === "string" &&
    TEST_LEVELS.some((item) => item.value === value)
  );
}
