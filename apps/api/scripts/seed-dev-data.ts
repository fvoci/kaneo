/**
 * Development seed. Creates a project with default columns and a spread of
 * tasks under an existing user's workspace, so document features have
 * realistic data to link against.
 *
 * Usage:
 *   pnpm --filter @kaneo/api seed
 *   pnpm --filter @kaneo/api seed -- --email you@example.com --tasks 12
 *
 * The script never creates login credentials; it attaches to a user that
 * already exists so you can sign in as them. Sign up through the UI first if
 * the database has no users.
 */
import { asc, eq, max } from "drizzle-orm";
import db, { schema } from "../src/database";
import { DEFAULT_PROJECT_COLUMNS } from "../src/project/controllers/create-project";
import { seedDefaultWorkspaceRoles } from "../src/utils/seed-default-workspace-roles";

const TASK_TITLES = [
  "Draft the literature review outline",
  "Collect baseline measurements",
  "Clean the survey responses",
  "Reproduce the reference implementation",
  "Write the data dictionary",
  "Schedule the pilot interviews",
  "Verify the calibration procedure",
  "Summarise last week's findings",
  "Prepare the preregistration draft",
  "Audit the analysis scripts",
  "Chase the missing consent forms",
  "Rebuild the figures from raw data",
];

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token?.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args.set(key, value);
        i += 1;
      } else {
        args.set(key, "true");
      }
    }
  }
  return args;
}

async function resolveUser(email?: string) {
  if (email) {
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email))
      .limit(1);
    if (!user) {
      throw new Error(`No user found with email ${email}`);
    }
    return user;
  }

  const [user] = await db
    .select()
    .from(schema.userTable)
    .orderBy(asc(schema.userTable.createdAt))
    .limit(1);

  if (!user) {
    throw new Error(
      "No users exist yet. Sign up through the UI first, then re-run the seed.",
    );
  }
  return user;
}

async function resolveWorkspace(userId: string) {
  const [membership] = await db
    .select({ workspace: schema.workspaceTable })
    .from(schema.workspaceUserTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceUserTable.workspaceId, schema.workspaceTable.id),
    )
    .where(eq(schema.workspaceUserTable.userId, userId))
    .limit(1);

  if (membership?.workspace) {
    return membership.workspace;
  }

  const suffix = Date.now().toString(36);
  const [workspace] = await db
    .insert(schema.workspaceTable)
    .values({
      name: "Research Workspace",
      slug: `research-workspace-${suffix}`,
      createdAt: new Date(),
    })
    .returning();

  if (!workspace) {
    throw new Error("Failed to create a workspace");
  }

  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId,
    role: "owner",
    joinedAt: new Date(),
  });

  await seedDefaultWorkspaceRoles();

  return workspace;
}

async function createProjectWithColumns(workspaceId: string, label: string) {
  const [{ maxPosition } = { maxPosition: null }] = await db
    .select({ maxPosition: max(schema.projectTable.position) })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, workspaceId));

  const suffix = Date.now().toString(36);
  const [project] = await db
    .insert(schema.projectTable)
    .values({
      workspaceId,
      name: label,
      icon: "Layout",
      slug: `seed-${suffix}`,
      position: (maxPosition ?? -1) + 1,
    })
    .returning();

  if (!project) {
    throw new Error("Failed to create a project");
  }

  const columns: (typeof schema.columnTable.$inferSelect)[] = [];
  for (const col of DEFAULT_PROJECT_COLUMNS) {
    const [inserted] = await db
      .insert(schema.columnTable)
      .values({
        projectId: project.id,
        name: col.name,
        slug: col.slug,
        position: col.position,
        isFinal: col.isFinal,
      })
      .returning();
    if (inserted) columns.push(inserted);
  }

  return { project, columns };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production");
  }

  const args = parseArgs(process.argv.slice(2));
  const requestedTasks = Number(args.get("tasks") ?? "8");
  const taskCount = Number.isFinite(requestedTasks)
    ? Math.min(Math.max(Math.trunc(requestedTasks), 1), TASK_TITLES.length)
    : 8;

  const user = await resolveUser(args.get("email"));
  const workspace = await resolveWorkspace(user.id);
  const { project, columns } = await createProjectWithColumns(
    workspace.id,
    args.get("project") ?? "Seeded Research Project",
  );

  for (let i = 0; i < taskCount; i += 1) {
    const column = columns[i % columns.length];
    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: TASK_TITLES[i] ?? `Seeded task ${i + 1}`,
      description: `Seeded task used for local verification (#${i + 1}).`,
      status: column?.slug ?? "to-do",
      columnId: column?.id ?? null,
      priority: PRIORITIES[i % PRIORITIES.length],
      number: i + 1,
      position: i,
      userId: i % 3 === 0 ? user.id : null,
    });
  }

  await db
    .update(schema.projectTable)
    .set({ lastTaskNumber: taskCount })
    .where(eq(schema.projectTable.id, project.id));

  console.log("✅ Seed complete");
  console.log(`   user      ${user.email}`);
  console.log(`   workspace ${workspace.name} (${workspace.id})`);
  console.log(`   project   ${project.name} (${project.id})`);
  console.log(`   tasks     ${taskCount}`);
  console.log(
    `\n   /dashboard/workspace/${workspace.id}/project/${project.id}/board`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  });
