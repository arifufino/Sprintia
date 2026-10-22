import type { Document, MongoClient } from "mongodb";
export const archiveCollections: readonly string[];
export type Archive = { format: string; version: number; database: string; createdAt: string; collections: Record<string, Document[]>; indexes: Record<string, Document[]>; options: Record<string, Document> };
export function validateArchive(data: unknown): Archive;
export function sealArchive(data: Archive, passphrase: string): string;
export function openArchive(envelope: string, passphrase: string): Archive;
export function captureDatabase(client: MongoClient, databaseName: string): Promise<Archive>;
export function restoreDatabase(client: MongoClient, databaseName: string, archive: Archive): Promise<{ collections: number; documents: number }>;
