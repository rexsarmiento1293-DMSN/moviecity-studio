import { db } from './index.ts';
import { users, dramaProjects } from './schema.ts';
import { eq, desc } from 'drizzle-orm';

export async function getOrCreateUser(uid: string, email: string) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function getUserProjectsByUid(uid: string) {
  try {
    const rows = await db
      .select({
        id: dramaProjects.id,
        projectKey: dramaProjects.projectKey,
        title: dramaProjects.title,
        prompt: dramaProjects.prompt,
        genre: dramaProjects.genre,
        status: dramaProjects.status,
        characterName: dramaProjects.characterName,
        characterAppearance: dramaProjects.characterAppearance,
        characterStyle: dramaProjects.characterStyle,
        selectedEffect: dramaProjects.selectedEffect,
        resolution: dramaProjects.resolution,
        sceneCount: dramaProjects.sceneCount,
        totalDurationSec: dramaProjects.totalDurationSec,
        createdAt: dramaProjects.createdAt,
        updatedAt: dramaProjects.updatedAt,
      })
      .from(dramaProjects)
      .innerJoin(users, eq(dramaProjects.userId, users.id))
      .where(eq(users.uid, uid))
      .orderBy(desc(dramaProjects.updatedAt));

    return rows;
  } catch (error) {
    console.error('Database query failed:', error);
    throw new Error('Failed to load projects. Please try again later.', { cause: error });
  }
}

export interface SaveProjectInput {
  projectKey: string;
  title: string;
  prompt: string;
  genre: string;
  status: string;
  characterName: string;
  characterAppearance: string;
  characterStyle: string;
  selectedEffect: string;
  resolution: string;
  sceneCount: number;
  totalDurationSec: number;
}

export async function createUserDramaProject(
  uid: string,
  email: string,
  input: SaveProjectInput
) {
  try {
    const userRecord = await getOrCreateUser(uid, email);
    const inserted = await db
      .insert(dramaProjects)
      .values({
        userId: userRecord.id,
        projectKey: input.projectKey,
        title: input.title,
        prompt: input.prompt,
        genre: input.genre,
        status: input.status,
        characterName: input.characterName,
        characterAppearance: input.characterAppearance,
        characterStyle: input.characterStyle,
        selectedEffect: input.selectedEffect,
        resolution: input.resolution,
        sceneCount: input.sceneCount,
        totalDurationSec: input.totalDurationSec,
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Failed to save project record:', error);
    throw new Error('Failed to save project. Please try again later.', { cause: error });
  }
}
